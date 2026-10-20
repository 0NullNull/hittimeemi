// Crash: yhteinen kierros kaikille. Palvelin kertoo vaiheen ja ajat; kerroin piirretään
// itse samalla kaavalla kuin palvelimella (e^(rate·t)), joten ruutu päivittyy sulavasti
// ilman jatkuvia viestejä. Kotiutus ratkeaa aina palvelimen kellon mukaan.
(window.KasinoGames ??= {}).crash = (() => {
  let api;
  let ui = {};
  let s = null;          // viimeisin tila palvelimelta
  let startLocal = 0;    // kierroksen alku tämän selaimen kellossa
  let endsLocal = 0;     // panosajan loppu tämän selaimen kellossa

  const mult = (ms) => Math.floor(Math.exp((s.rate * ms) / 1000) * 100) / 100;
  const x2 = (m) => m.toFixed(2).replace(".", ",") + "×";
  const myBet = () => s?.bets.find((b) => b.player === api.you);

  function init(a, root) {
    api = a;
    root.innerHTML = `
      <div class="crash-stage">
        <canvas id="crash-canvas"></canvas>
        <div class="crash-big dim" id="crash-big">1,00×</div>
        <div class="crash-sub" id="crash-sub">Yhdistetään…</div>
      </div>
      <div class="history" id="crash-history"></div>
      <div class="controls">
        <span id="crash-bet-slot"></span>
        <div class="field">
          <label for="crash-auto">Automaattinen kotiutus</label>
          <input id="crash-auto" placeholder="esim. 2,00" inputmode="decimal" autocomplete="off">
        </div>
        <button class="btn primary big" id="crash-action" disabled>Aseta panos</button>
      </div>
      <p class="hint">Aseta panos ennen kierroksen alkua. Kerroin nousee, kunnes peli kaatuu satunnaisessa kohdassa: kotiuta ennen sitä, niin saat panoksesi kerrottuna. Automaattinen kotiutus kotiuttaa puolestasi.</p>
      <h3>Tämän kierroksen panokset</h3>
      <ol class="bets" id="crash-bets"></ol>`;
    ui = {
      canvas: root.querySelector("#crash-canvas"),
      big: root.querySelector("#crash-big"),
      sub: root.querySelector("#crash-sub"),
      history: root.querySelector("#crash-history"),
      bets: root.querySelector("#crash-bets"),
      action: root.querySelector("#crash-action"),
      auto: root.querySelector("#crash-auto"),
      bet: api.betControl("crash", 100),
    };
    root.querySelector("#crash-bet-slot").replaceWith(ui.bet.root);
    ui.auto.value = api.store.get("kasino-crash-auto") || "";
    ui.auto.addEventListener("change", () => api.store.set("kasino-crash-auto", ui.auto.value.trim()));
    ui.action.onclick = act;
    addEventListener("keydown", (e) => {
      // välilyönti kotiuttaa, kun crash on auki (ja kursori ei ole kentässä)
      if (e.code === "Space" && !e.target.closest("input, button") && !root.hidden && s?.phase === "running") {
        e.preventDefault();
        act();
      }
    });
    requestAnimationFrame(frame);
  }

  function act() {
    if (!s) return;
    const mine = myBet();
    if (s.phase === "betting" && !mine) {
      api.send({ type: "crash-bet", amount: ui.bet.value, auto: ui.auto.value.trim() || null });
    } else if (s.phase === "running" && mine && !mine.cashedAt) {
      api.send({ type: "crash-cashout" });
    }
  }

  function message(m) {
    s = m;
    const now = performance.now();
    if (m.phase === "betting") endsLocal = now + m.msLeft;
    if (m.phase === "running") startLocal = now - m.elapsed;
    renderLists();
  }

  function renderLists() {
    ui.history.replaceChildren(
      ...s.history.map((p) => api.el("span", p < 2 ? "lo" : p >= 10 ? "top" : "hi", x2(p))),
    );
    const crashed = s.phase === "crashed";
    ui.bets.replaceChildren(
      ...(s.bets.length
        ? s.bets.map((b) => {
            const li = api.el("li");
            li.classList.toggle("me", b.player === api.you);
            li.append(api.el("span", "", b.name), api.el("span", "", api.money(b.amount)));
            const result = b.cashedAt
              ? api.el("span", "win", `${x2(b.cashedAt)} = ${api.money(Math.floor(b.amount * b.cashedAt))}`)
              : api.el("span", crashed ? "lose" : "", crashed ? "kaatui" : b.auto ? `auto ${x2(b.auto)}` : "…");
            li.append(result);
            return li;
          })
        : [api.el("li", "empty", "Ei vielä panoksia.")]),
    );
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!s) return;
    const now = performance.now();
    const mine = myBet();
    let m = 1;
    let t = 0;
    if (s.phase === "running") {
      t = Math.max(0, now - startLocal);
      m = mult(t);
      ui.big.className = "crash-big run";
      ui.big.textContent = x2(m);
      ui.sub.textContent = mine && !mine.cashedAt ? "Kotiuta ennen kaatumista! (välilyönti)" : "";
    } else if (s.phase === "crashed") {
      m = s.point;
      t = (Math.log(m) / s.rate) * 1000;
      ui.big.className = "crash-big bust";
      ui.big.textContent = x2(m);
      ui.sub.textContent = "Kaatui! Seuraava kierros alkaa pian…";
    } else {
      ui.big.className = "crash-big dim";
      ui.big.textContent = "1,00×";
      ui.sub.textContent = `Panokset auki · kierros alkaa ${Math.max(0, (endsLocal - now) / 1000).toFixed(1).replace(".", ",")} s`;
    }
    draw(m, t / 1000);
    renderAction(mine, m);
  }

  function renderAction(mine, m) {
    const b = ui.action;
    if (!api.online) {
      b.disabled = true;
      b.textContent = "Ei yhteyttä";
    } else if (s.phase === "betting") {
      b.disabled = !!mine;
      b.textContent = mine ? `Panos asetettu: ${api.money(mine.amount)}` : "Aseta panos";
    } else if (s.phase === "running" && mine && !mine.cashedAt) {
      b.disabled = false;
      b.textContent = `Kotiuta ${api.money(Math.floor(mine.amount * m))}`;
    } else if (mine?.cashedAt) {
      b.disabled = true;
      b.textContent = `Kotiutettu ${x2(mine.cashedAt)}`;
    } else {
      b.disabled = true;
      b.textContent = s.phase === "running" ? "Kierros käynnissä…" : "Odota seuraavaa kierrosta";
    }
  }

  function draw(m, t) {
    const c = ui.canvas;
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w) return;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const maxT = Math.max(8, t * 1.15);
    const maxM = Math.max(2, m * 1.15);
    const X = (tt) => 46 + (tt / maxT) * (w - 70);
    const Y = (mm) => h - 28 - ((mm - 1) / (maxM - 1)) * (h - 56);

    // kerroinviivat
    g.font = "12px Inter, sans-serif";
    g.fillStyle = "#8b91ad";
    g.strokeStyle = "rgba(255,255,255,0.06)";
    const step = maxM <= 3 ? 0.5 : maxM <= 6 ? 1 : maxM <= 20 ? 5 : Math.pow(10, Math.floor(Math.log10(maxM)));
    for (let v = 1; v <= maxM; v += step) {
      g.beginPath();
      g.moveTo(46, Y(v));
      g.lineTo(w - 20, Y(v));
      g.stroke();
      g.fillText(v.toFixed(v < 10 ? 1 : 0).replace(".", ",") + "×", 6, Y(v) + 4);
    }
    if (t <= 0) return;

    // käyrä
    const color = s.phase === "crashed" ? "#ef4444" : "#22c55e";
    g.beginPath();
    g.moveTo(X(0), Y(1));
    for (let i = 1; i <= 80; i++) {
      const tt = (t * i) / 80;
      g.lineTo(X(tt), Y(Math.min(m, Math.exp(s.rate * tt))));
    }
    g.lineWidth = 4;
    g.strokeStyle = color;
    g.stroke();
    g.lineTo(X(t), Y(1));
    g.closePath();
    const fill = g.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, s.phase === "crashed" ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.25)");
    fill.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = fill;
    g.fill();
  }

  return { init, message, show: () => {} };
})();
