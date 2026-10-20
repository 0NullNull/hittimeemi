// Kolikkopeli: kolme kiekkoa. Palvelin arpoo tuloksen heti; kiekot silti pyörivät oikean kiekon
// tavoin (symbolinauha liikkuu ylhäältä alas), jarruttavat ja pysähtyvät vuorotellen pienellä
// nytkähdyksellä. Jos kaksi ensimmäistä ovat samat, viimeinen pyörii hetken pidempään.
// Saldo päivittyy vasta, kun viimeinen kiekko on pysähtynyt.
(window.KasinoGames ??= {}).slots = (() => {
  const CELL = 100;                    // symbolin korkeus (px), sama kuin CSS:n --cell
  const VMAX = 22;                     // täysi nopeus, symbolia sekunnissa
  const BRAKE_AT = [850, 1200, 1550];  // ms pyöräytyksestä, jolloin kiekko aikaisintaan alkaa jarruttaa
  const TENSE_MS = 1000;               // viimeisen kiekon lisäaika, kun kaksi ensimmäistä ovat samat
  const NO_RESULT_MS = 2500;           // panos hylättiin (ilmoitus tulee erikseen): pysäytetään
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const BACK = reduced ? 0 : 1.1;      // jarrutuksen ylitys (easeOutBack); 0 = ei ylitystä
  const FALLBACK = ["🍒", "🍋", "🍊", "🍇", "🔔", "⭐", "7️⃣"];

  let api;
  let ui = {};
  let reels = [];
  let symbols = [];      // palvelimen voittotaulukko: { id, emoji, three }
  let twoCherries = 2.5;
  let spinning = false;
  let waiting = false;   // pyöräytetty, tulosta ei vielä tullut
  let started = 0;
  let pending = null;    // tulos, joka näytetään kun kiekot ovat pysähtyneet
  let giveUp = null;
  let frame = 0;

  const emoji = (id) => symbols.find((s) => s.id === id)?.emoji ?? "❔";
  const x = (n) => String(n).replace(".", ",") + "×";
  const randomEmoji = () => {
    const list = symbols.length ? symbols.map((s) => s.emoji) : FALLBACK;
    return list[(Math.random() * list.length) | 0];
  };

  // easeOutBack ja sen derivaatta; alkunopeus ease'(0) = BACK + 3
  const ease = (u) => 1 + (BACK + 1) * (u - 1) ** 3 + BACK * (u - 1) ** 2;
  const easeSpeed = (u) => 3 * (BACK + 1) * (u - 1) ** 2 + 2 * BACK * (u - 1);

  function init(a, root) {
    api = a;
    root.innerHTML = `
      <div class="slot-machine" id="slot-machine">
        <div class="reels"><div class="reel"></div><div class="reel"></div><div class="reel"></div></div>
        <div class="slot-result" id="slot-result">Onnea matkaan!</div>
      </div>
      <div class="controls">
        <span id="slot-bet-slot"></span>
        <button class="btn primary big" id="slot-spin">Pyöräytä</button>
      </div>
      <h3>Voitot (kertoimet sisältävät panoksen)</h3>
      <table class="paytable" id="paytable"></table>
      <p class="hint">Välilyönti pyöräyttää. Palautusprosentti on 96,8 %: pitkällä aikavälillä kasino voittaa aina vähän.</p>`;
    ui = {
      machine: root.querySelector("#slot-machine"),
      result: root.querySelector("#slot-result"),
      spin: root.querySelector("#slot-spin"),
      paytable: root.querySelector("#paytable"),
      bet: api.betControl("slots", 50),
    };
    reels = [...root.querySelectorAll(".reel")].map((el, i) => makeReel(el, ["🍒", "🔔", "7️⃣"][i]));
    root.querySelector("#slot-bet-slot").replaceWith(ui.bet.root);
    ui.spin.onclick = spin;
    addEventListener("keydown", (e) => {
      if (e.code === "Space" && !e.target.closest("input, button") && !root.hidden) {
        e.preventDefault();
        spin();
      }
    });
  }

  // ---------- kiekot ----------

  // Kiekko on loputon symbolinauha: kohta p (symboleina) on keskellä, symboli k näkyy
  // kohdassa (p - k) * CELL keskeltä, joten p:n kasvaessa nauha liikkuu alaspäin.
  function makeReel(el, first) {
    const strip = api.el("div", "strip");
    const cells = Array.from({ length: 5 }, () => api.el("div", "cell"));
    strip.append(...cells);
    el.append(strip, api.el("div", "hit-frame"));
    const reel = { el, strip, cells, p: 0, v: 0, phase: "idle", seq: new Map([[0, first]]), blur: "" };
    render(reel);
    return reel;
  }

  function symbolAt(r, k) {
    if (!r.seq.has(k)) r.seq.set(k, randomEmoji());
    return r.seq.get(k);
  }

  function render(r) {
    const base = Math.floor(r.p) - 1;
    r.cells.forEach((cell, j) => {
      const k = base + j;
      const text = symbolAt(r, k);
      if (cell.textContent !== text) cell.textContent = text;
      cell.style.transform = `translateY(${((r.p - k) * CELL).toFixed(1)}px)`;
    });
    const speed = Math.abs(r.v);
    const blur = reduced ? "" : speed > 12 ? "blur(1.8px)" : speed > 5 ? "blur(0.8px)" : "";
    if (blur !== r.blur) r.strip.style.filter = r.blur = blur;
    for (const k of r.seq.keys()) if (k < base - 2) r.seq.delete(k);
  }

  function tick(now) {
    let moving = false;
    reels.forEach((r, i) => {
      const t = now - r.t0;
      if (r.phase === "windup") {
        // pieni nykäisy taaksepäin ennen lähtöä
        r.p = r.p0 - (reduced ? 0 : 0.22 * Math.sin((Math.PI * Math.max(0, Math.min(t, 110))) / 220));
        if (t >= 110) {
          r.phase = "run";
          r.last = now;
        }
      } else if (r.phase === "run") {
        const dt = Math.min(50, now - r.last) / 1000;
        r.last = now;
        r.v = Math.min(VMAX, r.v + (VMAX / 0.25) * dt);
        r.p += r.v * dt;
        if (r.brakeAt != null && now - started >= r.brakeAt) brake(r, now);
      } else if (r.phase === "brake") {
        const b = r.brake;
        const u = Math.min(1, (now - b.t0) / b.ms);
        r.p = b.p0 + (b.T - b.p0) * ease(u);
        r.v = ((b.T - b.p0) / (b.ms / 1000)) * easeSpeed(u);
        if (u >= 1) {
          r.p = b.T;
          r.v = 0;
          r.phase = "idle";
          stopped(i);
        }
      }
      if (r.phase !== "idle") moving = true;
      render(r);
    });
    frame = moving ? requestAnimationFrame(tick) : 0;
  }

  // Jarrutus päättyy kokonaiseen kohtaan T, jossa on tuloksen symboli. Kesto valitaan niin,
  // että nopeus jatkuu sulavasti: ease'(0) * matka / kesto = nykyinen nopeus.
  function brake(r, now) {
    const v0 = Math.max(r.v, 4);
    const T = Math.ceil(r.p + Math.max(3.2, (v0 * 0.6) / (BACK + 3)));
    r.seq.set(T, r.target ?? randomEmoji());
    r.brake = { t0: now, p0: r.p, T, ms: (((BACK + 3) * (T - r.p)) / v0) * 1000 };
    r.phase = "brake";
  }

  function stopped(i) {
    const r = reels[i];
    r.el.classList.remove("tense");
    r.el.classList.add("landed");
    setTimeout(() => r.el.classList.remove("landed"), 200);
    if (i === 1 && pending?.tense) reels[2].el.classList.add("tense");
    if (reels.every((reel) => reel.phase === "idle")) finish(pending);
  }

  // ---------- pyöräytys ----------

  function spin() {
    if (spinning || !api.online || !symbols.length) return;
    spinning = waiting = true;
    pending = null;
    started = performance.now();
    ui.spin.disabled = true;
    ui.result.textContent = "";
    ui.result.className = "slot-result";
    ui.machine.classList.remove("win", "big");
    reels.forEach((r, i) => {
      r.el.classList.remove("hit", "tense");
      Object.assign(r, { phase: "windup", t0: started + i * 70, p0: r.p, v: 0, brakeAt: null, target: null });
    });
    api.holdBalance(NO_RESULT_MS + 4000); // lyhennetään, kun tulos ja pysähtymisajat tiedetään
    api.send({ type: "slots-spin", amount: ui.bet.value });
    giveUp = setTimeout(() => land(null), NO_RESULT_MS);
    if (!frame) frame = requestAnimationFrame(tick);
  }

  // Tulos tuli (tai ei tule): päätetään kiekkojen jarrutusajat
  function land(result) {
    clearTimeout(giveUp);
    waiting = false;
    const now = performance.now() - started;
    pending = result && { ...result, tense: result.reels[0] === result.reels[1] };
    let at = 0;
    reels.forEach((r, i) => {
      r.target = result ? emoji(result.reels[i]) : null;
      at = Math.max(BRAKE_AT[i], now + 250 * i, at + 250);
      if (i === 2 && pending?.tense) at += TENSE_MS;
      r.brakeAt = at;
    });
    if (result) api.holdBalance(at - now + 1200); // varmistus; finish vapauttaa saldon heti
  }

  function finish(result) {
    spinning = false;
    ui.spin.disabled = false;
    api.holdBalance(0);
    if (!result) return;
    if (result.payout > 0) {
      const three = result.reels.every((id) => id === result.reels[0]);
      reels.forEach((r, i) => r.el.classList.toggle("hit", three || result.reels[i] === "cherry"));
      ui.machine.classList.add("win");
      ui.result.className = "slot-result win";
      ui.result.textContent = `Voitit ${api.money(result.payout)} (${x(result.mult)})!`;
      if (result.mult >= 10) celebrate(result.mult);
    } else {
      ui.result.textContent = "Ei voittoa tällä kertaa.";
    }
  }

  // Isoissa voitoissa kolikoita lentää koneesta
  function celebrate(mult) {
    if (reduced) return;
    ui.machine.classList.add("big");
    const n = mult >= 80 ? 40 : 20;
    for (let k = 0; k < n; k++) {
      const coin = api.el("span", "coin", "🪙");
      coin.style.setProperty("--dx", ((Math.random() * 2 - 1) * 280).toFixed(0) + "px");
      coin.style.setProperty("--dy", (-(90 + Math.random() * 170)).toFixed(0) + "px");
      coin.style.setProperty("--r", ((Math.random() * 2 - 1) * 540).toFixed(0) + "deg");
      coin.style.animationDelay = (Math.random() * 220).toFixed(0) + "ms";
      coin.addEventListener("animationend", () => coin.remove());
      ui.machine.append(coin);
    }
  }

  function message(m) {
    if (m.type === "slots-paytable") {
      symbols = m.symbols;
      twoCherries = m.twoCherries;
      ui.paytable.replaceChildren(
        ...[...symbols].reverse().map((s) => {
          const tr = api.el("tr");
          tr.append(api.el("td", "", s.emoji.repeat(3)), api.el("td", "", x(s.three)));
          return tr;
        }),
      );
      const tr = api.el("tr");
      tr.append(api.el("td", "", "🍒🍒"), api.el("td", "", `${x(twoCherries)} (tasan kaksi kirsikkaa)`));
      ui.paytable.append(tr);
    } else if (m.type === "slots" && waiting) {
      land(m);
    }
  }

  return { init, message, show: () => {} };
})();
