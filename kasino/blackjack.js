// Blackjack: oma pöytä. Palvelin jakaa kortit ja pitää jakajan toisen kortin piilossa,
// kunnes käsi on pelattu; selain vain näyttää tilan ja lähettää valinnat.
(window.KasinoGames ??= {}).blackjack = (() => {
  let api;
  let ui = {};
  let state = { phase: "idle" };

  function init(a, root) {
    api = a;
    root.innerHTML = `
      <div class="felt">
        <div><div class="bj-label">Jakaja <span id="bj-dealer-total"></span></div><div class="cards" id="bj-dealer"></div></div>
        <div class="bj-result" id="bj-result">Aseta panos ja jaa kortit.</div>
        <div><div class="bj-label">Sinä <span id="bj-player-total"></span></div><div class="cards" id="bj-player"></div></div>
      </div>
      <div class="controls">
        <span id="bj-bet-slot"></span>
        <button class="btn primary big" id="bj-deal">Jaa kortit</button>
        <button class="btn big" id="bj-hit" hidden>Ota kortti</button>
        <button class="btn big" id="bj-stand" hidden>Jää</button>
        <button class="btn big" id="bj-double" hidden>Tuplaa</button>
      </div>
      <p class="hint">Jakaja jää 17:ään. Blackjack (ässä ja kymppi) maksaa 3:2. Tuplaus kahdella ensimmäisellä kortilla: panos tuplataan ja saat yhden kortin.</p>`;
    ui = {
      dealer: root.querySelector("#bj-dealer"),
      player: root.querySelector("#bj-player"),
      dealerTotal: root.querySelector("#bj-dealer-total"),
      playerTotal: root.querySelector("#bj-player-total"),
      result: root.querySelector("#bj-result"),
      deal: root.querySelector("#bj-deal"),
      hit: root.querySelector("#bj-hit"),
      stand: root.querySelector("#bj-stand"),
      double: root.querySelector("#bj-double"),
      bet: api.betControl("blackjack", 100),
    };
    root.querySelector("#bj-bet-slot").replaceWith(ui.bet.root);
    ui.deal.onclick = () => api.send({ type: "bj-deal", amount: ui.bet.value });
    ui.hit.onclick = () => api.send({ type: "bj-hit" });
    ui.stand.onclick = () => api.send({ type: "bj-stand" });
    ui.double.onclick = () => api.send({ type: "bj-double" });
  }

  function card(c) {
    if (c.hidden) return api.el("div", "card-face back");
    const el = api.el("div", "card-face" + (c.suit === "♥" || c.suit === "♦" ? " red" : ""));
    el.append(api.el("span", "r", c.rank), api.el("span", "s", c.suit));
    return el;
  }

  // paid = maksettu summa (alen aikana pienempi kuin panos, josta voitto lasketaan)
  const paid = (h) => h.paid ?? h.bet;
  const RESULTS = {
    blackjack: (h) => `Blackjack! +${api.money(h.payout - paid(h))}`,
    win: (h) => `Voitit! +${api.money(h.payout - paid(h))}`,
    push: (h) => `Tasapeli: ${api.money(paid(h))} palautettiin.`,
    lose: () => "Jakaja voitti.",
    bust: () => "Yli 21. Hävisit.",
  };

  function message(m) {
    state = m;
    const playing = m.phase === "playing";
    const idle = m.phase === "idle";
    ui.dealer.replaceChildren(...(m.dealer ?? []).map(card));
    ui.player.replaceChildren(...(m.player ?? []).map(card));
    ui.dealerTotal.textContent = idle ? "" : `(${m.dealerTotal})`;
    ui.playerTotal.textContent = idle ? "" : `(${m.playerTotal})`;
    ui.result.className = "bj-result" + (m.result ? (m.payout > paid(m) ? " win" : m.payout === paid(m) ? "" : " lose") : "");
    ui.result.textContent = m.result ? RESULTS[m.result](m) : playing ? `Panos ${api.money(m.bet)}${paid(m) < m.bet ? ` (maksoit ${api.money(paid(m))})` : ""}. Otatko kortin vai jäätkö?` : "Aseta panos ja jaa kortit.";
    ui.deal.hidden = playing;
    ui.deal.textContent = m.phase === "done" ? "Jaa uudelleen" : "Jaa kortit";
    for (const b of [ui.hit, ui.stand]) b.hidden = !playing;
    ui.double.hidden = !playing || !m.canDouble;
  }

  return { init, message, show: () => {} };
})();
