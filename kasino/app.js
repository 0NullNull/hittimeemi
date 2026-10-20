// Kasinon kuori: yhteys pelipalvelimeen, lompakko, välilehdet ja sivupalkki (rikkaimmat,
// isot voitot, paikalla olijat). Pelit (crash.js, roulette.js, blackjack.js, slots.js)
// rekisteröityvät window.KasinoGames-olioon ennen tätä tiedostoa, ja tämä antaa niille api-olion.
// Kaikki arvonnat ja saldot ovat palvelimella (server/games/kasino); selain vain näyttää.
(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString("fi-FI");
  const money = (n) => fmt(n) + " €"; // leikkieuroja
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  };

  // Tekstit aina textContentilla: nimet tulevat muilta pelaajilta
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Vieraan tunniste: sama selain = sama vieraslompakko (niin kauan kuin palvelin on käynnissä)
  let guestId = store.get("kasino-guest");
  if (!guestId) {
    guestId = crypto.randomUUID();
    store.set("kasino-guest", guestId);
  }

  const games = window.KasinoGames || {};
  let wallet = null;     // { balance, guest, bonusAvailable, daily }
  let shown = null;      // näytetty saldo
  let holdUntil = 0;     // pelin animaatio pyysi odottamaan saldon näyttämistä (ettei tulos paljastu)
  let sales = [];        // käynnissä olevat alet: { id, game, percent, title, endsAt (tämän koneen kello) }
  const priceUpdaters = [];

  // Alennusprosentti pelille; sama sääntö kuin palvelimella (suurin voimassa oleva)
  const discount = (game) =>
    sales.reduce((best, s) => (s.endsAt > Date.now() && (s.game === "all" || s.game === game) ? Math.max(best, s.percent) : best), 0);
  const price = (amount, off) => (off ? Math.ceil((amount * (100 - off)) / 100) : amount);

  // ---------- panoksen valinta (yhteinen kaikille peleille) ----------

  function betControl(key, fallback = 100) {
    const storeKey = "kasino-bet-" + key;
    const input = el("input");
    Object.assign(input, { type: "number", min: "10", step: "10", inputMode: "numeric" });
    input.value = store.get(storeKey) || fallback;
    const save = () => store.set(storeKey, input.value);
    input.addEventListener("change", save);
    const button = (label, fn, title) => {
      const b = el("button", "btn small", label);
      b.type = "button";
      b.title = title;
      b.onclick = () => {
        input.value = Math.max(10, Math.floor(fn(Number(input.value) || 0)));
        save();
        update();
      };
      return b;
    };
    const row = el("div", "bet-row");
    row.append(input, button("½", (v) => v / 2, "Puolita"), button("2×", (v) => v * 2, "Tuplaa"), button("Max", () => api.balance, "Kaikki rahat"));
    const root = el("div", "bet");
    const label = el("label", "", "Panos (€)");
    input.id = "bet-" + key;
    label.htmlFor = input.id;
    // alen aikana: paljonko panoksesta oikeasti maksetaan
    const priceLine = el("small", "bet-price");
    const update = () => {
      const off = discount(key);
      priceLine.hidden = !off;
      if (off) priceLine.textContent = `Ale -${off} %: maksat ${money(price(Math.floor(Number(input.value) || 0), off))}`;
    };
    input.addEventListener("input", update);
    priceUpdaters.push(update);
    update();
    root.append(label, row, priceLine);
    return { root, get value() { return Math.floor(Number(input.value) || 0); } };
  }

  // ---------- pelien käyttämä rajapinta ----------

  const api = {
    fmt,
    money,
    el,
    store,
    betControl,
    send: (data) => net.send(data),
    get balance() { return wallet?.balance ?? 0; },
    get you() { return net.room?.you ?? null; },
    get online() { return net.status === "online" && !!net.room; },
    notice: toast,
    // pidä saldo ennallaan ruudulla hetken (esim. kolikkopelin kiekot pyörivät vielä)
    holdBalance(ms) {
      holdUntil = Date.now() + ms;
      setTimeout(renderWallet, ms + 20);
    },
  };

  let toastTimer;
  function toast(text) {
    $("toast").textContent = text;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
  }

  // ---------- lompakko ----------

  function renderWallet() {
    if (!wallet || Date.now() < holdUntil) return;
    const b = $("balance");
    if (shown != null && wallet.balance !== shown) {
      b.classList.remove("up", "down");
      void b.offsetWidth; // käynnistä väriefekti uudelleen
      b.classList.add(wallet.balance > shown ? "up" : "down");
      setTimeout(() => b.classList.remove("up", "down"), 700);
    }
    shown = wallet.balance;
    b.textContent = money(wallet.balance);
    const bonus = $("bonus");
    bonus.hidden = false;
    bonus.classList.toggle("muted", !wallet.guest && !wallet.bonusAvailable);
    const daily = money(wallet.daily ?? 1000); // vanha palvelin ei kertonut summaa (se oli 1 000 €)
    bonus.textContent = wallet.guest
      ? `Luo tili: ${daily} päivässä`
      : wallet.bonusAvailable ? `Hae päivän rahat (+${daily})` : "Uudet rahat huomenna";
    $("guest-daily").textContent = daily;
    bonus.disabled = !wallet.guest && !wallet.bonusAvailable;
    $("guest-banner").hidden = !wallet.guest;
  }

  $("bonus").onclick = () => (wallet?.guest ? Account.open("signup") : net.send({ type: "bonus" }));
  $("guest-signup").onclick = () => Account.open("signup");

  // ---------- sivupalkki ----------

  async function loadRich() {
    let data;
    try {
      data = await Account.api("GET", "/api/kasino/leaderboard");
    } catch {
      $("rich").replaceChildren(el("li", "empty", "Lista ei ole nyt saatavilla."));
      return;
    }
    $("rich").replaceChildren(
      ...(data.top.length
        ? data.top.map((row, i) => {
            const li = el("li");
            li.classList.toggle("me", row.name === Account.user?.name);
            const name = el("span");
            name.append(el("b", "", `${i + 1}.`), row.name);
            li.append(name, el("span", "", money(row.balance)));
            return li;
          })
        : [el("li", "empty", "Ei vielä pelaajia.")]),
    );
    $("rich-me").textContent = data.me
      ? `Sinä: ${data.me.rank}. sija, ${money(data.me.balance)}`
      : "Luo tili, niin pääset listalle.";
  }
  let richTimer;
  const loadRichSoon = () => {
    clearTimeout(richTimer);
    richTimer = setTimeout(loadRich, 2500);
  };
  setInterval(loadRich, 30000);

  function renderFeed(items) {
    $("feed").replaceChildren(
      ...(items.length
        ? items.map((it) => {
            const li = el("li");
            li.append(`${it.name} voitti `, el("strong", "", `+${money(it.amount)}`), " ", el("small", "", [it.game, it.detail].filter(Boolean).join(" · ")));
            return li;
          })
        : [el("li", "empty", "Ei vielä isoja voittoja.")]),
    );
  }

  function renderOnline(r) {
    const players = r?.players ?? [];
    $("online-count").textContent = players.length ? `(${players.length})` : "";
    $("online").replaceChildren(
      ...players.map((p) => {
        const li = el("li", "", p.name);
        if (p.id === r.you) li.append(" ", el("small", "", "(sinä)"));
        if (!p.connected) li.append(" ", el("small", "", "· poissa"));
        return li;
      }),
    );
  }

  // ---------- alet ----------

  const GAME_NAMES = { all: "Kaikki pelit", crash: "Crash", roulette: "Ruletti", blackjack: "Blackjack", slots: "Kolikkopeli" };

  function timeLeft(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d) return `${d} vrk ${h} h`;
    if (h) return `${h} h ${m} min`;
    if (m) return `${m} min ${s % 60} s`;
    return `${s} s`;
  }

  function renderSales() {
    const now = Date.now();
    sales = sales.filter((s) => s.endsAt > now);
    const box = $("sales");
    box.hidden = !sales.length;
    box.replaceChildren(
      ...sales.map((s) => {
        const row = el("div", "sale");
        row.append(el("span", "sale-pct", `-${s.percent} %`), el("strong", "", GAME_NAMES[s.game]));
        if (s.title) row.append(el("span", "", s.title));
        row.append(el("span", "sale-left", "päättyy " + timeLeft(s.endsAt - now)));
        return row;
      }),
      ...(sales.length ? [el("small", "", "Panokset maksavat vähemmän, mutta voitot lasketaan koko panoksesta.")] : []),
    );
    document.querySelectorAll(".tabs a").forEach((a) => {
      const off = discount(a.dataset.tab);
      let tag = a.querySelector(".sale-tag");
      if (!tag) a.append((tag = el("span", "sale-tag")));
      tag.hidden = !off;
      tag.textContent = `-${off} %`;
    });
    for (const update of priceUpdaters) update();
  }
  setInterval(() => sales.length && renderSales(), 1000);

  // ---------- välilehdet ----------

  const TABS = { crash: "crash", ruletti: "roulette", blackjack: "blackjack", kolikkopeli: "slots" };
  function showTab() {
    const id = TABS[location.hash.slice(1)] || "crash";
    for (const name of Object.values(TABS)) $("panel-" + name).hidden = name !== id;
    document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === id));
    games[id]?.show?.();
  }
  addEventListener("hashchange", showTab);

  // ---------- yhteys ----------

  const ROUTES = { crash: "crash", roulette: "roulette", bj: "blackjack", slots: "slots", "slots-paytable": "slots" };
  const STATUS = { connecting: "Yhdistetään…", online: "Kasino auki", offline: "Pelipalvelin ei vastaa" };
  let joinedAs = null; // "huone:pelaaja", jolle hello on jo lähetetty

  const net = Net.connect("kasino", {
    status(s) {
      $("dot").className = s;
      $("status-text").textContent = STATUS[s];
      $("closed").hidden = s !== "offline";
    },
    room(r) {
      renderOnline(r);
      if (!r) {
        joinedAs = null;
        setTimeout(join, 1000); // esim. ylläpito sulki huoneen tai palvelin käynnistyi uudelleen
        return;
      }
      if (joinedAs !== r.code + ":" + r.you) {
        joinedAs = r.code + ":" + r.you;
        net.send({ type: "hello", guest: guestId });
      }
    },
    message(m) {
      if (m.type === "wallet") {
        wallet = m;
        renderWallet();
        loadRichSoon();
      } else if (m.type === "notice") toast(m.text);
      else if (m.type === "feed") renderFeed(m.items);
      else if (m.type === "sales") {
        sales = m.sales.map((s) => ({ ...s, endsAt: Date.now() + s.msLeft }));
        renderSales();
      }
      else if (ROUTES[m.type]) games[ROUTES[m.type]]?.message(m);
    },
    error(e) {
      toast(e.message);
    },
  });
  const join = () => net.join("*", Account.user?.name || "Vieras");

  for (const [id, game] of Object.entries(games)) game.init(api, $("panel-" + id));
  Account.onChange(() => loadRichSoon());
  showTab();
  loadRich();
  join();
})();
