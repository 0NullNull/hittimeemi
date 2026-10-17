// Päivän radan valinta, reikien generointi ja ratkaisija.
// Käsin tehdyt radat (holes.js) menevät generoitujen edelle.
(() => {
  const { W, H, BALL_R, MODS, inRect, buildWorld, simulateShot } = window.Golf;
  const HOLES_PER_DAY = 3;
  const EPOCH = Date.UTC(2026, 0, 1);

  function seededRandom(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const between = (rng, a, b) => a + rng() * (b - a);
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  function todayNumber() {
    const d = new Date();
    return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 864e5);
  }
  function dateKey(day) {
    const d = new Date(EPOCH + day * 864e5);
    return d.toISOString().slice(0, 10);
  }

  // ---------- Reittiverkko ----------
  // 20 px ruudukko: mitkä ruudut pallo voi kulkea. Antaa etäisyyden reikään
  // seinien ja veden ympäri (portaalit oikopolkuina). Ratkaisija käyttää tätä.
  const CELL = 20, GW = W / CELL, GH = H / CELL;

  function blockedCell(world, cx, cy) {
    const x = cx * CELL + CELL / 2, y = cy * CELL + CELL / 2;
    const pad = BALL_R + 2;
    if (x < pad || y < pad || x > W - pad || y > H - pad) return true;
    for (const b of world.blocks) {
      if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return true;
    }
    for (const r of world.water) if (inRect(x, y, r)) return true;
    for (const c of world.bumpers) if (Math.hypot(x - c.x, y - c.y) < c.r + pad) return true;
    return false;
  }

  function flowField(world) {
    const dist = new Float32Array(GW * GH).fill(Infinity);
    const blocked = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) blocked[y * GW + x] = blockedCell(world, x, y) ? 1 : 0;
    const cellOf = (p) => Math.min(GH - 1, Math.max(0, Math.floor(p.y / CELL))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(p.x / CELL)));
    const portalLinks = new Map();
    for (const p of world.portals) {
      portalLinks.set(cellOf(p.a), cellOf(p.b));
      portalLinks.set(cellOf(p.b), cellOf(p.a));
    }
    const start = cellOf(world.hole);
    dist[start] = 0;
    const queue = [start];
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi], cx = c % GW, cy = (c / GW) | 0;
      const nbrs = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < GW && ny < GH) nbrs.push(ny * GW + nx);
      }
      if (portalLinks.has(c)) nbrs.push(portalLinks.get(c));
      for (const n of nbrs) {
        if (blocked[n] || dist[n] !== Infinity) continue;
        dist[n] = dist[c] + 1;
        queue.push(n);
      }
    }
    return { at: (p) => dist[cellOf(p)] };
  }

  // ---------- Ratkaisija ----------
  // Kokeilee lyöntejä eri suuntiin ja voimilla, ja jatkaa parhaista
  // pysähtymispaikoista. Palauttaa pienimmän lyöntimäärän (≤ maxDepth) tai null.
  function solve(world, maxDepth = 3) {
    const flow = flowField(world);
    if (flow.at(world.start) === Infinity) return null;
    const ANGLES = 56, POWERS = [0.22, 0.38, 0.56, 0.75, 1];
    let frontier = [{ x: world.start.x, y: world.start.y }];
    const seen = new Set();
    for (let depth = 1; depth <= maxDepth; depth++) {
      const next = [];
      for (const pos of frontier) {
        for (let a = 0; a < ANGLES; a++) {
          const angle = (a / ANGLES) * Math.PI * 2;
          for (const p of POWERS) {
            const r = simulateShot(world, pos.x, pos.y, angle, p);
            if (r.result === "sunk") return depth;
            if (r.result !== "stop") continue;
            const key = ((r.x / 24) | 0) + "," + ((r.y / 24) | 0);
            if (seen.has(key)) continue;
            seen.add(key);
            next.push({ x: r.x, y: r.y, d: flow.at(r) });
          }
        }
      }
      next.sort((a, b) => a.d - b.d);
      frontier = next.filter((n) => n.d !== Infinity).slice(0, 9);
      if (!frontier.length) return null;
    }
    return null;
  }

  // ---------- Generaattori ----------
  function overlapsRect(r, x, y, pad) {
    return x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad;
  }

  function generateHole(seed, modId, windDir) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const rng = seededRandom(seed * 131 + attempt * 7919);
      const flip = rng() < 0.5;
      const fx = (x) => (flip ? W - x : x);
      const start = [fx(between(rng, 70, 150)), between(rng, 90, H - 90)];
      const goal = [fx(between(rng, 790, 930)), between(rng, 90, H - 90)];
      const clear = (x, y, pad) => Math.hypot(x - start[0], y - start[1]) > pad && Math.hypot(x - goal[0], y - goal[1]) > pad;
      const hole = { start, hole: goal, blocks: [], walls: [], sand: [], water: [], boosts: [], portals: [], bumpers: [], movers: [] };

      // Este suoralle linjalle, ettei reikä ole pelkkä suora lyönti
      const mx = (start[0] + goal[0]) / 2 + between(rng, -70, 70);
      const my = (start[1] + goal[1]) / 2 + between(rng, -70, 70);
      const bw = between(rng, 30, 70), bh = between(rng, 140, 330);
      hole.blocks.push([mx - bw / 2, Math.max(0, my - bh / 2), bw, bh]);

      // Lisää laatikoita ja joskus kulmapalat
      const extra = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < extra; i++) {
        const w = between(rng, 40, 180), h = between(rng, 40, 200);
        const x = between(rng, 200, W - 200 - w), y = between(rng, 0, H - h);
        if (clear(x + w / 2, y + h / 2, 130)) hole.blocks.push([x, y, w, h]);
      }
      if (rng() < 0.5) {
        const w = between(rng, 120, 260), h = between(rng, 100, 200);
        const top = rng() < 0.5;
        hole.blocks.push([fx(rng() < 0.5 ? W * 0.4 : W * 0.6) - w / 2, top ? 0 : H - h, w, h]);
      }

      const blocks = hole.blocks.map(([x, y, w, h]) => ({ x, y, w, h }));
      // vapaa paikka: ei seinän, portaalin, pomppupallon tai kiihdyttimen päällä
      const free = (x, y, pad) =>
        x > pad && y > pad && x < W - pad && y < H - pad &&
        !blocks.some((b) => overlapsRect(b, x, y, pad)) &&
        !hole.portals.some(([ax, ay, bx, by]) => Math.hypot(x - ax, y - ay) < pad + 30 || Math.hypot(x - bx, y - by) < pad + 30) &&
        !hole.bumpers.some(([bx, by, r]) => Math.hypot(x - bx, y - by) < pad + r + 10) &&
        !hole.boosts.some(([bx, by, bw, bh]) => overlapsRect({ x: bx, y: by, w: bw, h: bh }, x, y, pad));

      // 2–3 erikoisruutua satunnaisesti
      const features = ["sand", "water", "boost", "portal", "bumpers", "mover", "sand", "water"];
      const count = 2 + (rng() < 0.4 ? 1 : 0);
      const chosen = new Set();
      while (chosen.size < count) chosen.add(pick(rng, features));

      for (const f of chosen) {
        for (let tries = 0; tries < 12; tries++) {
          if (f === "sand") {
            // hiekkaeste reiän lähelle
            const w = between(rng, 90, 170), h = between(rng, 70, 140);
            const x = goal[0] - w / 2 + between(rng, -150, 150), y = goal[1] - h / 2 + between(rng, -130, 130);
            const sand = { x, y, w, h };
            if (overlapsRect(sand, goal[0], goal[1], 30) || overlapsRect(sand, start[0], start[1], 40)) continue;
            hole.sand.push([x, y, w, h]);
            break;
          }
          if (f === "water") {
            const w = between(rng, 80, 200), h = between(rng, 60, 160);
            const x = between(rng, 180, W - 180 - w), y = between(rng, 0, H - h);
            if (!clear(x + w / 2, y + h / 2, 150 + Math.max(w, h) / 2)) continue;
            hole.water.push([x, y, w, h]);
            break;
          }
          if (f === "boost") {
            const x = between(rng, 220, W - 320), y = between(rng, 60, H - 110);
            const toGoal = (Math.atan2(goal[1] - y, goal[0] - x) * 180) / Math.PI + between(rng, -50, 50);
            if (!free(x + 45, y + 22, 30)) continue;
            hole.boosts.push([x, y, 90, 44, Math.round(toGoal)]);
            break;
          }
          if (f === "portal") {
            const ax = fx(between(rng, 180, 420)), ay = between(rng, 60, H - 60);
            const bx = fx(between(rng, 580, 820)), by = between(rng, 60, H - 60);
            if (!free(ax, ay, 30) || !free(bx, by, 30) || !clear(bx, by, 90)) continue;
            hole.portals.push([ax, ay, bx, by]);
            break;
          }
          if (f === "bumpers") {
            const n = 2 + Math.floor(rng() * 2);
            for (let i = 0; i < n; i++) {
              const x = between(rng, 260, W - 260), y = between(rng, 70, H - 70), r = between(rng, 14, 24);
              if (free(x, y, r + 20) && clear(x, y, 110)) hole.bumpers.push([x, y, r]);
            }
            break;
          }
          if (f === "mover") {
            const x = between(rng, 300, W - 300), y = between(rng, 120, H - 260);
            const vertical = rng() < 0.5;
            const len = between(rng, 110, 170), amp = between(rng, 60, 110), period = between(rng, 2.2, 4);
            if (vertical) hole.movers.push([x, y, x, y + len, amp, 0, period]);
            else hole.movers.push([x - len / 2, y + 60, x + len / 2, y + 60, 0, amp, period]);
            break;
          }
        }
      }

      const world = buildWorld(hole, modId, windDir);
      const best = solve(world, 3);
      if (!best) continue;
      hole.par = Math.min(5, best + 1);
      hole.generated = true;
      return hole;
    }
    // Varmuuden vuoksi helppo reikä, jos mikään yritys ei kelvannut
    return { start: [120, 300], hole: [880, 300], blocks: [[470, 160, 60, 280]], par: 3, generated: true };
  }

  const MOD_POOL = ["normal", "normal", "ice", "wind", "bouncy", "magnet", "heavy", "tiny"];

  // Päivän rata: käsin tehty, jos holes.js:ssä on se päivä, muuten generoitu
  function dailyCourse(day) {
    const key = dateKey(day);
    const rng = seededRandom(day * 7 + 3);
    const handmade = (window.HANDMADE_COURSES || {})[key];
    const modifier = handmade?.modifier || MOD_POOL[Math.floor(rng() * MOD_POOL.length)];
    const windDir = rng() * Math.PI * 2;
    const holes = handmade?.holes?.length
      ? handmade.holes.map((h) => ({ par: 3, ...h }))
      : Array.from({ length: HOLES_PER_DAY }, (_, i) => generateHole(day * 10 + i, modifier, windDir));
    return { day, key, modifier, windDir, holes, handmade: !!handmade };
  }

  function practiceHole() {
    const seed = Math.floor(Math.random() * 1e9);
    const modifier = MOD_POOL[Math.floor(Math.random() * MOD_POOL.length)];
    const windDir = Math.random() * Math.PI * 2;
    return { seed, modifier, windDir, hole: generateHole(seed, modifier, windDir) };
  }

  window.GolfLevels = { todayNumber, dateKey, dailyCourse, practiceHole, generateHole, solve, HOLES_PER_DAY, MODS };
})();
