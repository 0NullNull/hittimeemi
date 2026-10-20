// Kolikkopeli: kolme kiekkoa. Palvelin arpoo tuloksen heti; kiekot pyörivät silti hetken
// ja pysähtyvät vuorotellen, ja saldo päivittyy vasta kun viimeinen on pysähtynyt.
(window.KasinoGames ??= {}).slots = (() => {
  const SPIN_MS = [700, 1000, 1300]; // kunkin kiekon pysähtyminen pyöräytyksestä
  let api;
  let ui = {};
  let symbols = [];      // palvelimen voittotaulukko: { id, emoji, three }
  let twoCherries = 2.5;
  let spinning = false;
  let started = 0;
  let spinTimer = null;
  let giveUp = null;

  const emoji = (id) => symbols.find((s) => s.id === id)?.emoji ?? "❔";
  const x = (n) => String(n).replace(".", ",") + "×";

  function init(a, root) {
    api = a;
    root.innerHTML = `
      <div class="slot-machine">
        <div class="reels"><div class="reel">🍒</div><div class="reel">🔔</div><div class="reel">7️⃣</div></div>
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
      reels: [...root.querySelectorAll(".reel")],
      result: root.querySelector("#slot-result"),
      spin: root.querySelector("#slot-spin"),
      paytable: root.querySelector("#paytable"),
      bet: api.betControl("slots", 50),
    };
    root.querySelector("#slot-bet-slot").replaceWith(ui.bet.root);
    ui.spin.onclick = spin;
    addEventListener("keydown", (e) => {
      if (e.code === "Space" && !e.target.closest("input, button") && !root.hidden) {
        e.preventDefault();
        spin();
      }
    });
  }

  function spin() {
    if (spinning || !api.online || !symbols.length) return;
    spinning = true;
    started = performance.now();
    ui.spin.disabled = true;
    ui.result.textContent = "";
    ui.result.className = "slot-result";
    ui.reels.forEach((r) => r.classList.remove("hit"));
    api.holdBalance(SPIN_MS[2] + 400);
    api.send({ type: "slots-spin", amount: ui.bet.value });
    let i = 0;
    spinTimer = setInterval(() => {
      for (const r of ui.reels) if (r.classList.contains("spin") || i === 0) {
        r.classList.add("spin");
        r.textContent = symbols[(Math.random() * symbols.length) | 0].emoji;
      }
      i++;
    }, 70);
    // panos hylättiin (ilmoitus tulee erikseen): pysäytetään
    giveUp = setTimeout(() => stop(null), 2500);
  }

  function stop(result) {
    clearTimeout(giveUp);
    const wait = (ms) => Math.max(0, ms - (performance.now() - started));
    ui.reels.forEach((reel, i) => {
      setTimeout(() => {
        reel.classList.remove("spin");
        if (result) reel.textContent = emoji(result.reels[i]);
        if (i === 2) finish(result);
      }, result ? wait(SPIN_MS[i]) : 0);
    });
  }

  function finish(result) {
    clearInterval(spinTimer);
    spinning = false;
    ui.spin.disabled = false;
    if (!result) return;
    if (result.payout > 0) {
      ui.result.className = "slot-result win";
      ui.result.textContent = `Voitit ${api.money(result.payout)} (${x(result.mult)})!`;
      const three = result.reels.every((id) => id === result.reels[0]);
      ui.reels.forEach((r, i) => r.classList.toggle("hit", three || result.reels[i] === "cherry"));
    } else {
      ui.result.textContent = "Ei voittoa tällä kertaa.";
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
    } else if (m.type === "slots" && spinning) {
      stop(m);
    }
  }

  return { init, message, show: () => {} };
})();
