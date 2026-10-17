// 50 Hz – sähköverkon laskenta: saarekkeet, DC-tehonjako, PTDF- ja LODF-kertoimet (N-1).
// DC-tehonjako: linjan teho = suskeptanssi × kulmaero. PTDF kertoo, kuinka suuri osa
// solmuun syötetystä tehosta kulkee kunkin linjan kautta.
(function (root) {
  const G = (root.GridGame = root.GridGame || {});

  // Linjan suskeptanssi per unit (100 MVA perusteho)
  function susceptance(kv, km, xPerKm) {
    const zBase = (kv * kv) / 100;
    return 1 / ((xPerKm * km) / zBase);
  }

  function invert(m, n) {
    // Gauss–Jordan; m on n×n Float64Array (rivit peräkkäin)
    const a = new Float64Array(m), inv = new Float64Array(n * n);
    for (let i = 0; i < n; i++) inv[i * n + i] = 1;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[p * n + c])) p = r;
      if (Math.abs(a[p * n + c]) < 1e-12) return null;
      if (p !== c) for (let k = 0; k < n; k++) {
        [a[p * n + k], a[c * n + k]] = [a[c * n + k], a[p * n + k]];
        [inv[p * n + k], inv[c * n + k]] = [inv[c * n + k], inv[p * n + k]];
      }
      const d = a[c * n + c];
      for (let k = 0; k < n; k++) { a[c * n + k] /= d; inv[c * n + k] /= d; }
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = a[r * n + c];
        if (f === 0) continue;
        for (let k = 0; k < n; k++) { a[r * n + k] -= f * a[c * n + k]; inv[r * n + k] -= f * inv[c * n + k]; }
      }
    }
    return inv;
  }

  // Jakaa verkon saarekkeisiin. lines: [{ a, b, bpu, inService }], buses: väylien määrä.
  // Palauttaa saarekkeet, joissa on PTDF-matriisi valmiina.
  function buildIslands(busCount, lines, isActive) {
    const adj = Array.from({ length: busCount }, () => []);
    lines.forEach((l, i) => {
      if (!l.inService) return;
      adj[l.a].push([l.b, i]);
      adj[l.b].push([l.a, i]);
    });
    const busIsland = new Int32Array(busCount).fill(-1);
    const islands = [];
    for (let s = 0; s < busCount; s++) {
      if (busIsland[s] !== -1 || !isActive(s)) continue;
      const id = islands.length;
      const buses = [s];
      busIsland[s] = id;
      for (let qi = 0; qi < buses.length; qi++) {
        for (const [nb] of adj[buses[qi]]) {
          if (busIsland[nb] === -1) { busIsland[nb] = id; buses.push(nb); }
        }
      }
      islands.push({ id, buses, lines: [] });
    }
    lines.forEach((l, i) => { if (l.inService && busIsland[l.a] !== -1) islands[busIsland[l.a]].lines.push(i); });
    for (const isl of islands) computePTDF(isl, lines);
    return { islands, busIsland, adj };
  }

  function computePTDF(isl, lines) {
    const n = isl.buses.length;
    isl.local = new Map(isl.buses.map((b, i) => [b, i]));
    const L = isl.lines.length;
    isl.ptdf = new Float64Array(L * n); // rivi = linja, sarake = solmu (paikallinen indeksi), slack = 0
    if (n < 2 || L === 0) return;
    const m = n - 1;
    const B = new Float64Array(m * m);
    for (const li of isl.lines) {
      const l = lines[li];
      const i = isl.local.get(l.a) - 1, j = isl.local.get(l.b) - 1;
      if (i >= 0) B[i * m + i] += l.bpu;
      if (j >= 0) B[j * m + j] += l.bpu;
      if (i >= 0 && j >= 0) { B[i * m + j] -= l.bpu; B[j * m + i] -= l.bpu; }
    }
    const X = invert(B, m);
    if (!X) return;
    const xAt = (r, c) => (r === 0 || c === 0 ? 0 : X[(r - 1) * m + (c - 1)]);
    isl.lines.forEach((li, r) => {
      const l = lines[li];
      const a = isl.local.get(l.a), b = isl.local.get(l.b);
      for (let k = 0; k < n; k++) isl.ptdf[r * n + k] = l.bpu * (xAt(a, k) - xAt(b, k));
    });
  }

  // Linjojen tehot saarekkeessa: inj = Map(väylä → MW), positiivinen = syöttö verkkoon
  function islandFlows(isl, inj, out) {
    const n = isl.buses.length;
    const p = new Float64Array(n);
    isl.buses.forEach((b, k) => { p[k] = inj[b] || 0; });
    isl.lines.forEach((li, r) => {
      let f = 0;
      for (let k = 1; k < n; k++) f += isl.ptdf[r * n + k] * p[k];
      out[li] = f;
    });
  }

  // N-1: jokaisen linjan vikaantumisen vaikutus muiden linjojen tehoihin (LODF).
  // Palauttaa listan rikkeistä: { outage, line, flowAfter, limit } tai saarekkeeksi irtoavat osat.
  function contingencyCheck(isl, lines, flows, limits) {
    const n = isl.buses.length;
    const result = [];
    const rowOf = new Map(isl.lines.map((li, r) => [li, r]));
    for (const k of isl.lines) {
      const lk = lines[k], rk = rowOf.get(k);
      const ak = isl.local.get(lk.a), bk = isl.local.get(lk.b);
      const denom = 1 - (isl.ptdf[rk * n + ak] - isl.ptdf[rk * n + bk]);
      if (Math.abs(denom) < 1e-6) {
        result.push({ outage: k, islanding: true });
        continue;
      }
      for (const l of isl.lines) {
        if (l === k) continue;
        const rl = rowOf.get(l);
        const lodf = (isl.ptdf[rl * n + ak] - isl.ptdf[rl * n + bk]) / denom;
        const after = flows[l] + lodf * flows[k];
        if (Math.abs(after) > limits[l]) result.push({ outage: k, line: l, flowAfter: after, limit: limits[l] });
      }
    }
    return result;
  }

  // Mitkä väylät irtoavat, jos linja k katkeaa (sillan toinen puoli)
  function sideWithout(adj, start, cutLine) {
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const v = q.pop();
      for (const [nb, li] of adj[v]) if (li !== cutLine && !seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
    return seen;
  }

  G.Network = { susceptance, buildIslands, islandFlows, contingencyCheck, sideWithout };
})(typeof window !== "undefined" ? window : globalThis);
