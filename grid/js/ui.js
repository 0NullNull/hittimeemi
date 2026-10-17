// 50 Hz – käyttöliittymä: kartta, kojelauta, rakentaminen ja tapahtumat.
(function (root) {
  const G = root.GridGame;
  const { UNITS, LINES, UNLOCKS } = G.Tech;
  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 0 });
  const mw = (v) => `${nf.format(Math.round(v))} MW`;
  const dec = (v, d = 1) => v.toFixed(d).replace(".", ",");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const SPEEDS = [
    { s: 0, label: "⏸" }, { s: 1, label: "1×" }, { s: 60, label: "1 min/s" }, { s: 600, label: "10 min/s" },
    { s: 3600, label: "1 h/s" }, { s: 21600, label: "6 h/s" }, { s: 86400, label: "1 pv/s" },
  ];
  const TOOLS = [
    { id: "select", label: "Valitse" },
    { id: "110", label: "110 kV", color: LINES[110].color },
    { id: "220", label: "220 kV", color: LINES[220].color },
    { id: "400", label: "400 kV", color: LINES[400].color },
    { id: "demolish", label: "Purku" },
  ];
  const LINK_TARGETS = { "Ruotsi (AC)": [65.95, 22.6, "RUOTSI"], "Fenno-Skan": [60.95, 19.6, "RUOTSI"], "Estlink": [59.5, 24.75, "VIRO"] };
  const STACK = ["nuclear", "hydro", "chp", "coal", "ccgt", "ocgt", "diesel", "wind", "solar", "battery", "import"];
  const STACK_COLORS = { ...Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v.color])), import: "#22d3ee", export: "#0e7490" };
  const STACK_NAMES = { ...Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v.short])), import: "Tuonti", export: "Vienti" };
  const FOSSIL = ["coal", "ccgt", "ocgt", "diesel", "chp"];

  const loadColor = (q) => (q > 1.001 ? "#ef4444" : q > 0.9 ? "#f97316" : q > 0.7 ? "#fbbf24" : "#34d399");
  const stateText = (u) => ({
    building: `Rakenteilla, ${Math.ceil(u.left / 86400)} pv`, off: "Valmiustila", starting: "Käynnistyy",
    online: "Käynnissä", tripped: `Laukesi, korjaus ${Math.ceil(u.left / 3600)} h`, refuel: `Vuosihuolto, ${Math.ceil(u.left / 86400)} pv`,
  }[u.state] || u.state);

  class UI {
    constructor(app) {
      this.app = app;
      this.canvas = $("map");
      this.ctx = this.canvas.getContext("2d");
      this.tool = "select";
      this.sel = null;          // { kind: "bus"|"line", id }
      this.hover = null;
      this.lineStart = null;
      this.view = { zoom: 1, ox: 0, oy: 0 };
      this.mouse = null;
      this.lastPanel = 0;
      this.tab = "events";
      this.toastQueue = [];
      this.lastToast = 0;
      this.buildStatic();
      this.bind();
    }

    get sim() { return this.app.sim; }

    // ---------- Staattinen ----------
    buildStatic() {
      const sp = $("speeds");
      sp.innerHTML = SPEEDS.map((x, i) => `<button data-i="${i}" title="Pikanäppäin ${i}">${x.label}</button>`).join("");
      sp.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) this.app.setSpeed(+b.dataset.i); });
      const tb = $("toolbar");
      tb.innerHTML = TOOLS.map((t) => `<button data-tool="${t.id}">${t.color ? `<i style="height:${t.id === "400" ? 4 : t.id === "220" ? 3 : 2}px;background:${t.color}"></i>` : ""}${t.label}</button>`).join("");
      tb.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) this.setTool(b.dataset.tool); });
      document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
        this.tab = b.dataset.tab;
        document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
        this.renderTabs(true);
      }));
      $("btn-help").addEventListener("click", () => $("dlg-help").showModal());
      $("btn-menu").addEventListener("click", () => $("dlg-menu").showModal());
      this.legendBuilt = false;
    }

    setSimStatic() {
      const sim = this.sim;
      this.outline = sim.data.world.outline.map((ring) => ring.map(([lon, lat]) => G.project(lat, lon)));
      const xs = this.outline[0].map((p) => p.x), ys = this.outline[0].map((p) => p.y);
      this.bounds = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      this.linkGeo = sim.linkDefs.map((d) => {
        const [lat, lon, country] = LINK_TARGETS[d.name] || [d.lat, d.lon, ""];
        return { ...G.project(lat, lon), country };
      });
      $("attribution").innerHTML = sim.data.world.attribution.map(esc).join("<br>");
    }

    setTool(id) {
      if (["220", "400"].includes(id)) {
        const L = LINES[id];
        if (L.unlock && !this.sim.state.unlocked[L.unlock]) { this.toast(UNLOCKS[L.unlock].label, "mid"); return; }
      }
      this.tool = id;
      this.lineStart = null;
      document.querySelectorAll("#toolbar button").forEach((b) => b.classList.toggle("active", b.dataset.tool === id));
      this.canvas.classList.toggle("tool-line", id !== "select");
      this.updateHint();
    }

    updateHint() {
      const h = $("map-hint");
      if (["110", "220", "400"].includes(this.tool)) {
        h.innerHTML = this.lineStart == null
          ? `<b>${LINES[this.tool].name}</b> (${LINES[this.tool].limit} MW): valitse johdon alkupää.`
          : `Valitse loppupää – ${esc(this.sim.buses[this.lineStart].name)} → ? <span class="muted">(Esc peruu)</span>`;
      } else if (this.tool === "demolish") {
        h.innerHTML = "<b>Purku:</b> klikkaa johtoa purkaaksesi sen. Voimalat puretaan kohteen paneelista.";
      } else if (this.sim && this.sim.state.lines.length === 0 && this.sim.state.units.length <= 2) {
        h.innerHTML = "Vinkki: <b>klikkaa kaupunkia</b> nähdäksesi rakennusvaihtoehdot, tai valitse <b>110 kV</b> ja yhdistä naapurikaupunki verkkoosi.";
      } else h.innerHTML = "";
    }

    // ---------- Koordinaatit ----------
    layout() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (this.canvas.width !== Math.round(r.width * dpr) || this.canvas.height !== Math.round(r.height * dpr)) {
        this.canvas.width = Math.round(r.width * dpr);
        this.canvas.height = Math.round(r.height * dpr);
      }
      this.dpr = dpr;
      this.w = r.width;
      this.h = r.height;
      const b = this.bounds, pad = 40;
      const base = Math.min((this.w - pad * 2) / (b.x1 - b.x0), (this.h - pad * 2) / (b.y1 - b.y0));
      this.scale = base * this.view.zoom;
      this.cx = this.w / 2 - ((b.x0 + b.x1) / 2) * this.scale + this.view.ox;
      this.cy = this.h / 2 - ((b.y0 + b.y1) / 2) * this.scale + this.view.oy;
    }
    sx(x) { return this.cx + x * this.scale; }
    sy(y) { return this.cy + y * this.scale; }
    busR(b) { return b.kind === "town" ? 3 + Math.sqrt(b.pop) / 95 : 6; }

    // ---------- Kartan piirto ----------
    render(now) {
      if (!this.sim || !this.bounds) return;
      this.layout();
      const c = this.ctx, sim = this.sim, S = sim.state, live = sim.live;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.w, this.h);

      // naapurimaat ja meret
      c.font = "600 12px Inter, sans-serif";
      c.fillStyle = "rgba(138,148,173,0.35)";
      c.textAlign = "center";
      for (const [lat, lon, txt] of [[66.6, 21.2, "RUOTSI"], [62.2, 20.2, "Pohjanlahti"], [59.6, 26.2, "Suomenlahti"], [63.2, 31.6, "VENÄJÄ"], [69.6, 22.6, "NORJA"]]) {
        const p = G.project(lat, lon);
        c.fillText(txt, this.sx(p.x), this.sy(p.y));
      }

      // Suomi
      c.beginPath();
      for (const ring of this.outline) {
        ring.forEach((p, i) => (i ? c.lineTo(this.sx(p.x), this.sy(p.y)) : c.moveTo(this.sx(p.x), this.sy(p.y))));
        c.closePath();
      }
      c.fillStyle = "#121a2e";
      c.fill();
      c.strokeStyle = "#2b3757";
      c.lineWidth = 1.2;
      c.stroke();

      // ulkomaanyhteydet
      sim.linkDefs.forEach((d, i) => {
        const b = sim.buses[d.bus], g = this.linkGeo[i];
        const built = S.links.find((l) => l.def === i);
        const x1 = this.sx(b.x), y1 = this.sy(b.y), x2 = this.sx(g.x), y2 = this.sy(g.y);
        c.setLineDash(built && built.state === "in" ? [] : [4, 5]);
        c.strokeStyle = built ? (built.state === "in" ? "#22d3ee" : "#64748b") : "rgba(34,211,238,0.25)";
        c.lineWidth = built ? 3 : 1.5;
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
        c.setLineDash([]);
        c.fillStyle = built ? "#22d3ee" : "rgba(34,211,238,0.45)";
        c.font = "600 11px Inter, sans-serif";
        c.fillText(`${d.name}${built && built.state === "in" ? ` ${built.p >= 0 ? "▶" : "◀"} ${mw(Math.abs(built.p || 0))}` : ""}`, x2, y2 - 6);
        if (built && built.state === "in" && Math.abs(built.p) > 1) this.flowDots(x2, y2, x1, y1, built.p >= 0 ? 1 : -1, Math.min(1, Math.abs(built.p) / built.mw), now, 3);
      });

      // johdot
      const flows = live.flows || [];
      S.lines.forEach((l, i) => {
        const a = sim.buses[l.a], b = sim.buses[l.b];
        const x1 = this.sx(a.x), y1 = this.sy(a.y), x2 = this.sx(b.x), y2 = this.sy(b.y);
        // rinnakkaiset johdot siirretään vähän sivuun
        const twins = S.lines.filter((o) => (o.a === l.a && o.b === l.b) || (o.a === l.b && o.b === l.a));
        const k = twins.indexOf(l) - (twins.length - 1) / 2;
        const nx = -(y2 - y1), ny = x2 - x1, nl = Math.hypot(nx, ny) || 1;
        const off = k * 5;
        const X1 = x1 + (nx / nl) * off, Y1 = y1 + (ny / nl) * off, X2 = x2 + (nx / nl) * off, Y2 = y2 + (ny / nl) * off;
        const width = l.kv === 400 ? 4.5 : l.kv === 220 ? 3.2 : 2.2;
        const q = l.state === "in" ? Math.abs(flows[i] || 0) / LINES[l.kv].limit : 0;
        const selected = this.sel && this.sel.kind === "line" && this.sel.id === l.id;
        const n1 = (live.n1 || []).some((v) => v.line === i || v.over === i);
        if (selected || (this.hover && this.hover.kind === "line" && this.hover.id === l.id)) {
          c.strokeStyle = "rgba(34,211,238,0.35)"; c.lineWidth = width + 8;
          c.beginPath(); c.moveTo(X1, Y1); c.lineTo(X2, Y2); c.stroke();
        }
        c.setLineDash(l.state === "building" ? [6, 6] : l.state === "out" ? [3, 4] : []);
        c.strokeStyle = l.state === "building" ? "#64748b" : l.state === "out" ? "#ef4444" : loadColor(q);
        c.lineWidth = width;
        c.beginPath(); c.moveTo(X1, Y1); c.lineTo(X2, Y2); c.stroke();
        c.setLineDash([]);
        if (n1 && this.tab === "n1") {
          c.strokeStyle = "rgba(239,68,68,0.6)"; c.lineWidth = 1;
          c.beginPath(); c.moveTo(X1, Y1); c.lineTo(X2, Y2); c.stroke();
        }
        if (l.state === "in" && Math.abs(flows[i] || 0) > 1) this.flowDots(X1, Y1, X2, Y2, Math.sign(flows[i]), Math.min(1.3, q), now, width);
      });

      // johdon esikatselu
      if (this.lineStart != null && this.mouse) {
        const a = sim.buses[this.lineStart];
        const target = this.hover && this.hover.kind === "bus" ? sim.buses[this.hover.id] : null;
        const x2 = target ? this.sx(target.x) : this.mouse.x, y2 = target ? this.sy(target.y) : this.mouse.y;
        c.setLineDash([8, 6]);
        c.strokeStyle = LINES[this.tool].color;
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(this.sx(a.x), this.sy(a.y)); c.lineTo(x2, y2); c.stroke();
        c.setLineDash([]);
      }

      // väylät
      const pulse = 0.5 + 0.5 * Math.sin(now / 250);
      for (const b of sim.buses) {
        const x = this.sx(b.x), y = this.sy(b.y), r = this.busR(b);
        const units = S.units.filter((u) => u.bus === b.i);
        const connected = b.kind === "town" && S.connected[b.i] && live.demandAt && live.demandAt[b.i] > 0;
        const servedQ = connected ? live.servedAt[b.i] / live.demandAt[b.i] : 1;
        // kapasiteettirengas
        if (units.length) {
          const total = units.reduce((a, u) => a + u.mw, 0);
          let ang = -Math.PI / 2;
          for (const u of units) {
            const span = (u.mw / total) * Math.PI * 2;
            c.strokeStyle = u.state === "building" ? "#475569" : u.state === "tripped" ? "#ef4444" : UNITS[u.type].color;
            c.globalAlpha = u.state === "online" || UNITS[u.type].weather || u.type === "battery" ? 1 : 0.55;
            c.lineWidth = 3.5;
            c.beginPath(); c.arc(x, y, r + 4, ang + 0.05, ang + span - 0.05); c.stroke();
            ang += span;
          }
          c.globalAlpha = 1;
        }
        // itse väylä
        c.beginPath();
        if (b.kind === "hydro") {
          c.moveTo(x, y - r - 1); c.lineTo(x + r, y + 2); c.arc(x, y + 2, r * 0.75, 0, Math.PI); c.closePath();
          c.fillStyle = units.length ? "#38bdf8" : "rgba(56,189,248,0.18)";
          c.strokeStyle = "#38bdf8";
        } else if (b.kind === "nuclear") {
          for (let k = 0; k < 6; k++) { const a2 = (Math.PI / 3) * k; c[k ? "lineTo" : "moveTo"](x + Math.cos(a2) * r, y + Math.sin(a2) * r); }
          c.closePath();
          c.fillStyle = units.length ? "#a78bfa" : "rgba(167,139,250,0.18)";
          c.strokeStyle = "#a78bfa";
        } else {
          c.arc(x, y, r, 0, Math.PI * 2);
          if (!connected) { c.fillStyle = "#1c2438"; c.strokeStyle = "#4b5875"; }
          else if (servedQ < 0.05) { c.fillStyle = `rgba(239,68,68,${0.5 + pulse * 0.5})`; c.strokeStyle = "#ef4444"; }
          else if (servedQ < 0.999) { c.fillStyle = "#fb923c"; c.strokeStyle = "#f97316"; }
          else { c.fillStyle = "#e2e8f0"; c.strokeStyle = "#ffffff"; }
        }
        c.fill();
        c.lineWidth = 1.2;
        c.stroke();
        // verkon ulottuvilla, mutta ei vielä asiakas: sykkivä keltainen rengas
        if (b.kind === "town" && !S.connected[b.i] && sim.topo) {
          const isl = sim.topo.islands[sim.topo.busIsland[b.i]];
          if (isl && isl.hasSupply) {
            c.setLineDash([3, 3]);
            c.strokeStyle = `rgba(251,191,36,${0.5 + pulse * 0.5})`;
            c.lineWidth = 1.6;
            c.beginPath(); c.arc(x, y, r + 5, 0, Math.PI * 2); c.stroke();
            c.setLineDash([]);
          }
        }
        const isSel = this.sel && this.sel.kind === "bus" && this.sel.id === b.i;
        if (isSel || this.lineStart === b.i) {
          c.strokeStyle = "#22d3ee"; c.lineWidth = 2;
          c.beginPath(); c.arc(x, y, r + 8, 0, Math.PI * 2); c.stroke();
        }
        // nimet
        const showName = b.pop >= 60000 || b.kind !== "town" ? this.view.zoom >= (b.kind === "town" ? 0 : 1.3) : this.view.zoom >= 1.7;
        if (showName || isSel || (this.hover && this.hover.kind === "bus" && this.hover.id === b.i)) {
          c.font = `${b.pop >= 200000 ? 600 : 500} ${b.kind === "town" ? 11.5 : 10.5}px Inter, sans-serif`;
          c.textAlign = "left";
          c.fillStyle = b.kind === "town" ? (connected ? "#e8edf7" : "#8a94ad") : b.kind === "hydro" ? "#7dd3fc" : "#c4b5fd";
          c.fillText(b.name, x + r + 7, y + 4);
        }
      }
    }

    flowDots(x1, y1, x2, y2, dir, q, now, width) {
      const c = this.ctx;
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 12) return;
      const gap = 26;
      const speed = 18 + q * 70;
      const phase = ((now / 1000) * speed) % gap;
      c.fillStyle = "rgba(255,255,255,0.85)";
      for (let d = phase; d < len; d += gap) {
        const k = dir > 0 ? d / len : 1 - d / len;
        c.beginPath();
        c.arc(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, Math.max(1.3, width * 0.45), 0, Math.PI * 2);
        c.fill();
      }
    }

    // ---------- Osumat ----------
    pick(mx, my) {
      const sim = this.sim;
      let best = null, bd = 1e9;
      for (const b of sim.buses) {
        const d = Math.hypot(this.sx(b.x) - mx, this.sy(b.y) - my);
        if (d < this.busR(b) + 7 && d < bd) { bd = d; best = { kind: "bus", id: b.i }; }
      }
      if (best) return best;
      for (const l of sim.state.lines) {
        const a = sim.buses[l.a], b = sim.buses[l.b];
        const x1 = this.sx(a.x), y1 = this.sy(a.y), x2 = this.sx(b.x), y2 = this.sy(b.y);
        const L2 = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((mx - x1) * (x2 - x1) + (my - y1) * (y2 - y1)) / L2));
        const d = Math.hypot(mx - (x1 + t * (x2 - x1)), my - (y1 + t * (y2 - y1)));
        if (d < 6 && d < bd) { bd = d; best = { kind: "line", id: l.id }; }
      }
      return best;
    }

    bind() {
      const cv = this.canvas;
      let down = null;
      cv.addEventListener("mousedown", (e) => { down = { x: e.offsetX, y: e.offsetY, ox: this.view.ox, oy: this.view.oy, moved: false }; });
      window.addEventListener("mouseup", (e) => {
        if (!down) return;
        const wasDrag = down.moved;
        down = null;
        cv.classList.remove("panning");
        if (!wasDrag && e.target === cv) this.click(e.offsetX, e.offsetY);
      });
      cv.addEventListener("mousemove", (e) => {
        this.mouse = { x: e.offsetX, y: e.offsetY };
        if (down) {
          const dx = e.offsetX - down.x, dy = e.offsetY - down.y;
          if (Math.hypot(dx, dy) > 4) down.moved = true;
          if (down.moved) { this.view.ox = down.ox + dx; this.view.oy = down.oy + dy; cv.classList.add("panning"); }
        }
        this.hover = this.pick(e.offsetX, e.offsetY);
        this.showTooltip(e.offsetX, e.offsetY);
      });
      cv.addEventListener("mouseleave", () => { this.hover = null; this.mouse = null; $("tooltip").hidden = true; });
      cv.addEventListener("wheel", (e) => {
        e.preventDefault();
        const z0 = this.view.zoom;
        const z1 = Math.max(0.7, Math.min(7, z0 * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
        // zoomaa kursorin ympäri
        const mx = e.offsetX, my = e.offsetY;
        const wx = (mx - this.cx) / this.scale, wy = (my - this.cy) / this.scale;
        this.view.zoom = z1;
        this.layout();
        this.view.ox += mx - this.sx(wx);
        this.view.oy += my - this.sy(wy);
      }, { passive: false });
      window.addEventListener("keydown", (e) => {
        if (e.target.closest("input, select, textarea") || document.querySelector("dialog[open]")) return;
        if (e.key === "Escape") { this.lineStart ? (this.lineStart = null) : this.setTool("select"); this.updateHint(); }
        if (e.key === " ") { e.preventDefault(); this.app.togglePause(); }
        if (/^[0-6]$/.test(e.key)) this.app.setSpeed(+e.key);
      });
    }

    click(mx, my) {
      const hit = this.pick(mx, my);
      const sim = this.sim;
      if (["110", "220", "400"].includes(this.tool)) {
        if (!hit || hit.kind !== "bus") return;
        if (this.lineStart == null) { this.lineStart = hit.id; this.updateHint(); return; }
        const r = sim.buildLine(this.lineStart, hit.id, +this.tool);
        if (!r.ok) this.toast(r.reason, "mid");
        else { this.lineStart = hit.id; this.panelDirty = true; }
        this.updateHint();
        return;
      }
      if (this.tool === "demolish") {
        if (hit && hit.kind === "line") {
          const l = sim.state.lines.find((x) => x.id === hit.id);
          if (confirm(`Puretaanko johto ${sim.buses[l.a].name}–${sim.buses[l.b].name}?`)) { sim.demolish("line", l.id); this.panelDirty = true; }
        }
        return;
      }
      this.sel = hit;
      this.panelDirty = true;
    }

    showTooltip(mx, my) {
      const tip = $("tooltip"), h = this.hover, sim = this.sim, live = sim.live;
      if (!h) { tip.hidden = true; return; }
      let html = "";
      const row = (a, b, cls = "") => `<div class="row"><span>${a}</span><span class="${cls}">${b}</span></div>`;
      if (h.kind === "bus") {
        const b = sim.buses[h.id];
        const units = sim.state.units.filter((u) => u.bus === b.i && u.state !== "building");
        const genNow = units.reduce((a, u) => a + (u.p > 0 ? u.p : 0), 0);
        html = `<b>${esc(b.name)}</b>`;
        if (b.kind === "town") {
          const d = live.demandAt ? live.demandAt[b.i] : 0;
          html += row("Asukkaita", nf.format(b.pop));
          if (sim.state.connected[b.i] && d > 0) {
            const q = live.servedAt[b.i] / d;
            html += row("Kulutus", mw(d)) + row("Toimitettu", `${Math.round(q * 100)} %`, q < 0.999 ? "bad" : "");
          } else {
            const isl = sim.topo && sim.topo.islands[sim.topo.busIsland[b.i]];
            html += row("Huippukulutus", mw(sim.townPeak(b.i))) + row("Tila", isl && isl.hasSupply ? "Ulottuvilla – liitä paneelista" : "Ei verkossa", "warn");
          }
        } else if (b.kind === "hydro") {
          const used = sim.state.units.filter((u) => u.bus === b.i).reduce((a, u) => a + u.mw, 0);
          const cap = b.maxMW * G.Tech.HYDRO_CF * b.reservoirHours;
          html += row("Rakennettu", `${used} / ${b.maxMW} MW`) + row("Allas", `${Math.round((sim.state.hydro[b.i].res / cap) * 100)} %`);
        } else {
          html += row("Yksiköitä", `${sim.state.units.filter((u) => u.bus === b.i).length} / ${b.maxUnits}`);
        }
        if (units.length) html += row("Tuotanto nyt", mw(genNow));
      } else {
        const i = sim.state.lines.findIndex((l) => l.id === h.id);
        const l = sim.state.lines[i];
        const f = (live.flows || [])[i] || 0;
        html = `<b>${LINES[l.kv].name} ${esc(sim.buses[l.a].name)}–${esc(sim.buses[l.b].name)}</b>`;
        html += row("Pituus", `${Math.round(l.km)} km`);
        if (l.state === "in") html += row("Teho", `${mw(Math.abs(f))} / ${LINES[l.kv].limit}`) + row("Kuormitus", `${Math.round((Math.abs(f) / LINES[l.kv].limit) * 100)} %`, Math.abs(f) > LINES[l.kv].limit ? "bad" : "");
        else if (l.state === "building") html += row("Rakenteilla", `${Math.ceil(l.left / 86400)} pv`);
        else html += row("Irti verkosta", `${Math.ceil(l.left / 3600)} h`, "bad");
      }
      if (this.lineStart != null && h.kind === "bus" && h.id !== this.lineStart) {
        const q = sim.quoteLine(this.lineStart, h.id, +this.tool);
        html += `<hr style="border:0;border-top:1px solid #232d45;margin:6px 0">` + (q.km ? row("Uusi johto", `${Math.round(q.km)} km`) : "") +
          (q.cost ? row("Hinta", G.fmtMoney(q.cost)) : "") + (q.ok ? row("Valmis", `${q.days} pv`) : `<div class="row"><span class="bad">${esc(q.reason)}</span></div>`);
      }
      tip.innerHTML = html;
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = `${Math.min(this.w - tw - 8, mx + 16)}px`;
      tip.style.top = `${Math.min(this.h - th - 8, my + 16)}px`;
    }

    // ---------- Paneelit ----------
    renderPanels(force) {
      const now = performance.now();
      if (!force && now - this.lastPanel < 250) return;
      this.lastPanel = now;
      const sim = this.sim, S = sim.state, live = sim.live;
      const tm = G.formatTime(S.t);
      $("clock-date").textContent = tm.date;
      $("clock-time").textContent = tm.time;
      document.querySelectorAll("#speeds button").forEach((b) => b.classList.toggle("active", +b.dataset.i === this.app.speedIdx));
      $("money").textContent = G.fmtMoney(S.money);
      const yday = S.daily[S.daily.length - 2];
      const mr = $("money-rate");
      if (yday) {
        const p = yday.rev - yday.cost;
        mr.textContent = `${p >= 0 ? "+" : ""}${G.fmtMoney(p)}/pv`;
        mr.className = p >= 0 ? "up" : "down";
      }

      // taajuus
      const f = live.freq || 50;
      const fe = $("freq");
      fe.innerHTML = `${dec(f, 2)} <small>Hz</small>`;
      fe.className = "freq" + (Math.abs(f - 50) > 0.5 ? " bad" : Math.abs(f - 50) > 0.1 ? " warn" : "");
      $("gauge-needle").style.left = `${Math.max(0, Math.min(100, ((f - 49) / 2) * 100))}%`;
      const main = sim.mainIsland();
      const mode = $("freq-mode");
      if (main && main.nordic) { mode.textContent = "Synkroninen: Pohjoismaat"; mode.className = "freq-mode nordic"; }
      else { mode.textContent = (live.islands || []).filter((r) => r.demand > 0).length > 1 ? "Useita saarekkeita" : "Saarekekäyttö"; mode.className = "freq-mode"; }
      $("freq-sub").innerHTML = main
        ? `Hitausmassa <b>${nf.format(Math.round(main.inertia))} MWs</b> · Reservi <b>${Math.round(main.reserve)}</b> / ${Math.round(main.reserveReq)} MW`
        : "Ei verkkoa";

      // tunnusluvut
      let gen = 0, co2 = 0;
      for (const r of live.islands || []) { for (const [k, v] of Object.entries(r.gen)) if (v > 0 && k !== "import") gen += v; co2 += r.co2; }
      const n1 = (live.n1 || []).length;
      const unserved = live.totalUnserved || 0;
      const kpi = (label, value, cls = "") => `<div class="kpi"><span>${label}</span><b class="${cls}">${value}</b></div>`;
      $("kpis").innerHTML =
        kpi("Kulutus", mw((live.totalServed || 0) + unserved)) +
        kpi("Tuotanto", mw(gen)) +
        kpi("Hinta", main ? `${Math.round(main.price)} €/MWh` : "–", main && main.price > 200 ? "bad" : "") +
        kpi("Toimittamatta", mw(unserved), unserved > 0.5 ? "bad" : "ok") +
        kpi("CO₂", `${dec(co2, 0)} t/h`) +
        kpi("N-1", n1 ? `${n1} riskiä` : "Kunnossa", n1 ? "warn" : "ok");
      const badge = $("n1-badge");
      badge.hidden = !n1;
      badge.textContent = n1;

      if (this.tool === "select" && now - (this.lastHint || 0) > 2000) { this.lastHint = now; this.updateHint(); }
      if (this.mouse && this.hover) this.showTooltip(this.mouse.x, this.mouse.y);
      this.renderChart();
      this.renderSelection();
      this.renderTabs();
      this.processToasts();
    }

    renderChart() {
      const cv = $("chart"), S = this.sim.state;
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = r.width * dpr; cv.height = r.height * dpr;
      const c = cv.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = r.width, H = r.height;
      const hist = S.history.slice(-192);
      if (hist.length < 2) { c.fillStyle = "#8a94ad"; c.font = "12px Inter"; c.fillText("Data kertyy…", 8, 20); return; }
      let maxV = 10, minV = 0;
      for (const h of hist) {
        let pos = 0, neg = 0;
        for (const k of STACK) pos += Math.max(0, h.gen[k] || 0);
        neg += Math.min(0, h.gen.export || 0) + Math.min(0, h.gen.battery || 0);
        maxV = Math.max(maxV, pos, h.demand);
        minV = Math.min(minV, neg);
      }
      maxV *= 1.08;
      const x = (i) => (i / (hist.length - 1)) * (W - 34) + 30;
      const y = (v) => H - 14 - ((v - minV) / (maxV - minV)) * (H - 22);
      c.strokeStyle = "#232d45"; c.fillStyle = "#8a94ad"; c.font = "10px JetBrains Mono"; c.lineWidth = 1;
      for (let k = 0; k <= 3; k++) {
        const v = minV + ((maxV - minV) * k) / 3;
        c.beginPath(); c.moveTo(30, y(v)); c.lineTo(W, y(v)); c.stroke();
        c.fillText(Math.round(v), 0, y(v) + 3);
      }
      // pinottu tuotanto
      const base = hist.map(() => 0);
      for (const k of STACK) {
        if (!hist.some((h) => (h.gen[k] || 0) > 0)) continue;
        c.beginPath();
        hist.forEach((h, i) => (i ? c.lineTo(x(i), y(base[i] + Math.max(0, h.gen[k] || 0))) : c.moveTo(x(i), y(base[i] + Math.max(0, h.gen[k] || 0)))));
        for (let i = hist.length - 1; i >= 0; i--) c.lineTo(x(i), y(base[i]));
        c.closePath();
        c.fillStyle = STACK_COLORS[k];
        c.globalAlpha = 0.85;
        c.fill();
        hist.forEach((h, i) => { base[i] += Math.max(0, h.gen[k] || 0); });
      }
      // vienti ja akun lataus alas
      const neg = hist.map((h) => Math.min(0, h.gen.export || 0) + Math.min(0, h.gen.battery || 0));
      if (neg.some((v) => v < 0)) {
        c.beginPath();
        hist.forEach((h, i) => (i ? c.lineTo(x(i), y(neg[i])) : c.moveTo(x(i), y(neg[i]))));
        c.lineTo(x(hist.length - 1), y(0)); c.lineTo(x(0), y(0)); c.closePath();
        c.fillStyle = STACK_COLORS.export; c.fill();
      }
      c.globalAlpha = 1;
      c.strokeStyle = "#ffffff"; c.lineWidth = 1.6;
      c.beginPath();
      hist.forEach((h, i) => (i ? c.lineTo(x(i), y(h.demand)) : c.moveTo(x(i), y(h.demand))));
      c.stroke();
      const shown = STACK.filter((k) => hist.some((h) => (h.gen[k] || 0) > 0)).concat(hist.some((h) => (h.gen.export || 0) < 0) ? ["export"] : []);
      const sig = shown.join(",");
      if (sig !== this.legendSig) {
        this.legendSig = sig;
        $("chart-legend").innerHTML = shown.map((k) => `<span><i style="background:${STACK_COLORS[k]}"></i>${STACK_NAMES[k]}</span>`).join("") + `<span><i style="background:#fff;height:2px;vertical-align:3px"></i>Kulutus</span>`;
      }
    }

    // valittu kohde: rakennetaan uudelleen vain kun rakenne muuttuu, numerot päivitetään paikallaan
    renderSelection() {
      const sim = this.sim, S = sim.state, card = $("select-card");
      const sel = this.sel;
      const moneyBucket = Math.floor(Math.log10(Math.max(1, S.money)) * 8);
      let sig = `${sel ? sel.kind + sel.id : "none"}|${moneyBucket}|${S.unlocked.mid}${S.unlocked.high}`;
      if (sel && sel.kind === "bus") {
        sig += S.units.filter((u) => u.bus === sel.id).map((u) => `${u.id}${u.state}${u.mode}`).join() + S.links.map((l) => l.def + l.state).join();
        if (sim.buses[sel.id].kind === "town" && !S.connected[sel.id]) {
          const m = sim.islandMargin(sel.id);
          sig += m ? `r${Math.round(m.spare / 10)}f${Math.round(m.feed)}` : "x";
        } else sig += "c";
      }
      if (sel && sel.kind === "line") { const l = S.lines.find((x) => x.id === sel.id); sig += l ? l.state : "gone"; }
      if (!sel) sig += S.units.length + "," + S.lines.length + Object.keys(S.connected).length;
      if (sig !== this.selSig || this.panelDirty) {
        this.selSig = sig;
        this.panelDirty = false;
        card.innerHTML = sel ? (sel.kind === "bus" ? this.busPanel(sel.id) : this.linePanel(sel.id)) : this.overviewPanel();
        this.wireSelection(card);
      }
      // elävät luvut
      card.querySelectorAll("[data-live]").forEach((el) => {
        const [k, id] = el.dataset.live.split(":");
        if (k === "p") { const u = S.units.find((x) => x.id === +id); if (u) el.textContent = u.state === "building" ? "" : mw(Math.max(0, u.p)) + (u.type === "battery" && u.p < 0 ? ` (lataa ${mw(-u.p)})` : ""); }
        if (k === "st") { const u = S.units.find((x) => x.id === +id); if (u) { el.textContent = stateText(u); el.classList.toggle("bad", u.state === "tripped"); } }
        if (k === "busd") { const d = sim.live.demandAt ? sim.live.demandAt[+id] : 0; el.textContent = d > 0 ? mw(d) : mw(sim.nationalNow * sim.buses[+id].share); }
        if (k === "buss") { const d = sim.live.demandAt ? sim.live.demandAt[+id] : 0; el.textContent = d > 0 ? `${Math.round((sim.live.servedAt[+id] / d) * 100)} %` : "–"; }
        if (k === "busg") { el.textContent = mw(S.units.filter((u) => u.bus === +id).reduce((a, u) => a + Math.max(0, u.p), 0)); }
        if (k === "flow") { const i = S.lines.findIndex((l) => l.id === +id); const f = (sim.live.flows || [])[i] || 0; el.textContent = `${mw(Math.abs(f))} (${Math.round((Math.abs(f) / LINES[S.lines[i].kv].limit) * 100)} %)`; }
        if (k === "res") { const b = sim.buses[+id]; el.textContent = `${Math.round((S.hydro[+id].res / (b.maxMW * G.Tech.HYDRO_CF * b.reservoirHours)) * 100)} %`; }
        if (k === "link") { const l = S.links.find((x) => x.id === +id); if (l) el.textContent = l.state === "in" ? `${l.p >= 0 ? "Tuonti" : "Vienti"} ${mw(Math.abs(l.p || 0))} · ${Math.round(l.price || 0)} €/MWh` : l.state === "building" ? `Rakenteilla, ${Math.ceil(l.left / 86400)} pv` : "Irti verkosta"; }
      });
    }

    overviewPanel() {
      const S = this.sim.state;
      const towns = this.sim.buses.filter((b) => b.kind === "town");
      const connected = towns.filter((b) => S.connected[b.i]).length;
      const cap = {};
      for (const u of S.units) if (u.state !== "building") cap[u.type] = (cap[u.type] || 0) + u.mw;
      return `<h3>Verkkosi</h3>
        <div class="sel-sub">Klikkaa kaupunkia, voimalaitospaikkaa tai johtoa kartalla.</div>
        <div class="sel-stats">
          <div><span>Liitetyt kaupungit</span><b>${connected} / ${towns.length}</b></div>
          <div><span>Johtoja</span><b>${S.lines.length}</b></div>
          <div><span>Huippukuorma</span><b>${mw(S.stats.peakServed)}</b></div>
        </div>
        <div class="unit-list">${Object.entries(cap).map(([k, v]) => `<div class="unit-row"><i style="background:${UNITS[k].color}"></i><span>${UNITS[k].name}</span><span></span><span class="p">${mw(v)}</span></div>`).join("") || '<div class="muted small">Ei vielä voimaloita.</div>'}</div>`;
    }

    busPanel(id) {
      const sim = this.sim, S = sim.state, b = sim.buses[id];
      const kindName = { town: "Kaupunki", hydro: "Vesivoimalaitospaikka", nuclear: "Ydinvoimalaitospaikka" }[b.kind];
      let html = `<h3>${esc(b.name)}</h3><div class="sel-sub">${kindName}${b.kind === "town" ? ` · ${nf.format(b.pop)} asukasta${b.weight >= 2 ? " · raskasta teollisuutta" : ""}` : b.kind === "hydro" ? ` · joen kapasiteetti ${b.maxMW} MW` : ` · enintään ${b.maxUnits} yksikköä`}</div>`;
      html += `<div class="sel-stats">`;
      if (b.kind === "town") html += `<div><span>Kulutus</span><b data-live="busd:${id}"></b></div><div><span>Toimitettu</span><b data-live="buss:${id}"></b></div>`;
      if (b.kind === "hydro") html += `<div><span>Allas</span><b data-live="res:${id}"></b></div>`;
      html += `<div><span>Tuotanto</span><b data-live="busg:${id}"></b></div></div>`;
      if (b.kind === "town" && !S.connected[id]) {
        const m = sim.islandMargin(id);
        const peak = sim.townPeak(id);
        if (m) {
          const fee = b.pop * b.weight * G.Tech.ECON.connectionFee;
          const capOk = m.spare >= peak, feedOk = m.feed >= peak;
          html += `<div class="connect-box${capOk && feedOk ? "" : " warn"}">
            <b>Kaupunki on verkkosi ulottuvilla</b>
            <div class="row"><span>Huippukulutus noin</span><b>${mw(peak)}</b></div>
            <div class="row"><span>Vapaa varma kapasiteetti</span><b>${mw(m.spare)}</b></div>
            <div class="row"><span>Siirtokyky kaupunkiin</span><b>${mw(m.feed)}</b></div>
            ${capOk ? "" : `<div class="why">Kapasiteettisi ei riitä talven huippuun. Toimittamatta jäävä sähkö maksaa ${nf.format(G.Tech.ECON.unservedPenalty)} €/MWh.</div>`}
            ${feedOk ? "" : `<div class="why">Johdot kaupunkiin eivät jaksa huippukulutusta – rakenna lisää johtoja tai paikallista tuotantoa.</div>`}
            <button class="btn primary" data-connect="${id}">Liitä asiakkaaksi · +${G.fmtMoney(fee)} liittymismaksu</button>
          </div>`;
        } else html += `<p class="why">Ei verkkosi ulottuvilla. Rakenna johto tähän tai voimala, niin voit liittää kaupungin asiakkaaksi.</p>`;
      } else if (b.kind === "town" && id !== S.startTown) {
        html += `<button class="link-btn" data-disconnect="${id}">Irrota kaupunki verkostasi</button>`;
      }

      const units = S.units.filter((u) => u.bus === id);
      if (units.length) {
        html += `<div class="unit-list">${units.map((u) => {
          const T = UNITS[u.type];
          const modeSel = !T.weather && u.type !== "battery" && u.state !== "building"
            ? `<select data-mode="${u.id}" title="Ajotila"><option value="auto"${u.mode === "auto" ? " selected" : ""}>Auto</option><option value="on"${u.mode === "on" ? " selected" : ""}>Aina päällä</option><option value="off"${u.mode === "off" ? " selected" : ""}>Pois</option></select>`
            : `<button class="size-btn" data-demolish="${u.id}" title="Pura">×</button>`;
          return `<div class="unit-row"><i style="background:${T.color}"></i><span>${T.name} ${u.mw} MW<br><span class="st" data-live="st:${u.id}"></span></span><span class="p" data-live="p:${u.id}"></span>${modeSel}</div>`;
        }).join("")}</div>`;
      }

      // ulkomaanyhteys
      const def = sim.linkDefs.find((d) => d.bus === id);
      if (def) {
        const built = S.links.find((l) => l.def === def.i);
        if (built) html += `<div class="build-type"><div class="bt-head"><i style="background:#22d3ee"></i>${esc(def.name)} ${def.mw} MW ${def.ac ? "(AC)" : "(HVDC)"}</div><p data-live="link:${built.id}"></p></div>`;
        else {
          const q = sim.quoteLink(def.i);
          html += `<div class="build-type${q.ok ? "" : " locked"}"><div class="bt-head"><i style="background:#22d3ee"></i>Ulkomaanyhteys: ${esc(def.name)}</div>
            <p>${def.ac ? "Vaihtosähköyhteys Ruotsiin: verkkosi tulee osaksi Pohjoismaiden synkronialuetta – valtava hitausmassa ja yhteiset reservit." : "Tasasähköyhteys: tuo ja vie sähköä naapurin markkinahinnalla, ei jaa hitausmassaa."}</p>
            <div class="sizes"><button class="size-btn" data-link="${def.i}" ${q.ok ? "" : "disabled"}><b>${def.mw} MW</b><span>${q.cost ? G.fmtMoney(q.cost) : ""} · ${G.Tech.LINK.buildDays} pv</span></button></div>
            ${q.ok ? "" : `<div class="why">${esc(q.reason)}</div>`}</div>`;
        }
      }

      // rakennettavat voimalat
      html += `<h3 style="font-size:.9rem;margin:10px 0 6px">Rakenna</h3><div class="build-grid">`;
      for (const type of sim.allowedTypes(id)) {
        const T = UNITS[type];
        const quotes = T.sizes.map((s) => ({ s, q: sim.quoteUnit(type, id, s) }));
        const locked = T.unlock && !S.unlocked[T.unlock];
        const why = quotes.find((x) => !x.q.ok && x.q.reason !== "Ei tarpeeksi rahaa.");
        html += `<div class="build-type${locked ? " locked" : ""}"><div class="bt-head"><i style="background:${T.color}"></i>${T.name}</div><p>${T.desc}</p>
          <div class="sizes">${quotes.map(({ s, q }) => `<button class="size-btn" data-build="${type}:${s}" ${q.ok ? "" : "disabled"}><b>${s} MW</b><span>${G.fmtMoney(q.cost || s * T.capex(sim.year()) * 1e6 * G.Tech.ECON.capexScale)} · ${T.buildDays} pv</span></button>`).join("")}</div>
          ${why && (locked || quotes.every((x) => !x.q.ok)) ? `<div class="why">${esc(why.q.reason)}</div>` : ""}</div>`;
      }
      html += `</div>`;
      return html;
    }

    linePanel(id) {
      const sim = this.sim, l = sim.state.lines.find((x) => x.id === id);
      if (!l) return this.overviewPanel();
      const L = LINES[l.kv];
      return `<h3>${L.name}: ${esc(sim.buses[l.a].name)}–${esc(sim.buses[l.b].name)}</h3>
        <div class="sel-sub">${Math.round(l.km)} km · siirtokyky ${L.limit} MW</div>
        <div class="sel-stats">
          <div><span>Teho</span><b data-live="flow:${id}"></b></div>
          <div><span>Tila</span><b>${l.state === "in" ? "Käytössä" : l.state === "building" ? `Rakenteilla ${Math.ceil(l.left / 86400)} pv` : "Irti"}</b></div>
          <div><span>Reaktanssi</span><b>${dec(L.xPerKm * l.km, 0)} Ω</b></div>
        </div>
        <p class="small muted">Teho jakautuu rinnakkaisten reittien kesken niiden impedanssin mukaan. Lyhyt ja korkeajännitteinen johto vetää enemmän.</p>
        <button class="btn danger" data-demolish-line="${id}">Pura johto</button>`;
    }

    wireSelection(card) {
      const sim = this.sim;
      card.querySelectorAll("[data-build]").forEach((b) => b.addEventListener("click", () => {
        const [type, s] = b.dataset.build.split(":");
        const r = sim.buildUnit(type, this.sel.id, +s);
        if (!r.ok) this.toast(r.reason, "mid");
        this.panelDirty = true;
        this.renderPanels(true);
      }));
      card.querySelectorAll("[data-connect]").forEach((b) => b.addEventListener("click", () => {
        const r = sim.connectCustomer(+b.dataset.connect);
        if (!r.ok) this.toast(r.reason, "mid");
        this.panelDirty = true;
      }));
      card.querySelectorAll("[data-disconnect]").forEach((b) => b.addEventListener("click", () => {
        if (confirm("Irrotetaanko kaupunki? Se ei enää osta sähköä sinulta.")) { sim.disconnectCustomer(+b.dataset.disconnect); this.panelDirty = true; }
      }));
      card.querySelectorAll("[data-link]").forEach((b) => b.addEventListener("click", () => {
        const r = sim.buildLink(+b.dataset.link);
        if (!r.ok) this.toast(r.reason, "mid");
        this.panelDirty = true;
      }));
      card.querySelectorAll("[data-mode]").forEach((s) => s.addEventListener("change", () => { sim.setMode(+s.dataset.mode, s.value); this.panelDirty = true; }));
      card.querySelectorAll("[data-demolish]").forEach((b) => b.addEventListener("click", () => {
        if (confirm("Puretaanko voimala?")) { sim.demolish("unit", +b.dataset.demolish); this.panelDirty = true; }
      }));
      card.querySelectorAll("[data-demolish-line]").forEach((b) => b.addEventListener("click", () => {
        if (confirm("Puretaanko johto?")) { sim.demolish("line", +b.dataset.demolishLine); this.sel = null; this.panelDirty = true; }
      }));
    }

    renderTabs(force) {
      const sim = this.sim, S = sim.state, body = $("tab-body");
      const sig = this.tab + "|" + (S.events[0] ? S.events[0].t + S.events[0].text : "") + "|" + (sim.live.n1 || []).length + "|" + (this.tab === "finance" ? S.daily.length : "") + (this.tab === "goals" ? Object.keys(S.connected).length + JSON.stringify(S.unlocked) : "");
      if (!force && sig === this.tabSig) return;
      this.tabSig = sig;
      if (this.tab === "events") {
        body.innerHTML = S.events.slice(0, 80).map((e, i) => {
          const tm = G.formatTime(e.t);
          return `<div class="ev ${e.severity || (e.kind === "connect" || e.kind === "unlock" ? "good" : "")}"><time>${tm.date.replace(/^\S+\s/, "").replace(/\d{4}$/, "")} ${tm.time}</time><span>${esc(e.text)}${e.trace ? ` <button data-trace="${i}">Taajuus</button>` : ""}</span></div>`;
        }).join("") || '<div class="muted small">Ei vielä tapahtumia.</div>';
        body.querySelectorAll("[data-trace]").forEach((b) => b.addEventListener("click", () => this.showTrace(S.events[+b.dataset.trace])));
      } else if (this.tab === "n1") {
        const list = sim.live.n1 || [];
        body.innerHTML = list.length
          ? `<p class="small muted">Nämä yksittäiset viat kaatuisivat verkkosi juuri nyt. Lisää rinnakkaisia johtoja, reserviä tai paikallista tuotantoa.</p>` + list.map((v) => `<div class="n1">⚠ ${esc(v.text)}</div>`).join("")
          : '<div class="n1 ok">✓ Verkko kestää minkä tahansa yksittäisen johdon tai voimalan menetyksen.</div>';
      } else if (this.tab === "finance") {
        const days = S.daily.slice(-61, -1);
        const sum = (k) => days.reduce((a, d) => a + d[k], 0);
        body.innerHTML = `<canvas id="fin-chart"></canvas>
          <div class="fin-row"><span>Tulot (30 pv)</span><b>${G.fmtMoney(days.slice(-30).reduce((a, d) => a + d.rev, 0))}</b></div>
          <div class="fin-row"><span>Kulut (30 pv)</span><b>${G.fmtMoney(days.slice(-30).reduce((a, d) => a + d.cost, 0))}</b></div>
          <div class="fin-row"><span>Toimitettu energia (60 pv)</span><b>${nf.format(Math.round(sum("served")))} MWh</b></div>
          <div class="fin-row"><span>Toimittamatta (60 pv)</span><b>${nf.format(Math.round(sum("unserved")))} MWh</b></div>
          <div class="fin-row"><span>CO₂-päästöt (60 pv)</span><b>${nf.format(Math.round(sum("co2")))} t</b></div>
          <div class="fin-row"><span>Kaikkiaan tulot / kulut</span><b>${G.fmtMoney(S.stats.revenue)} / ${G.fmtMoney(S.stats.costs)}</b></div>`;
        this.drawFinance(days);
      } else {
        body.innerHTML = this.goals().map((g) => `<div class="goal${g.done ? " done" : ""}"><span>${g.done ? "✓" : "○"}</span><span>${g.text}${g.small ? `<small>${g.small}</small>` : ""}</span></div>`).join("");
      }
    }

    drawFinance(days) {
      const cv = $("fin-chart");
      if (!cv || !days.length) return;
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = r.width * dpr; cv.height = r.height * dpr;
      const c = cv.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const vals = days.map((d) => d.rev - d.cost);
      const m = Math.max(1, ...vals.map(Math.abs));
      const bw = r.width / vals.length;
      vals.forEach((v, i) => {
        c.fillStyle = v >= 0 ? "#34d399" : "#ef4444";
        const h = (Math.abs(v) / m) * (r.height / 2 - 4);
        c.fillRect(i * bw + 1, v >= 0 ? r.height / 2 - h : r.height / 2, bw - 2, h);
      });
      c.fillStyle = "#8a94ad"; c.font = "10px JetBrains Mono";
      c.fillText(`päivän tulos, max ${G.fmtMoney(m)}`, 4, 11);
    }

    goals() {
      const sim = this.sim, S = sim.state;
      const towns = sim.buses.filter((b) => b.kind === "town");
      const conn = towns.filter((b) => S.connected[b.i]).length;
      const has = (type, st) => S.units.some((u) => u.type === type && (!st || u.state === st));
      const windMW = S.units.filter((u) => u.type === "wind" && u.state !== "building").reduce((a, u) => a + u.mw, 0);
      return [
        { text: "Liitä 5 kaupunkia verkkoosi", small: `${Math.min(5, conn)} / 5`, done: conn >= 5 },
        { text: "Huippukuorma 400 MW", small: "Avaa 220 kV johdot, kombi- ja hiilivoimalat", done: S.unlocked.mid },
        { text: "Sähköä Helsinkiin", done: !!S.connected[sim.buses.findIndex((b) => b.name === "Helsinki")] },
        { text: "Huippukuorma 1 500 MW", small: "Avaa 400 kV, ydinvoiman ja ulkomaanyhteydet", done: S.unlocked.high },
        { text: "1 000 MW tuulivoimaa", small: `${nf.format(windMW)} / 1 000 MW`, done: windMW >= 1000 },
        { text: "Ensimmäinen ydinvoimala verkossa", done: has("nuclear", "online") },
        { text: "Synkroninen Pohjoismaiden kanssa", small: "Rakenna AC-yhteys Ruotsiin (Tornio)", done: S.links.some((l) => l.ac && l.state === "in") },
        { text: "N-1-turvallinen verkko vuorokauden ajan", small: `Paras putki ${dec(S.stats.n1Best || 0, 0)} h`, done: (S.stats.n1Best || 0) >= 24 },
        { text: "Fossiiliton viikko", small: `Paras putki ${dec(S.stats.fossilFreeBest || 0, 0)} h / 168 h`, done: (S.stats.fossilFreeBest || 0) >= 168 },
        { text: `Koko Suomi: kaikki ${towns.length} kaupunkia`, small: `${conn} / ${towns.length}`, done: conn === towns.length },
      ];
    }

    // ---------- Taajuuskäyrä ----------
    showTrace(e) {
      $("trace-title").textContent = "Taajuus häiriön jälkeen";
      $("trace-text").textContent = `${G.formatTime(e.t).date} ${G.formatTime(e.t).time} · ${e.text} Taajuuden muutosnopeus alussa ${dec(e.rocof || 0, 2)} Hz/s.`;
      $("dlg-trace").showModal();
      const cv = $("trace-chart"), c = cv.getContext("2d");
      const W = cv.width, H = cv.height, tr = e.trace;
      c.clearRect(0, 0, W, H);
      const lo = Math.min(47.5, ...tr) - 0.05, hi = 50.15;
      const x = (i) => 40 + (i / (tr.length - 1)) * (W - 50);
      const y = (f) => 10 + ((hi - f) / (hi - lo)) * (H - 30);
      c.font = "10px JetBrains Mono";
      for (const [f, col, label] of [[50, "#334155", "50,0"], [49.9, "#1e3a5f", "49,9 reservit"], [48.8, "#7f1d1d", "48,8 kuormanirrotus"], [47.5, "#7f1d1d", "47,5 romahdus"]]) {
        if (f < lo) continue;
        c.strokeStyle = col; c.setLineDash([4, 4]);
        c.beginPath(); c.moveTo(40, y(f)); c.lineTo(W - 10, y(f)); c.stroke();
        c.setLineDash([]); c.fillStyle = "#8a94ad"; c.fillText(label, 44, y(f) - 3);
      }
      c.strokeStyle = "#22d3ee"; c.lineWidth = 2;
      c.beginPath();
      tr.forEach((f, i) => (i ? c.lineTo(x(i), y(f)) : c.moveTo(x(i), y(f))));
      c.stroke();
      c.fillStyle = "#8a94ad";
      c.fillText("0 s", 36, H - 6);
      c.fillText(`${Math.round((tr.length - 1) * 0.2)} s`, W - 34, H - 6);
    }

    // ---------- Ilmoitukset ----------
    onEvent(e) {
      if (["trip", "freq", "connect", "unlock", "shed", "reach"].includes(e.kind) || (e.kind === "done" && this.app.speed <= 3600)) this.toastQueue.push(e);
      if (this.toastQueue.length > 6) this.toastQueue.splice(0, this.toastQueue.length - 6);
    }
    processToasts() {
      const now = performance.now();
      if (!this.toastQueue.length || now - this.lastToast < 900) return;
      this.lastToast = now;
      const e = this.toastQueue.shift();
      // taajuushäiriö ja sen aiheuttanut laukeaminen yhdistetään
      if (e.kind === "trip" && this.toastQueue[0] && this.toastQueue[0].kind === "freq") {
        const f = this.toastQueue.shift();
        return this.toast(f.text, f.severity || e.severity, f);
      }
      this.toast(e.text, e.severity || (["connect", "unlock"].includes(e.kind) ? "good" : ""), e.trace ? e : null);
    }
    toast(text, severity = "", traceEvent = null) {
      const box = $("toasts");
      const el = document.createElement("div");
      el.className = `toast ${severity || ""}`;
      el.textContent = text;
      if (traceEvent && traceEvent.trace) {
        const b = document.createElement("button");
        b.textContent = "Näytä taajuus";
        b.addEventListener("click", () => this.showTrace(traceEvent));
        el.append(document.createElement("br"), b);
      }
      box.prepend(el);
      while (box.children.length > 4) box.lastChild.remove();
      setTimeout(() => el.remove(), traceEvent ? 9000 : 6000);
    }
  }

  G.UI = UI;
  G.FOSSIL = FOSSIL;
})(window);
