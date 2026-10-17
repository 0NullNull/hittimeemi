// 50 Hz – simulaatio: ajojärjestys, tehonjako, taajuus, viat ja talous.
(function (root) {
  const G = (root.GridGame = root.GridGame || {});
  const { UNITS, LINES, LINK, UNLOCKS, ECON, MAX_LINE_KM, windCurve, solarCurve, heatFactor, HYDRO_INFLOW, HYDRO_CF } = G.Tech;
  const N = G.Network;
  const YEAR_S = 365 * 86400;
  const NORDIC_INERTIA = 150000; // MWs, kun verkko on synkronissa Pohjoismaiden kanssa
  const NORDIC_FCR = 1450;       // MW
  const UFLS = [48.8, 48.6, 48.4, 48.2, 48.0];

  function rng(state) {
    // mulberry32, tila tallessa pelin tilassa
    let s = (state.seed = (state.seed + 0x6d2b79f5) | 0);
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  class Sim {
    constructor(data, state) {
      this.data = data;
      this.buildStatic();
      this.state = state;
      if (state) { state.reachable = state.reachable || {}; state.feePaid = state.feePaid || {}; }
      this.topoDirty = true;
      this.live = { lines: [], buses: [], islands: [], links: [], n1: [], freq: 50 };
      this.lastUC = -1e9;
      this.lastSample = -1e9;
      this.lastN1 = -1e9;
      this.listeners = [];
    }

    // ---------- Staattinen kartta ----------
    buildStatic() {
      const w = this.data.world;
      this.buses = [];
      for (const t of w.towns) this.buses.push({ kind: "town", ...t, ...G.project(t.lat, t.lon) });
      for (const h of w.hydro) this.buses.push({ kind: "hydro", ...h, ...G.project(h.lat, h.lon) });
      for (const n of w.nuclear) this.buses.push({ kind: "nuclear", ...n, ...G.project(n.lat, n.lon) });
      const totalW = w.towns.reduce((a, t) => a + t.pop * t.weight, 0);
      this.buses.forEach((b, i) => {
        b.i = i;
        b.share = b.kind === "town" ? (b.pop * b.weight) / totalW : 0;
      });
      this.busByName = new Map(this.buses.map((b) => [b.name + ":" + b.kind, b.i]));
      this.linkDefs = w.links.map((l, i) => ({ ...l, i, bus: this.buses.findIndex((b) => b.kind === "town" && b.name === l.town) }));
    }

    // ---------- Uusi peli ----------
    static newGame(data, startTown, seed = Date.now() | 0) {
      const sim = new Sim(data, null);
      const bus = sim.buses.findIndex((b) => b.kind === "town" && b.name === startTown);
      const S = {
        version: 1, t: 0, money: ECON.startMoney, seed, startTown: bus, nextId: 1,
        lines: [], units: [], links: [], connected: { [bus]: true }, reachable: { [bus]: true }, feePaid: { [bus]: true }, hydro: {}, unlocked: { mid: false, high: false },
        stats: { peakServed: 0, servedMWh: 0, unservedMWh: 0, revenue: 0, costs: 0, co2t: 0, days: 0 },
        daily: [], history: [], events: [], achievements: {}, priceAvg: 45,
      };
      sim.buses.forEach((b) => { if (b.kind === "hydro") S.hydro[b.i] = { res: b.maxMW * HYDRO_CF * b.reservoirHours * 0.6 }; });
      sim.state = S;
      // aloituslahja: kaasuturbiini, joka kattaa kaupungin huipun
      const peak = 15100 * sim.buses[bus].share * 1.15;
      let left = peak;
      while (left > 0) {
        const mw = left > 100 ? 200 : left > 50 ? 100 : 50;
        const u = sim.newUnit("ocgt", bus, mw, "online");
        u.p = mw * 0.5;
        S.units.push(u);
        left -= mw;
      }
      sim.log("info", `Uusi verkkoyhtiö perustettu: ${startTown}. Kaasuturbiini on valmiina.`);
      return sim;
    }

    newUnit(type, bus, mw, state = "building") {
      const T = UNITS[type];
      const u = { id: this.state.nextId++, type, bus, mw, state, left: state === "building" ? T.buildDays * 86400 : 0, p: 0, upT: 0, mode: "auto" };
      if (T.storageHours) u.soc = mw * T.storageHours * 0.5;
      if (type === "nuclear") u.refuelDay = 140 + ((u.id * 17) % 60);
      return u;
    }

    on(fn) { this.listeners.push(fn); }
    log(kind, text, extra = {}) {
      const e = { t: this.state.t, kind, text, ...extra };
      this.state.events.unshift(e);
      if (this.state.events.length > 150) this.state.events.length = 150;
      for (const fn of this.listeners) fn(e);
    }

    // ---------- Hinnat ja kustannukset ----------
    year() { return this.data.locate(this.state.t).year; }

    // Naapurimaan sähkön hinta (€/MWh): perushinta × vuodenaika × vuorokausi × pakkaskerroin + vaihtelu
    neighbourPrice(def, t) {
      const d = new Date(G.EPOCH_MS + t * 1000);
      const month = d.getUTCMonth();
      const hour = (d.getUTCHours() + 2) % 24;
      const season = [1.2, 1.15, 1.05, 0.95, 0.85, 0.8, 0.78, 0.85, 0.95, 1.05, 1.15, 1.2][month];
      const daily = hour < 6 ? 0.82 : hour < 8 ? 1 : hour < 11 ? 1.12 : hour < 16 ? 1 : hour < 20 ? 1.15 : 0.92;
      const cold = Math.max(0, Math.min(1, (this.data.nationalLoad(t) - 10000) / 4500));
      const day = Math.floor(t / 86400);
      const wobble = Math.sin(day * 1.7 + def.i) * 0.12 + Math.sin(day * 0.31 + def.i * 2) * 0.1;
      return Math.max(2, def.basePrice * season * daily * (1 + 1.2 * cold * cold) * (1 + wobble));
    }

    unitCost(u, year) {
      const T = UNITS[u.type];
      if (u.type === "hydro") {
        // veden arvo: täysi allas = halpa (ettei vesi valu ohi), tyhjä = kallis
        const site = this.buses[u.bus];
        const cap = site.maxMW * HYDRO_CF * site.reservoirHours;
        const fill = this.state.hydro[u.bus].res / cap;
        return 2 + 70 * Math.pow(Math.max(0, 1 - fill), 2);
      }
      return T.fuel(year);
    }

    // ---------- Rakentaminen ----------
    lineKm(a, b) { return G.distanceKm(this.buses[a], this.buses[b]) * 1.15; }

    quoteLine(a, b, kv) {
      const L = LINES[kv];
      if (a === b) return { ok: false, reason: "Valitse kaksi eri kohdetta." };
      if (L.unlock && !this.state.unlocked[L.unlock]) return { ok: false, reason: UNLOCKS[L.unlock].label };
      const km = this.lineKm(a, b);
      if (km > MAX_LINE_KM) return { ok: false, km, reason: `Liian pitkä (${Math.round(km)} km, max ${MAX_LINE_KM} km).` };
      const same = this.state.lines.filter((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a)).length;
      if (same >= 3) return { ok: false, km, reason: "Näiden välillä on jo 3 johtoa." };
      const cost = km * L.capexPerKm * 1e6 * ECON.capexScale;
      if (cost > this.state.money) return { ok: false, km, cost, reason: "Ei tarpeeksi rahaa." };
      return { ok: true, km, cost, days: L.buildDays };
    }

    buildLine(a, b, kv) {
      const q = this.quoteLine(a, b, kv);
      if (!q.ok) return q;
      this.state.money -= q.cost;
      this.state.lines.push({ id: this.state.nextId++, a, b, kv, km: q.km, state: "building", left: LINES[kv].buildDays * 86400, overloadT: 0 });
      this.log("build", `${LINES[kv].name} -johto ${this.buses[a].name}–${this.buses[b].name} (${Math.round(q.km)} km) rakenteilla.`);
      return q;
    }

    allowedTypes(bus) {
      const b = this.buses[bus];
      return Object.keys(UNITS).filter((type) => {
        const w = UNITS[type].where;
        return w === b.kind || (w === "town" && b.kind === "town");
      });
    }

    quoteUnit(type, bus, mw) {
      const T = UNITS[type], b = this.buses[bus], S = this.state;
      if (!this.allowedTypes(bus).includes(type)) return { ok: false, reason: "Ei voi rakentaa tähän." };
      if (T.unlock && !S.unlocked[T.unlock]) return { ok: false, reason: UNLOCKS[T.unlock].label };
      if (T.minPop && b.pop < T.minPop) return { ok: false, reason: `Vaatii kaukolämpöverkon (yli ${T.minPop / 1000} 000 asukasta).` };
      const here = S.units.filter((u) => u.bus === bus && u.type === type);
      if (type === "hydro") {
        const used = here.reduce((a, u) => a + u.mw, 0);
        if (used + mw > b.maxMW) return { ok: false, reason: `Joen kapasiteetti: ${b.maxMW - used} MW jäljellä.` };
      }
      if (type === "nuclear" && here.length >= b.maxUnits) return { ok: false, reason: "Voimalaitospaikka on täynnä." };
      if (type === "chp") {
        const used = here.reduce((a, u) => a + u.mw, 0);
        const max = Math.round((b.pop / 1000) * 1.5);
        if (used + mw > max) return { ok: false, reason: `Kaukolämpöverkon koko riittää ${max} MW:iin.` };
      }
      const cost = mw * T.capex(this.year()) * 1e6 * ECON.capexScale;
      if (cost > S.money) return { ok: false, cost, reason: "Ei tarpeeksi rahaa." };
      return { ok: true, cost, days: T.buildDays };
    }

    buildUnit(type, bus, mw) {
      const q = this.quoteUnit(type, bus, mw);
      if (!q.ok) return q;
      this.state.money -= q.cost;
      this.state.units.push(this.newUnit(type, bus, mw));
      this.log("build", `${UNITS[type].name} ${mw} MW (${this.buses[bus].name}) rakenteilla, valmis ${Math.round(q.days)} päivässä.`);
      return q;
    }

    quoteLink(i) {
      const def = this.linkDefs[i], S = this.state;
      if (S.links.some((l) => l.def === i)) return { ok: false, reason: "Yhteys on jo rakennettu." };
      if (!S.unlocked[LINK.unlock]) return { ok: false, reason: UNLOCKS[LINK.unlock].label };
      const cost = def.mw * LINK.capexPerMW * 1e6 * ECON.capexScale;
      if (cost > S.money) return { ok: false, cost, reason: "Ei tarpeeksi rahaa." };
      return { ok: true, cost, days: LINK.buildDays };
    }

    buildLink(i) {
      const q = this.quoteLink(i);
      if (!q.ok) return q;
      const def = this.linkDefs[i];
      this.state.money -= q.cost;
      this.state.links.push({ id: this.state.nextId++, def: i, bus: def.bus, mw: def.mw, ac: def.ac, state: "building", left: LINK.buildDays * 86400, p: 0 });
      this.log("build", `Ulkomaanyhteys ${def.name} (${def.mw} MW) rakenteilla.`);
      return q;
    }

    demolish(kind, id) {
      const S = this.state;
      const list = kind === "line" ? S.lines : S.units;
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return;
      const x = list[i];
      if (x.state === "building") {
        // rakenteilla olevasta saa puolet takaisin
        const cost = kind === "line" ? x.km * LINES[x.kv].capexPerKm * 1e6 : x.mw * UNITS[x.type].capex(this.year()) * 1e6;
        S.money += cost * 0.5 * ECON.capexScale;
      }
      list.splice(i, 1);
      this.topoDirty = true;
    }

    setMode(id, mode) {
      const u = this.state.units.find((x) => x.id === id);
      if (u) u.mode = mode;
    }

    // ---------- Topologia ----------
    rebuildTopology() {
      const S = this.state;
      const busActive = new Uint8Array(this.buses.length);
      for (const u of S.units) if (u.state !== "building") busActive[u.bus] = 1;
      for (const l of S.links) if (l.state !== "building") busActive[l.bus] = 1;
      this.netLines = S.lines.map((l) => {
        const L = LINES[l.kv];
        const inService = l.state === "in";
        if (inService) { busActive[l.a] = 1; busActive[l.b] = 1; }
        return { a: l.a, b: l.b, bpu: N.susceptance(l.kv, l.km, L.xPerKm), inService, limit: L.limit };
      });
      const topo = N.buildIslands(this.buses.length, this.netLines, (b) => busActive[b]);
      this.topo = topo;
      for (const isl of topo.islands) {
        const set = new Set(isl.buses);
        isl.units = S.units.filter((u) => u.state !== "building" && set.has(u.bus));
        isl.links = S.links.filter((l) => l.state !== "building" && set.has(l.bus));
        isl.towns = isl.buses.filter((b) => this.buses[b].kind === "town");
        isl.hasSupply = isl.units.length > 0 || isl.links.length > 0;
      }
      this.topoDirty = false;
    }

    // ---------- Simulaatiosilmukka ----------
    // speed = pelisekuntia per todellinen sekunti; askeleen pituus valitaan nopeuden mukaan
    advance(gameSeconds, speed = gameSeconds) {
      const dt = speed <= 60 ? 1 : speed <= 3600 ? 10 : speed <= 21600 ? 60 : 300;
      this.acc = (this.acc || 0) + gameSeconds;
      let steps = 0;
      while (this.acc >= dt && steps < 600) {
        this.step(dt);
        this.acc -= dt;
        steps++;
      }
      if (steps >= 600) this.acc = 0;
    }

    step(dt) {
      const S = this.state;
      S.t += dt;
      const t = S.t;
      const year = this.year();
      this.progressTimers(dt);
      if (this.topoDirty) this.rebuildTopology();

      // sää asemittain tälle askeleelle
      const st = this.data.world.stations.map((_, i) => this.data.weatherAt(i, t));
      this.weatherNow = st;
      const national = this.data.nationalLoad(t);
      this.nationalNow = national;

      if (t - this.lastUC >= 900) { this.unitCommitment(t); this.lastUC = t; }

      const injections = new Float64Array(this.buses.length);
      const servedAt = new Float64Array(this.buses.length);
      const demandAt = new Float64Array(this.buses.length);
      let totalServed = 0, totalUnserved = 0, revenue = 0, costs = 0, co2 = 0;
      const dtH = dt / 3600;
      const islandsLive = [];

      for (const isl of this.topo.islands) {
        // kysyntä: liitetyt kaupungit
        // kysyntä: vain asiakkaiksi liitetyt kaupungit. Uusi kaupunki verkon ulottuvilla odottaa liittämistä.
        let demand = 0;
        if (isl.hasSupply) {
          for (const b of isl.towns) {
            if (S.connected[b]) {
              const d = national * this.buses[b].share;
              demandAt[b] = d;
              demand += d;
            } else if (!S.reachable[b]) {
              S.reachable[b] = true;
              this.log("reach", `${this.buses[b].name} on nyt verkkosi ulottuvilla. Liitä se asiakkaaksi kaupungin paneelista, kun kapasiteetti riittää.`, { bus: b });
            }
          }
        }
        const r = this.dispatchIsland(isl, demand, t, dt, year, st);
        r.island = isl;
        islandsLive.push(r);
        const servedFrac = demand > 0 ? (demand - r.unserved) / demand : 1;
        for (const b of isl.towns) servedAt[b] = demandAt[b] * servedFrac;
        for (const [bus, p] of r.inj) injections[bus] += p;
        for (const b of isl.towns) injections[b] -= servedAt[b];
      }

      // tehonjako ja ylikuormat (voi irrottaa kuormaa, joten talous lasketaan vasta tämän jälkeen)
      const flows = new Float64Array(this.netLines.length);
      for (const r of islandsLive) {
        N.islandFlows(r.island, injections, flows);
        this.relieveCongestion(r, injections, flows, servedAt);
      }
      this.checkOverloads(flows, dt);

      for (const r of islandsLive) {
        totalServed += r.demand - r.unserved;
        totalUnserved += r.unserved;
        revenue += (r.demand - r.unserved) * dtH * ECON.retailPrice + r.exportRevenue * dtH;
        costs += r.fuelCost * dtH + r.importCost * dtH + r.unserved * dtH * ECON.unservedPenalty;
        co2 += r.co2 * dtH;
      }

      // kiinteät kulut
      let fixed = 0;
      for (const u of S.units) if (u.state !== "building") fixed += u.mw * UNITS[u.type].omPerMWYear;
      for (const l of S.lines) if (l.state !== "building") fixed += l.km * ECON.lineOMPerKmYear;
      costs += (fixed * ECON.omScale * dt) / YEAR_S;
      // velalle korko 8 %/v
      if (S.money < 0) costs += (-S.money * 0.08 * dt) / YEAR_S;

      S.money += revenue - costs;
      S.stats.servedMWh += totalServed * dtH;
      S.stats.unservedMWh += totalUnserved * dtH;
      const ub = (S.stats.unservedBy = S.stats.unservedBy || { capacity: 0, congestion: 0, frequency: 0 });
      for (const r of islandsLive) {
        ub.capacity += (r.unservedCap || 0) * dtH;
        ub.congestion += (r.unservedCong || 0) * dtH;
        ub.frequency += (r.unservedFreq || 0) * dtH;
      }
      S.stats.revenue += revenue;
      S.stats.costs += costs;
      S.stats.co2t += co2;
      this.dayAccumulate(revenue, costs, totalServed * dtH, totalUnserved * dtH, co2);
      if (totalServed > S.stats.peakServed) {
        S.stats.peakServed = totalServed;
        for (const k of ["mid", "high"]) {
          if (!S.unlocked[k] && totalServed >= UNLOCKS[k].peakMW) {
            S.unlocked[k] = true;
            this.log("unlock", k === "mid" ? "Avattu: 220 kV johdot, kombi- ja hiilivoimalat." : "Avattu: 400 kV johdot, ydinvoima ja ulkomaanyhteydet.");
          }
        }
      }

      this.randomFaults(dt, st);
      this.live = { ...this.live, flows, injections, servedAt, demandAt, islands: islandsLive, totalServed, totalUnserved, national };
      this.live.freq = this.frequencyNow(t);
      if (t - this.lastN1 >= 900) { this.live.n1 = this.securityCheck(flows); this.lastN1 = t; }
      if (t - this.lastSample >= 900) { this.sample(); this.lastSample = t; }
    }

    // Arvio kaupungin huippukulutuksesta (MW)
    townPeak(b) { return 15100 * this.buses[b].share * this.data.growth(this.year()); }

    // Saarekkeen varma kapasiteetti vs. asiakkaiden huippu. Tuuli ja aurinko eivät ole varmaa tehoa.
    islandMargin(bus) {
      if (this.topoDirty) this.rebuildTopology();
      const isl = this.topo.islands[this.topo.busIsland[bus]];
      if (!isl || !isl.hasSupply) return null;
      const st = this.weatherNow || this.data.world.stations.map((_, i) => this.data.weatherAt(i, this.state.t));
      let firm = 0;
      for (const u of isl.units) {
        if (u.state === "tripped" || u.state === "refuel") continue;
        const T = UNITS[u.type];
        if (T.weather) continue;
        firm += u.type === "battery" ? u.mw * 0.5 : this.unitRange(u, st)[1];
      }
      for (const l of isl.links) if (l.state === "in") firm += l.mw;
      let peak = 0;
      for (const b of isl.towns) if (this.state.connected[b]) peak += this.townPeak(b);
      // johtojen siirtokyky kaupunkiin + paikallinen tuotanto
      let feed = 0;
      this.state.lines.forEach((l) => { if (l.state === "in" && (l.a === bus || l.b === bus)) feed += LINES[l.kv].limit; });
      for (const u of isl.units) if (u.bus === bus && !UNITS[u.type].weather) feed += u.mw;
      return { firm, peak, spare: firm - peak, feed };
    }

    connectCustomer(b) {
      const S = this.state, bus = this.buses[b];
      if (S.connected[b]) return { ok: false, reason: "Kaupunki on jo asiakkaasi." };
      const m = this.islandMargin(b);
      if (!m) return { ok: false, reason: "Rakenna ensin johto tai voimala tähän kaupunkiin." };
      S.connected[b] = true;
      S.feePaid = S.feePaid || {};
      if (b !== S.startTown && !S.feePaid[b]) {
        S.feePaid[b] = true;
        const fee = bus.pop * bus.weight * ECON.connectionFee;
        S.money += fee;
        this.log("connect", `${bus.name} liitettiin verkkoosi! Liittymismaksu ${G.fmtMoney(fee)}.`);
      } else this.log("connect", `${bus.name} liitettiin takaisin verkkoosi.`);
      return { ok: true };
    }

    disconnectCustomer(b) {
      if (!this.state.connected[b] || b === this.state.startTown) return;
      delete this.state.connected[b];
      this.log("info", `${this.buses[b].name} irrotettiin verkostasi.`);
    }

    progressTimers(dt) {
      const S = this.state;
      const d = new Date(G.EPOCH_MS + S.t * 1000);
      const doy = Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000);
      for (const l of S.lines) {
        if (l.state === "building" || l.state === "out") {
          l.left -= dt;
          if (l.left <= 0) {
            if (l.state === "building") this.log("done", `${LINES[l.kv].name} ${this.buses[l.a].name}–${this.buses[l.b].name} valmis.`);
            l.state = "in";
            l.overloadT = 0;
            this.topoDirty = true;
          }
        }
      }
      for (const u of S.units) {
        if (["building", "tripped", "refuel"].includes(u.state)) {
          u.left -= dt;
          if (u.left <= 0) {
            if (u.state === "building") { this.log("done", `${UNITS[u.type].name} ${u.mw} MW (${this.buses[u.bus].name}) valmis.`); this.topoDirty = true; }
            u.state = "off";
          }
        } else if (u.state === "starting") {
          u.left -= dt;
          if (u.left <= 0) { u.state = "online"; u.upT = 0; }
        } else if (u.state === "online") {
          u.upT += dt;
        }
        if (u.type === "nuclear" && u.state === "online" && doy >= u.refuelDay && u.lastRefuel !== d.getUTCFullYear()) {
          u.lastRefuel = d.getUTCFullYear();
          u.state = "refuel";
          u.left = UNITS.nuclear.refuelDays * 86400;
          u.p = 0;
          this.log("info", `Ydinvoimalan vuosihuolto alkoi (${this.buses[u.bus].name}, ${u.mw} MW), kestää 3 viikkoa.`);
        }
      }
      for (const l of S.links) {
        if (l.state === "building" || l.state === "out") {
          l.left -= dt;
          if (l.left <= 0) {
            if (l.state === "building") this.log("done", `Ulkomaanyhteys ${this.linkDefs[l.def].name} valmis.`);
            l.state = "in";
            this.topoDirty = true;
          }
        }
      }
      // vesivoiman tulovirtaama
      const month = d.getUTCMonth();
      for (const b of this.buses) {
        if (b.kind !== "hydro") continue;
        const h = S.hydro[b.i];
        const cap = b.maxMW * HYDRO_CF * b.reservoirHours;
        h.res = Math.min(cap, h.res + b.maxMW * HYDRO_CF * HYDRO_INFLOW[month] * (dt / 3600));
      }
    }

    // Tehoalue hetkellä t: [min, max] MW. Säästä riippuvilla max = saatavilla oleva.
    unitRange(u, st) {
      const T = UNITS[u.type], b = this.buses[u.bus];
      if (T.weather === "wind") { const v = windCurve(st[b.station].wind) * u.mw; return [0, v]; }
      if (T.weather === "solar") { const v = solarCurve(st[b.station].rad) * u.mw; return [0, v]; }
      if (T.heatDriven) {
        const h = heatFactor(st[b.station].temp);
        return [u.mw * h * 0.6, u.mw * (0.15 + 0.85 * h)];
      }
      if (u.type === "hydro") {
        const site = this.buses[u.bus];
        const cap = site.maxMW * HYDRO_CF * site.reservoirHours;
        const res = this.state.hydro[u.bus].res;
        // Täysi allas ei pakota ajamaan: ylimääräinen vesi juoksutetaan ohi (veden arvo on silloin ~0).
        // Tyhjä allas rajoittaa ajon minimivirtaamaan.
        return [u.mw * T.minLoad, res > 1 ? u.mw : u.mw * T.minLoad];
      }
      return [u.mw * T.minLoad, u.mw];
    }

    // ---------- Ajojärjestys (unit commitment) ----------
    unitCommitment(t) {
      const year = this.year();
      const st = this.weatherNow || this.data.world.stations.map((_, i) => this.data.weatherAt(i, t));
      for (const isl of this.topo.islands) {
        if (!isl.hasSupply) continue;
        let peak = 0, low = Infinity;
        for (let k = 0; k <= 6; k++) {
          const nat = this.data.nationalLoad(t + k * 3600);
          let d = 0;
          for (const b of isl.towns) d += nat * this.buses[b].share;
          peak = Math.max(peak, d);
          low = Math.min(low, d);
        }
        let renew = 0, imports = 0, batt = 0, exportCap = 0;
        for (const u of isl.units) {
          const T = UNITS[u.type];
          if (T.weather && u.state !== "tripped") renew += this.unitRange(u, st)[1];
          if (u.type === "battery" && u.state !== "tripped") batt += u.mw * 0.5;
        }
        for (const l of isl.links) if (l.state === "in") { imports += l.mw * 0.9; exportCap += l.mw; }
        const reserve = this.reserveRequirement(isl);
        const need = peak - renew * 0.7 - imports - batt + reserve;
        const cands = isl.units
          .filter((u) => !UNITS[u.type].weather && u.type !== "battery" && ["off", "online", "starting"].includes(u.state))
          .sort((a, b) => this.unitCost(a, year) - this.unitCost(b, year));
        const commit = new Set();
        let acc = 0;
        for (const u of cands) {
          if (u.mode === "off") continue;
          // pullonkaulan takia alas ajettu voimala odottaa
          if (u.blockedUntil > t && u.mode !== "on") continue;
          if (acc < need || u.mode === "on" || u.type === "nuclear" || u.type === "hydro" || u.keepUntil > t) {
            commit.add(u);
            acc += this.unitRange(u, st)[1];
          }
        }
        // minimikuormat eivät saa ylittää yön kulutusta + vientiä
        let minSum = 0;
        for (const u of commit) minSum += this.unitRange(u, st)[0];
        const room = low - renew * 0.3 + exportCap;
        const byCost = [...commit].sort((a, b) => this.unitCost(b, year) - this.unitCost(a, year));
        for (const u of byCost) {
          if (minSum <= room) break;
          if (u.type === "nuclear" || u.mode === "on") continue;
          if (acc - this.unitRange(u, st)[1] < need) continue;
          commit.delete(u);
          minSum -= this.unitRange(u, st)[0];
          acc -= this.unitRange(u, st)[1];
        }
        for (const u of cands) {
          const T = UNITS[u.type];
          if (commit.has(u) && u.state === "off") {
            u.state = T.startHours > 0 ? "starting" : "online";
            u.left = T.startHours * 3600;
            u.upT = 0;
          } else if (!commit.has(u) && u.state !== "off" && (u.upT >= T.minUpHours * 3600 || u.state === "starting" || u.mode === "off")) {
            u.state = "off";
            u.p = 0;
          }
        }
      }
    }

    reserveRequirement(isl) {
      let largest = 0, load = 0;
      for (const u of isl.units) if (u.state === "online") largest = Math.max(largest, u.p || 0);
      for (const l of isl.links) if (l.state === "in") largest = Math.max(largest, l.p || 0);
      for (const b of isl.towns) load += (this.nationalNow || 9000) * this.buses[b].share;
      const nordic = isl.links.some((l) => l.state === "in" && l.ac);
      return (nordic ? 0.25 * largest : largest) + 0.01 * load;
    }

    // ---------- Tehonjako (economic dispatch) ----------
    dispatchIsland(isl, demand, t, dt, year, st) {
      const S = this.state;
      const dtH = dt / 3600, dtMin = dt / 60;
      const out = { demand, unserved: 0, inj: new Map(), fuelCost: 0, co2: 0, importCost: 0, exportRevenue: 0, price: 0, reserve: 0, reserveReq: 0, inertia: 0, nordic: false, gen: {}, curtailed: 0, resources: [] };
      const add = (bus, p) => out.inj.set(bus, (out.inj.get(bus) || 0) + p);
      const gen = (type, p) => { out.gen[type] = (out.gen[type] || 0) + p; };
      out.nordic = isl.links.some((l) => l.state === "in" && l.ac);
      if (!isl.hasSupply) return out;
      // taajuushäiriön jälkeen irrotettu kuorma palaa vasta hetken päästä
      let shedMW = 0;
      const sh = this.shedState;
      if (sh && sh.until > t && isl.buses.some((b) => sh.buses.has(b))) {
        shedMW = demand * sh.frac;
        demand -= shedMW;
      }

      const res = [];
      let fixed = 0;
      for (const u of isl.units) {
        const T = UNITS[u.type];
        if (u.state === "tripped" || u.state === "refuel") { u.p = 0; continue; }
        if (T.weather) {
          const [, avail] = this.unitRange(u, st);
          u.p = avail;
          fixed += avail;
          res.push({ kind: "renew", u, bus: u.bus, lo: 0, hi: avail, p: avail, cost: -1, fcr: 0 });
          continue;
        }
        if (u.type === "battery") {
          // Puolet varauksesta pidetään taajuusreserviä varten; kauppaa käydään vain yläpuoliskolla.
          const cap = u.mw * T.storageHours;
          const dis = Math.min(u.mw, (u.soc / dtH) * 0.98);
          const arb = Math.min(dis, Math.max(0, u.soc - cap * 0.5) / dtH);
          const chg = Math.min(u.mw, ((cap - u.soc) / dtH) / T.efficiency);
          res.push({ kind: "batt", u, bus: u.bus, lo: -chg, hi: dis, arb, pmax: dis, p: 0, cost: S.priceAvg * 1.12, bid: S.priceAvg * 0.85, fcr: Math.min(u.mw, u.soc / 0.25), fcrT: T.fcrT });
          continue;
        }
        if (u.state !== "online") { u.p = 0; continue; }
        const [pmin, pmax] = this.unitRange(u, st);
        const ramp = T.ramp * u.mw * dtMin;
        let lo = Math.max(pmin, u.p - ramp), hi = Math.min(pmax, u.p + ramp);
        if (u.p < pmin) lo = Math.min(pmin, u.p + ramp);
        if (hi < lo) hi = lo;
        res.push({ kind: "unit", u, bus: u.bus, lo, hi, pmax, p: lo, cost: this.unitCost(u, year), fcr: T.fcr * u.mw, fcrT: T.fcrT });
        out.inertia += T.H * u.mw;
      }
      for (const l of isl.links) {
        if (l.state !== "in") { l.p = 0; continue; }
        const price = this.neighbourPrice(this.linkDefs[l.def], t);
        res.push({ kind: "link", l, bus: l.bus, lo: -l.mw, hi: l.mw, pmax: l.mw, p: 0, cost: price, fcr: l.ac ? 0 : Math.min(200, l.mw * 0.1), fcrT: 1 });
      }
      // Kuinka paljon kukin voi vielä nostaa tässä askeleessa (rampin ja reservivarauksen rajoissa)
      const upRoom = (r) => {
        const start = r.kind === "unit" ? r.p : Math.max(0, r.p);
        const cap = r.kind === "batt" ? Math.min(r.arb, r.hi - (r.hold || 0)) : Math.min(r.hi, r.pmax - (r.hold || 0));
        return cap - start;
      };
      if (out.nordic) out.inertia += NORDIC_INERTIA;

      // reservi pidetään säästä riippumattomissa nopeissa yksiköissä
      const req = this.reserveRequirement(isl);
      out.reserveReq = req;
      let held = 0;
      const reserveOrder = res.filter((r) => r.fcr > 0).sort((a, b) => (a.kind === "batt" ? -1 : 0) - (b.kind === "batt" ? -1 : 0) || a.fcrT - b.fcrT);
      for (const r of reserveOrder) {
        // reservikyky: koko nousuvara nimellistehoon asti (vaste 30 s:ssa), ei yhden askeleen ramppi
        const room = r.pmax - Math.max(r.lo, 0);
        r.hold = Math.max(0, Math.min(r.fcr, room, req - held));
        held += r.hold;
      }

      // energia ansiojärjestyksessä
      let need = demand * 1.02 - fixed - res.filter((r) => r.kind === "unit").reduce((a, r) => a + r.lo, 0);
      const offers = res.filter((r) => r.kind === "unit" || r.kind === "link" || r.kind === "batt").sort((a, b) => a.cost - b.cost);
      let price = 0;
      if (need > 0) {
        for (const r of offers) {
          if (need <= 0) break;
          const avail = upRoom(r);
          if (avail <= 0) continue;
          const take = Math.min(avail, need);
          r.p = (r.kind === "unit" ? r.p : Math.max(0, r.p)) + take;
          need -= take;
          price = r.cost;
        }
        if (need > 0) {
          // reservit käyttöön ennen kuin kuormaa irrotetaan (myös akun varapuolisko)
          for (const r of offers) {
            if (need <= 0) break;
            if (!r.hold) continue;
            const take = Math.min(r.hold, need, r.hi - r.p);
            if (take <= 0) continue;
            r.p += take;
            r.hold -= take;
            need -= take;
            price = Math.max(price, r.cost);
          }
        }
        if (need > 0) { out.unserved = Math.min(demand, need / 1.02); out.unservedCap = out.unserved; price = ECON.unservedPenalty; }
      } else {
        // ylijäämä: vienti, akkujen lataus, uusiutuvien leikkaus
        let surplus = -need;
        for (const r of res.filter((x) => x.kind === "link").sort((a, b) => b.cost - a.cost)) {
          const take = Math.min(surplus, -r.lo);
          r.p = -take;
          surplus -= take;
        }
        for (const r of res.filter((x) => x.kind === "batt")) {
          const take = Math.min(surplus, -r.lo);
          r.p = -take;
          surplus -= take;
        }
        for (const r of res.filter((x) => x.kind === "renew")) {
          const take = Math.min(surplus, r.p);
          r.p -= take;
          out.curtailed += take;
          surplus -= take;
        }
        price = 0;
      }

      // vienti, kun oma tuotanto on halvempaa kuin naapurin hinta
      for (const link of res.filter((r) => r.kind === "link" && r.p <= 0)) {
        for (const r of offers) {
          if (r === link || r.kind === "link" || r.cost >= link.cost - 2) continue;
          const start = r.kind === "unit" ? r.p : Math.max(0, r.p);
          const take = Math.min(upRoom(r), link.l.mw + link.p);
          if (take <= 0) continue;
          r.p = start + take;
          link.p -= take;
        }
      }
      // akkujen lataus halvalla
      for (const b of res.filter((r) => r.kind === "batt" && r.p === 0)) {
        if (price > b.bid) continue;
        for (const r of offers) {
          if (r.kind === "batt" || r.cost >= b.bid) continue;
          const start = r.kind === "unit" ? r.p : Math.max(0, r.p);
          const take = Math.min(upRoom(r), -b.lo + b.p);
          if (take <= 0) continue;
          r.p = start + take;
          b.p -= take;
        }
      }

      // tulokset
      out.price = price;
      out.resources = res;
      for (const r of res) {
        if (r.kind === "unit") {
          r.u.p = r.p;
          add(r.bus, r.p);
          gen(r.u.type, r.p);
          out.fuelCost += r.p * r.cost;
          out.co2 += r.p * UNITS[r.u.type].co2;
          if (r.u.type === "hydro") S.hydro[r.bus].res = Math.max(0, S.hydro[r.bus].res - r.p * dtH);
          out.reserve += Math.max(0, Math.min(r.fcr, r.pmax - r.p));
        } else if (r.kind === "renew") {
          r.u.p = r.p;
          add(r.bus, r.p);
          gen(r.u.type, r.p);
        } else if (r.kind === "batt") {
          const T = UNITS.battery;
          r.u.p = r.p;
          r.u.soc = Math.max(0, Math.min(r.u.mw * T.storageHours, r.u.soc - (r.p > 0 ? r.p : r.p * T.efficiency) * dtH));
          add(r.bus, r.p);
          gen("battery", r.p);
          // reservinä se, minkä akku jaksaa syöttää 15 minuuttia
          out.reserve += Math.max(0, Math.min(r.u.mw - Math.max(0, r.p), r.u.soc / 0.25));
        } else if (r.kind === "link") {
          r.l.p = r.p;
          r.l.price = r.cost;
          add(r.bus, r.p);
          if (r.p > 0) out.importCost += r.p * r.cost;
          else out.exportRevenue += -r.p * r.cost;
          gen(r.p >= 0 ? "import" : "export", r.p);
          out.reserve += r.fcr;
        }
      }
      if (out.nordic) out.reserve += NORDIC_FCR * 0.25;
      // liukuva keskihinta akkujen strategiaa varten
      if (demand > 0) S.priceAvg = S.priceAvg + (Math.min(price, 300) - S.priceAvg) * Math.min(1, dtH / 24);
      out.unserved += shedMW;
      out.unservedFreq = shedMW;
      return out;
    }

    // ---------- Pullonkaulat ----------
    // Pullonkaulan hallinta: siirretään tuotantoa linjan "lähettävältä" puolelta "vastaanottavalle".
    // Jos vastaanottavalla puolella ei ole säätövaraa, irrotetaan kuormaa hallitusti (kuten
    // kantaverkkoyhtiö tekisi) ja käynnistetään alueen nopeat voimalat heti.
    relieveCongestion(r, inj, flows, servedAt) {
      const isl = r.island;
      const n = isl.buses.length;
      const L = isl.lines;
      if (!L.length) return;
      const limits = this.netLines.map((l) => l.limit);
      const rowOf = new Map(L.map((li, k) => [li, k]));
      const ptdf = (li, bus) => isl.ptdf[rowOf.get(li) * n + isl.local.get(bus)];
      const sheds = isl.towns.map((b) => ({ kind: "shed", bus: b, p: 0, hi: servedAt[b] }));
      this.reliefExits = this.reliefExits || new Map();

      // Etsii parhaan siirron (alas lähettävällä puolella, ylös/irrotus vastaanottavalla) johdolle `worst`.
      // Jokaista paria rajoittaa muiden lähes täysien johtojen vapaa siirtokyky.
      const plan = (worst) => {
        const dir = Math.sign(flows[worst]);
        const sens = (bus) => dir * ptdf(worst, bus);
        const near = L.filter((li) => li !== worst && Math.abs(flows[li]) > limits[li] * 0.6);
        const downs = [], ups = [];
        for (const x of r.resources) {
          const s = sens(x.bus);
          const roomDown = x.p - (x.kind === "renew" ? 0 : x.lo);
          const roomUp = x.hi - x.p;
          if (roomDown > 0.5) downs.push({ x, s, room: roomDown });
          // minimiteholla ajava voimala voidaan ajaa kokonaan alas (ei kaukolämpö-CHP:tä)
          else if (x.kind === "unit" && x.p > 0.5 && !UNITS[x.u.type].heatDriven) downs.push({ x, s, room: x.p, decommit: true });
          if (roomUp > 0.5) ups.push({ x, s, room: roomUp, shed: false });
        }
        for (const x of sheds) if (x.hi - x.p > 0.5) ups.push({ x, s: sens(x.bus), room: x.hi - x.p, shed: true });
        downs.sort((a, b) => b.s - a.s);
        const excess = Math.abs(flows[worst]) - limits[worst] * 0.99;
        const tryPairs = (allowShed) => {
          let best = null;
          const cand = ups.filter((u) => u.shed === allowShed).sort((a, b) => a.s - b.s).slice(0, 24);
          for (const d of downs.slice(0, 24)) {
            for (const u of cand) {
              const eff = d.s - u.s;
              if (eff < 0.02) continue;
              let shift = Math.min(excess / eff, d.room, u.room);
              for (const li of near) {
                const df = ptdf(li, u.x.bus) - ptdf(li, d.x.bus);
                if (Math.abs(df) < 1e-6) continue;
                const f = flows[li], lim = limits[li] * 0.995;
                const fNew = f + df * shift;
                if (Math.abs(fNew) > lim && Math.abs(fNew) > Math.abs(f)) {
                  const bound = df > 0 ? (lim - f) / df : (-lim - f) / df;
                  shift = Math.max(0, Math.min(shift, bound));
                }
              }
              const gain = shift * eff;
              if (gain > 0.05 && (!best || gain > best.gain)) best = { d, u, shift, gain, sens };
            }
          }
          return best;
        };
        let best = tryPairs(false);
        if (!best || best.gain < Math.min(excess, 5) * 0.5) {
          const viaShed = tryPairs(true);
          if (viaShed && (!best || viaShed.gain > best.gain)) best = viaShed;
        }
        return best;
      };

      const blocked = new Set();
      for (let iter = 0; iter < 80; iter++) {
        const over = L.map((li) => [li, Math.abs(flows[li]) / limits[li]]).filter(([, q]) => q > 1.0005).sort((a, b) => b[1] - a[1]);
        if (!over.length) return;
        let best = null, worst = -1;
        for (const [li, q] of over) {
          if (blocked.has(li)) continue;
          best = plan(li);
          if (best) { worst = li; break; }
          blocked.add(li);
          this.reliefExits.set(li, { why: "stuck", ratio: +q.toFixed(3), t: this.state.t });
        }
        if (!best) return;
        blocked.clear();
        const { d, u, sens } = best;
        let shift = best.shift;
        if (d.decommit) {
          // voimala ajetaan kokonaan alas, ja ajojärjestys jättää sen pois 6 tunniksi
          shift = d.x.p;
          const unit = d.x.u;
          unit.state = "off";
          unit.blockedUntil = this.state.t + 6 * 3600;
          d.x.lo = 0;
          if (!this.decommitLogged || this.state.t - this.decommitLogged > 6 * 3600) {
            this.decommitLogged = this.state.t;
            this.log("info", `${UNITS[unit.type].name} ${this.buses[unit.bus].name} ajettiin alas: sen sähköä ei saa siirrettyä täysien johtojen yli.`, { severity: "mid" });
          }
        }
        d.x.p -= shift;
        u.x.p += shift;
        for (const [o, delta] of [[d.x, -shift], [u.x, shift]]) {
          if (o.u) o.u.p = o.p;
          if (o.l) o.l.p = o.p;
          inj[o.bus] += delta;
        }
        for (const li of L) flows[li] += (ptdf(li, u.x.bus) - ptdf(li, d.x.bus)) * shift;
        if (u.shed) {
          servedAt[u.x.bus] -= shift;
          r.unserved += shift;
          r.unservedCong = (r.unservedCong || 0) + shift;
          this.emergencyStart(isl, (bus) => sens(bus) < d.s - 0.02);
          if (!this.congestionShedLogged || this.state.t - this.congestionShedLogged > 6 * 3600) {
            this.congestionShedLogged = this.state.t;
            const l = this.state.lines[worst];
            this.log("shed", `Johto ${this.buses[l.a].name}–${this.buses[l.b].name} on täynnä: kuormaa irrotettiin hallitusti (${this.buses[u.x.bus].name}).`, { severity: "mid" });
          }
        }
      }
      this.reliefExits.set(-1, { why: "max-iter", t: this.state.t });
    }

    // Käynnistää heti nopeat voimalat alueella, joka tarvitsee tehoa
    emergencyStart(isl, inArea) {
      for (const u of isl.units) {
        const T = UNITS[u.type];
        if (!T.weather && u.type !== "battery" && inArea(u.bus)) {
          // pidetään päällä vähintään 6 h, ettei ajojärjestys sammuta sitä heti uudelleen
          u.keepUntil = this.state.t + 6 * 3600;
          if (u.state === "off" && u.mode !== "off" && T.startHours <= 0.5) {
            u.state = T.startHours > 0 ? "starting" : "online";
            u.left = T.startHours * 3600;
            u.upT = 0;
          }
        }
      }
    }

    // Ylikuormasuoja: korkeintaan yksi johto laukeaa per askel (pahin), jolloin
    // seuraavan askeleen tehonjako ehtii reagoida ennen kuin muut laukeavat.
    checkOverloads(flows, dt) {
      const S = this.state;
      let worst = null;
      S.lines.forEach((l, i) => {
        if (l.state !== "in") return;
        const q = Math.abs(flows[i]) / LINES[l.kv].limit;
        if (q > 1.001) l.overloadT += dt;
        else l.overloadT = Math.max(0, l.overloadT - dt);
        const tripNow = (q > 1.3 && l.overloadT >= 30) || (q > 1.001 && l.overloadT >= 20 * 60);
        if (tripNow && (!worst || q > worst.q)) worst = { l, i, q };
      });
      if (worst) this.tripLine(worst.l, flows[worst.i], "ylikuorma");
    }

    // ---------- Viat ----------
    randomFaults(dt, st) {
      const S = this.state;
      for (const u of S.units) {
        if (u.state !== "online" || !u.p) continue;
        const rate = UNITS[u.type].tripsPerYear;
        if (rate && rng(S) < (rate * dt) / YEAR_S) this.tripUnit(u);
      }
      S.lines.forEach((l, i) => {
        if (l.state !== "in") return;
        const a = this.buses[l.a], b = this.buses[l.b];
        const wind = Math.max(st[a.station].wind, st[b.station].wind);
        const storm = wind > 20 ? 25 : wind > 16 ? 5 : 1;
        const rate = (LINES[l.kv].faultsPer100kmYear * l.km) / 100 * storm;
        if (rng(S) < (rate * dt) / YEAR_S) {
          if (rng(S) < 0.7) {
            this.log("info", `Salamanisku tai puu johdolla ${a.name}–${b.name}: pikajälleenkytkentä onnistui.`);
          } else {
            this.tripLine(l, this.live.flows ? this.live.flows[i] : 0, storm > 1 ? "myrskyvaurio" : "vika");
          }
        }
      });
      for (const l of S.links) {
        if (l.state === "in" && rng(S) < (LINK.tripsPerYear * dt) / YEAR_S) {
          l.state = "out";
          l.left = LINK.repairDays * 86400;
          const lost = l.p || 0;
          this.log("trip", `Ulkomaanyhteys ${this.linkDefs[l.def].name} laukesi (${Math.round(lost)} MW)!`, { severity: "high" });
          this.topoDirty = true;
          if (lost > 0) this.frequencyEvent(l.bus, lost, `${this.linkDefs[l.def].name} laukesi`);
          l.p = 0;
        }
      }
    }

    tripUnit(u) {
      const lost = u.p;
      const T = UNITS[u.type];
      u.state = "tripped";
      u.left = T.repairDays * 86400 * (0.5 + rng(this.state));
      u.p = 0;
      this.log("trip", `${T.name} ${u.mw} MW (${this.buses[u.bus].name}) laukesi verkosta – ${Math.round(lost)} MW katosi hetkessä!`, { severity: lost > 300 ? "high" : "mid" });
      this.frequencyEvent(u.bus, lost, `${T.short} ${this.buses[u.bus].name} laukesi`);
    }

    tripLine(l, flow, why) {
      l.state = "out";
      l.left = LINES[l.kv].repairHours * 3600 * (0.5 + rng(this.state));
      l.overloadT = 0;
      const a = this.buses[l.a], b = this.buses[l.b];
      this.log("trip", `Johto ${a.name}–${b.name} irtosi verkosta (${why}).`, { severity: "mid" });
      this.topoDirty = true;
      // jos johto oli ainoa yhteys, vastaanottava pää menettää tuonnin
      this.rebuildTopology();
      const recv = flow > 0 ? l.b : l.a;
      const lostIsl = this.topo.islands[this.topo.busIsland[recv]];
      const sendIsl = this.topo.islands[this.topo.busIsland[flow > 0 ? l.a : l.b]];
      if (lostIsl && lostIsl !== sendIsl && Math.abs(flow) > 1) this.frequencyEvent(recv, Math.abs(flow), `johto ${a.name}–${b.name}`);
    }

    // ---------- Taajuus ----------
    // Simuloi taajuuden 60 s häiriön jälkeen: heilahtelu­yhtälö + taajuusreservien vaste + kuorman irrotus
    frequencyTransient(isl, lost) {
      let E = 0, load = 0;
      const reserves = [];
      for (const u of isl.units) {
        const T = UNITS[u.type];
        if (u.state !== "online" && !(u.type === "battery" && u.state !== "tripped")) continue;
        if (T.H) E += T.H * u.mw;
        const head = u.type === "battery" ? u.mw - Math.max(0, u.p) : Math.min(T.fcr * u.mw, u.mw - u.p);
        if (T.fcr && head > 0 && (u.type !== "battery" || u.soc > 1)) reserves.push({ r: head, T: T.fcrT, out: 0 });
      }
      for (const b of isl.towns) load += (this.live.demandAt ? this.live.demandAt[b] : 0) || 0;
      const nordic = isl.links.some((l) => l.state === "in" && l.ac);
      if (nordic) { E += NORDIC_INERTIA; reserves.push({ r: NORDIC_FCR, T: 6, out: 0 }); }
      for (const l of isl.links) if (l.state === "in" && !l.ac) reserves.push({ r: Math.min(200, l.mw * 0.1), T: 1, out: 0 });
      E = Math.max(E, 50);
      let f = 50, nadir = 50, shed = 0, stage = 0, collapse = false;
      const trace = [];
      const dt = 0.02;
      const rocof = (-50 * lost) / (2 * E);
      for (let i = 0; i <= 60 / dt; i++) {
        const act = Math.max(0, Math.min(1, (49.9 - f) / 0.4)) + Math.max(-0.1, Math.min(0.1, (50 - f) / 0.1)) * 0.1;
        let resp = 0;
        for (const r of reserves) { r.out += ((r.r * act - r.out) * dt) / Math.max(0.05, r.T); resp += r.out; }
        const damping = load * 1.5 * ((f - 50) / 50);
        const imbalance = resp - lost + shed - damping;
        f += ((50 * imbalance) / (2 * E)) * dt;
        while (stage < UFLS.length && f < UFLS[stage]) { shed += load * 0.08; stage++; }
        if (f < 47.5) { collapse = true; f = 47.5; }
        nadir = Math.min(nadir, f);
        if (i % 10 === 0) trace.push(+f.toFixed(4));
        if (collapse) break;
      }
      return { nadir, shed: Math.min(shed, load), collapse, trace, rocof, inertia: E, load };
    }

    frequencyEvent(bus, lost, label) {
      if (this.topoDirty) this.rebuildTopology();
      const isl = this.topo.islands[this.topo.busIsland[bus]];
      if (!isl || lost <= 0) return;
      const r = this.frequencyTransient(isl, lost);
      const S = this.state;
      const nadirTxt = r.nadir.toFixed(2).replace(".", ",");
      let text, severity = "mid";
      if (r.collapse) {
        text = `SÄHKÖKATKO! ${label}: taajuus romahti, koko saareke pimeni.`;
        this.shedState = { buses: new Set(isl.buses), frac: 1, until: S.t + 45 * 60 };
        severity = "high";
      } else if (r.shed > 0) {
        text = `${label}: taajuus putosi ${nadirTxt} Hz:iin, automaattinen kuormanirrotus irrotti ${Math.round(r.shed)} MW.`;
        this.shedState = { buses: new Set(isl.buses), frac: r.shed / Math.max(1, r.load), until: S.t + 20 * 60 };
        severity = "high";
      } else {
        text = `${label}: taajuus kävi ${nadirTxt} Hz:ssä, reservit pelastivat tilanteen.`;
        severity = r.nadir < 49.5 ? "mid" : "low";
      }
      this.log("freq", text, { trace: r.trace, nadir: r.nadir, rocof: r.rocof, severity });
      this.lastTrace = { t0: S.t, trace: r.trace };
    }

    frequencyNow(t) {
      if (this.lastTrace && t - this.lastTrace.t0 < 60) {
        const i = Math.min(this.lastTrace.trace.length - 1, Math.floor((t - this.lastTrace.t0) / 0.2));
        return this.lastTrace.trace[i];
      }
      const main = this.mainIsland();
      if (!main) return 50;
      const noise = Math.sin(t / 47) * 0.6 + Math.sin(t / 13 + 1) * 0.3 + Math.sin(t / 5.3 + 2) * 0.1;
      if (main.nordic) return 50 + noise * 0.05;
      const adequacy = main.reserveReq > 0 ? Math.min(1, main.reserve / main.reserveReq) : 1;
      const lowInertia = main.inertia < 2000 ? 0.05 : 0;
      if (main.unserved > 0.5) return 49.0 - Math.min(0.6, main.unserved / Math.max(1, main.demand)) + noise * 0.05;
      return 50 + noise * (0.02 + 0.08 * (1 - adequacy) + lowInertia);
    }

    mainIsland() {
      let best = null;
      for (const r of this.live.islands || []) if (!best || r.demand > best.demand) best = r;
      return best;
    }

    // ---------- N-1 ----------
    securityCheck(flows) {
      const out = [];
      if (!this.topo) return out;
      const limits = this.netLines.map((l) => l.limit);
      for (const r of this.live.islands || []) {
        const isl = r.island;
        if (!isl.hasSupply || r.demand <= 0) continue;
        for (const v of N.contingencyCheck(isl, this.netLines, flows, limits)) {
          const k = this.state.lines[v.outage];
          if (v.islanding) {
            // irtoaako osa, jossa on kuormaa mutta ei tuotantoa?
            const side = N.sideWithout(this.topo.adj, k.a, v.outage);
            const other = side.has(k.b) ? null : side;
            if (!other) continue;
            const partA = [...other], partB = isl.buses.filter((b) => !other.has(b));
            const lineName = `${this.buses[k.a].name}–${this.buses[k.b].name}`;
            for (const part of [partA, partB]) {
              const towns = part.filter((b) => this.buses[b].kind === "town");
              const units = isl.units.filter((u) => part.includes(u.bus) && u.state !== "tripped");
              const links = isl.links.filter((l) => part.includes(l.bus));
              if (!towns.length) continue;
              if (!units.length && !links.length) {
                out.push({ kind: "radial", line: v.outage, text: `Jos johto ${lineName} katkeaa, ${towns.map((b) => this.buses[b].name).join(", ")} jää pimeäksi.` });
                continue;
              }
              // tuontia osaan: riittävätkö sen omat reservit, kun tuonti katkeaa?
              const imported = part.includes(k.b) ? flows[v.outage] : -flows[v.outage];
              if (imported > 5) {
                const tr = this.frequencyTransient({ units, links, towns }, imported);
                if (tr.collapse || tr.shed > 0) {
                  out.push({ kind: "import", line: v.outage, text: `Jos johto ${lineName} katkeaa, ${this.buses[towns[0]].name}${towns.length > 1 ? " ym." : ""} menettää ${Math.round(imported)} MW tuonnin ja ${tr.collapse ? "pimenee" : "joutuu irrottamaan kuormaa"}.` });
                }
              }
            }
          } else {
            const l = this.state.lines[v.line];
            out.push({ kind: "overload", line: v.outage, over: v.line, text: `Jos ${this.buses[k.a].name}–${this.buses[k.b].name} katkeaa, ${this.buses[l.a].name}–${this.buses[l.b].name} ylikuormittuu (${Math.round((Math.abs(v.flowAfter) / v.limit) * 100)} %).` });
          }
        }
        // suurimman tuotantoyksikön menetys
        let worst = null;
        for (const u of isl.units) if (u.state === "online" && (!worst || u.p > worst.p)) worst = u;
        if (worst && worst.p > 5) {
          const tr = this.frequencyTransient(isl, worst.p);
          if (tr.collapse || tr.shed > 0) {
            out.push({ kind: "unit", unit: worst.id, text: `Jos ${UNITS[worst.type].name} ${this.buses[worst.bus].name} (${Math.round(worst.p)} MW) laukeaa, taajuus putoaa ${tr.nadir.toFixed(2).replace(".", ",")} Hz:iin ja kuormaa irtoaa.` });
          }
        }
      }
      return out.slice(0, 40);
    }

    // ---------- Tilastot ----------
    dayAccumulate(rev, cost, served, unserved, co2) {
      const S = this.state;
      const day = Math.floor(S.t / 86400);
      let d = S.daily[S.daily.length - 1];
      if (!d || d.day !== day) {
        d = { day, rev: 0, cost: 0, served: 0, unserved: 0, co2: 0, money: S.money };
        S.daily.push(d);
        if (S.daily.length > 400) S.daily.shift();
        S.stats.days++;
      }
      d.rev += rev; d.cost += cost; d.served += served; d.unserved += unserved; d.co2 += co2; d.money = S.money;
    }

    sample() {
      const S = this.state, m = this.mainIsland();
      const gen = {};
      for (const r of this.live.islands) for (const [k, v] of Object.entries(r.gen)) gen[k] = (gen[k] || 0) + v;
      S.history.push({
        t: S.t, demand: this.live.totalServed + this.live.totalUnserved, unserved: this.live.totalUnserved,
        gen: Object.fromEntries(Object.entries(gen).map(([k, v]) => [k, Math.round(v)])),
        f: +this.live.freq.toFixed(3), price: m ? Math.round(m.price) : 0, money: Math.round(S.money),
      });
      if (S.history.length > 7 * 96) S.history.shift();
      // tavoitteiden putket (näyte 15 min välein = 0,25 h)
      const st = S.stats, served = this.live.totalServed;
      const n1ok = served > 0 && (this.live.n1 || []).length === 0;
      st.n1Streak = n1ok ? (st.n1Streak || 0) + 0.25 : 0;
      st.n1Best = Math.max(st.n1Best || 0, st.n1Streak);
      const fossil = ["coal", "ccgt", "ocgt", "diesel", "chp"].reduce((a, k) => a + Math.max(0, gen[k] || 0), 0);
      const ff = served > 0 && fossil < 0.5 && this.live.totalUnserved < 0.5;
      st.fossilFreeStreak = ff ? (st.fossilFreeStreak || 0) + 0.25 : 0;
      st.fossilFreeBest = Math.max(st.fossilFreeBest || 0, st.fossilFreeStreak);
    }

    // ---------- Tallennus ----------
    serialize() { return JSON.stringify(this.state); }
    static restore(data, json) {
      const sim = new Sim(data, JSON.parse(json));
      sim.lastUC = sim.lastSample = sim.lastN1 = -1e9;
      return sim;
    }
  }

  G.fmtMoney = (v) => {
    const a = Math.abs(v), s = v < 0 ? "−" : "";
    if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2).replace(".", ",")} mrd €`;
    if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1).replace(".", ",")} M€`;
    if (a >= 1e3) return `${s}${Math.round(a / 1e3)} k€`;
    return `${s}${Math.round(a)} €`;
  };
  G.Sim = Sim;
})(typeof window !== "undefined" ? window : globalThis);
