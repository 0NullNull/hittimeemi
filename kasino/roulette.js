// Ruletti: yhteinen pöytä kaikille. Valitse pelimerkin arvo ja klikkaa pöytää; jokainen klikkaus
// on yksi panos. Pyörä piirretään eurooppalaisessa järjestyksessä ja pyörähtää palvelimen
// arpomaan numeroon.
(window.KasinoGames ??= {}).roulette = (() => {
  const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const CHIPS = [10, 50, 100, 500, 1000, 5000];
  const SEG = (2 * Math.PI) / 37;
  const colorOf = (n) => (n === 0 ? "green" : RED.has(n) ? "red" : "black");
  const COLOR_NAME = { green: "vihreä", red: "punainen", black: "musta" };

  let api;
  let ui = {};
  let s = null;
  let chip = 100;
  let rot = 0;           // pyörän kulma (radiaaneina); taskun i keskikohta on kulmassa rot + i·SEG ylhäältä
  let anim = null;       // { from, to, start, ms }
  let endsLocal = 0;
  let spunRound = 0;

  function init(a, root) {
    api = a;
    chip = Number(api.store.get("kasino-chip")) || 100;
    root.innerHTML = `
      <div class="roulette-top">
        <canvas id="wheel" width="520" height="520"></canvas>
        <div>
          <div class="roulette-status" id="rl-status">Yhdistetään…</div>
          <div class="history" id="rl-history"></div>
          <div class="chips" id="rl-chips"></div>
          <div class="controls">
            <button class="btn" id="rl-clear">Peru omat panokset</button>
            <span id="rl-mine" class="muted"></span>
          </div>
        </div>
      </div>
      <div class="board" id="rl-board"></div>
      <div class="table-bets" id="rl-table"></div>
      <p class="hint">Numero maksaa 35:1, tusinat ja sarakkeet 2:1, väri, parillinen/pariton ja 1–18/19–36 1:1. Nolla voittaa kaikki ulkopanokset.</p>`;
    ui = {
      wheel: root.querySelector("#wheel"),
      status: root.querySelector("#rl-status"),
      history: root.querySelector("#rl-history"),
      chips: root.querySelector("#rl-chips"),
      board: root.querySelector("#rl-board"),
      mine: root.querySelector("#rl-mine"),
      table: root.querySelector("#rl-table"),
      clear: root.querySelector("#rl-clear"),
    };
    for (const v of CHIPS) {
      const b = api.el("button", "chip", v >= 1000 ? v / 1000 + "k" : String(v));
      b.dataset.v = v;
      b.type = "button";
      b.title = `Pelimerkki ${api.money(v)}`;
      b.onclick = () => {
        chip = v;
        api.store.set("kasino-chip", v);
        renderChips();
      };
      ui.chips.append(b);
    }
    renderChips();
    buildBoard();
    ui.clear.onclick = () => api.send({ type: "roulette-clear" });
    requestAnimationFrame(frame);
  }

  function renderChips() {
    for (const b of ui.chips.children) b.classList.toggle("on", Number(b.dataset.v) === chip);
  }

  // Pöytä: nolla vasemmalla, numerot 3 riviä × 12, sarakkeet oikealla, tusinat ja ulkopanokset alla
  function buildBoard() {
    const cell = (label, kind, value, col, row, cls = "") => {
      const b = api.el("button", cls, label);
      b.type = "button";
      b.dataset.key = kind + ":" + (value ?? "");
      b.style.gridColumn = col;
      b.style.gridRow = row;
      b.onclick = () => api.send({ type: "roulette-bet", kind, value, amount: chip });
      ui.board.append(b);
    };
    cell("0", "number", 0, "1", "1 / span 3", "n-green");
    for (let n = 1; n <= 36; n++) cell(String(n), "number", n, String(Math.ceil(n / 3) + 1), String(3 - ((n - 1) % 3)), "n-" + colorOf(n));
    for (const [row, col] of [[1, 3], [2, 2], [3, 1]]) cell("2:1", "column", col, "14", String(row));
    cell("1.–12.", "dozen", 1, "2 / span 4", "4");
    cell("13.–24.", "dozen", 2, "6 / span 4", "4");
    cell("25.–36.", "dozen", 3, "10 / span 4", "4");
    const outside = [["1–18", "low"], ["Parillinen", "even"], ["Punainen", "red", "n-red"], ["Musta", "black", "n-black"], ["Pariton", "odd"], ["19–36", "high"]];
    outside.forEach(([label, kind, cls], i) => cell(label, kind, null, `${2 + i * 2} / span 2`, "5", cls));
  }

  function message(m) {
    s = m;
    endsLocal = performance.now() + m.msLeft;
    const i = m.result == null ? -1 : ORDER.indexOf(m.result);
    if (m.phase === "spinning" && spunRound !== m.round) {
      // pyöräytys: vähintään viisi kierrosta ja pysähdys tulosnumeroon
      spunRound = m.round;
      let to = -i * SEG;
      while (to > rot - 5 * 2 * Math.PI) to -= 2 * Math.PI;
      anim = { from: rot, to, start: performance.now(), ms: Math.max(800, m.msLeft - 200) };
    } else if (m.phase === "result" && i >= 0 && !anim) {
      rot = -i * SEG; // tultiin sivulle kesken: suoraan tulokseen
    }
    render();
  }

  function render() {
    const betting = s.phase === "betting";
    ui.history.replaceChildren(...s.history.map((n) => api.el("span", n === 0 ? "hi" : RED.has(n) ? "lo" : "", String(n))));

    // omat panokset pöydälle ja muiden summat listaan
    const mine = new Map();
    const others = new Map();
    let myTotal = 0;
    for (const b of s.bets) {
      if (b.player === api.you) {
        const key = b.kind + ":" + (b.value ?? "");
        mine.set(key, (mine.get(key) ?? 0) + b.amount);
        myTotal += b.amount;
      } else others.set(b.name, (others.get(b.name) ?? 0) + b.amount);
    }
    for (const btn of ui.board.children) {
      btn.disabled = !betting || !api.online;
      btn.querySelector(".mk")?.remove();
      const amount = mine.get(btn.dataset.key);
      if (amount) btn.append(api.el("span", "mk", api.fmt(amount)));
      btn.classList.toggle("won", s.phase === "result" && wins(btn.dataset.key, s.result));
    }
    ui.clear.disabled = !betting || !myTotal;
    ui.mine.textContent = myTotal ? `Panoksesi: ${api.money(myTotal)}` : "";
    const table = [...others].map(([name, sum]) => `${name} ${api.money(sum)}`).join(" · ");
    const winners = s.phase === "result" && s.winners.length
      ? "Voittajat: " + s.winners.map((w) => `${w.name} +${api.money(w.amount)}`).join(" · ")
      : "";
    ui.table.textContent = winners || (table ? "Pöydässä: " + table : "");
  }

  function wins(key, n) {
    const [kind, raw] = key.split(":");
    const v = Number(raw);
    return {
      number: n === v,
      red: RED.has(n),
      black: n > 0 && !RED.has(n),
      odd: n > 0 && n % 2 === 1,
      even: n > 0 && n % 2 === 0,
      low: n >= 1 && n <= 18,
      high: n >= 19,
      dozen: n > 0 && Math.ceil(n / 12) === v,
      column: n > 0 && ((n - 1) % 3) + 1 === v,
    }[kind];
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!s) return;
    const now = performance.now();
    if (anim) {
      const p = Math.min(1, (now - anim.start) / anim.ms);
      rot = anim.from + (anim.to - anim.from) * (1 - Math.pow(1 - p, 3));
      if (p >= 1) anim = null;
    }
    drawWheel();
    let text = "";
    let cls = "";
    if (s.phase === "betting") text = `Panokset auki · ${Math.max(0, Math.ceil((endsLocal - now) / 1000))} s`;
    else if (s.phase === "spinning" || anim) text = "Pyörii…";
    else if (s.result != null) {
      cls = colorOf(s.result);
      text = `${s.result} ${COLOR_NAME[cls]}`;
    }
    if (ui.status.dataset.text !== text) {
      // päivitetään vain muuttuessa, ei joka ruudunpäivityksellä
      ui.status.dataset.text = text;
      ui.status.replaceChildren(api.el("span", cls, text));
    }
  }

  function drawWheel() {
    const c = ui.wheel;
    const g = c.getContext("2d");
    const size = c.width;
    const cx = size / 2;
    const r = size / 2 - 14;
    g.clearRect(0, 0, size, size);
    g.save();
    g.translate(cx, cx);
    for (let i = 0; i < 37; i++) {
      const n = ORDER[i];
      const mid = rot + i * SEG - Math.PI / 2;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, r, mid - SEG / 2, mid + SEG / 2);
      g.closePath();
      g.fillStyle = n === 0 ? "#15803d" : RED.has(n) ? "#b91c1c" : "#111827";
      g.fill();
      g.strokeStyle = "#d4af37";
      g.lineWidth = 1.5;
      g.stroke();
      g.save();
      g.rotate(mid);
      g.fillStyle = "#fff";
      g.font = "bold 22px Inter, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.translate(r - 28, 0);
      g.rotate(Math.PI / 2);
      g.fillText(String(n), 0, 0);
      g.restore();
    }
    // keskiö
    g.beginPath();
    g.arc(0, 0, r * 0.55, 0, 2 * Math.PI);
    g.fillStyle = "#3b2a0a";
    g.fill();
    g.strokeStyle = "#d4af37";
    g.lineWidth = 6;
    g.stroke();
    g.restore();
    // osoitin ylhäällä
    g.beginPath();
    g.moveTo(cx - 16, 4);
    g.lineTo(cx + 16, 4);
    g.lineTo(cx, 40);
    g.closePath();
    g.fillStyle = "#f5b82e";
    g.fill();
  }

  return { init, message, show: () => {} };
})();
