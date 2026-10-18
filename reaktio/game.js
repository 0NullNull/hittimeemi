(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const ms = (n) => Math.round(n).toLocaleString("fi-FI") + " ms";
  const store = {
    get(key) { try { return localStorage.getItem(key) || ""; } catch { return ""; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  };

  // Tekstit aina textContentilla: nimet tulevat muilta pelaajilta
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  let state = null;   // viimeisin pelitila palvelimelta (server/games/reaktio.js → view)
  let goAt = 0;       // hetki, jolloin vihreä näkyi tällä koneella
  let goRound = 0;
  let local = null;   // oma klikkaus, näytetään heti ennen kuin palvelin vahvistaa sen
  let localRound = 0;

  const STATUS = {
    connecting: "Yhdistetään palvelimeen…",
    online: "Yhteys toimii",
    offline: "Pelipalvelin ei vastaa, yritetään uudelleen…",
  };

  const net = Net.connect("reaktio", {
    status(s) {
      $("dot").className = s;
      $("status-text").textContent = STATUS[s];
      render();
    },
    latency(v) {
      if (net.status === "online") $("status-text").textContent = `Yhteys toimii · ${v} ms`;
    },
    room(r) {
      if (!r) state = null;
      if (r) {
        $("error").textContent = "";
        // kutsulinkin koodi pois osoitteesta, jotta uudelleenlataus ei liity uudestaan
        if (params.has("room")) {
          params.delete("room");
          history.replaceState(null, "", location.pathname + (params.size ? "?" + params : ""));
        }
      }
      render();
    },
    message(m) {
      if (m.type !== "state") return;
      if (m.phase === "go" && goRound !== m.round) {
        goRound = m.round;
        goAt = performance.now();
        requestAnimationFrame(() => (goAt = performance.now())); // vihreä piirtyy tämän jälkeen
      }
      state = m;
      render();
    },
    error(e) {
      $("error").textContent = e.message;
    },
  });

  // ---------- klikkaus ----------

  function press() {
    const r = net.room;
    if (!state || !r || !state.totals[r.you] || state.entries[r.you]) return;
    if (localRound === state.round && local) return;
    if (state.phase === "wait") {
      local = { early: true };
      net.send({ type: "early", round: state.round });
    } else if (state.phase === "go") {
      local = { ms: Math.round(performance.now() - goAt) };
      net.send({ type: "hit", round: state.round, ms: local.ms });
    } else return;
    localRound = state.round;
    render();
  }

  $("pad").addEventListener("pointerdown", (e) => {
    if (e.button === 0) press();
  });
  addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat || e.target.closest("input, button")) return;
    e.preventDefault();
    press();
  });

  // ---------- näkymä ----------

  function render() {
    const r = net.room;
    $("join").hidden = !!r;
    $("game").hidden = !r;
    // yhdistäessä napit toimivat (net.js lähettää komennon heti kun yhteys aukeaa), vain katkoksella ei
    for (const b of [$("create"), $("join-btn")]) b.disabled = net.status === "offline";
    if (!r) return;
    $("room-code").textContent = r.code;
    renderPlayers(r);
    renderPad(r);
  }

  function roundMark(id) {
    if (!state || !state.totals[id] || (state.phase !== "wait" && state.phase !== "go")) return "";
    const e = state.entries[id];
    return !e ? "odottaa…" : e.early ? "liian aikaisin" : e.miss ? "myöhästyi" : ms(e.ms);
  }

  function renderPlayers(r) {
    const totals = state?.totals ?? {};
    const inGame = !!state && state.phase !== "lobby";
    // pisteet näkyvät vasta, kun ensimmäinen kierros on ohi
    const scored = inGame && (state.round > 1 || state.phase === "result" || state.phase === "end");
    const total = (p) => totals[p.id]?.total ?? Infinity;
    const list = inGame ? [...r.players].sort((a, b) => total(a) - total(b)) : r.players;
    $("players").replaceChildren(
      ...list.map((p) => {
        const li = el("li");
        li.classList.toggle("me", p.id === r.you);
        li.classList.toggle("away", !p.connected);
        li.append(el("span", "name", p.name + (p.id === r.you ? " (sinä)" : "")));
        li.append(el("span", "score", scored && totals[p.id] ? ms(totals[p.id].total) : ""));
        const tags = [
          p.id === r.host && "isäntä",
          !p.connected && "yhteys poikki",
          inGame && !totals[p.id] && "katsoja",
          roundMark(p.id),
        ].filter(Boolean);
        if (tags.length) li.append(el("span", "tag", tags.join(" · ")));
        return li;
      }),
    );
  }

  // Kierroksen (tai koko pelin) tulokset nopeimmasta hitaimpaan
  function resultsList(s, me, final) {
    const rows = Object.entries(s.totals)
      .map(([id, t]) => {
        const e = s.entries[id] ?? { miss: true };
        return {
          id,
          name: t.name,
          value: final ? t.total : e.ms ?? s.penalty,
          text: final ? ms(t.total) : e.early ? "liian aikaisin" : e.miss ? "myöhästyi" : ms(e.ms),
          bad: !final && e.ms == null,
        };
      })
      .sort((a, b) => a.value - b.value);
    const ol = el("ol", "results");
    rows.forEach((row, i) => {
      const li = el("li");
      li.classList.toggle("me", row.id === String(me));
      li.append(el("span", "", `${i + 1}. ${row.name}`), el("span", row.bad ? "bad" : "", row.text));
      ol.append(li);
    });
    return ol;
  }

  function renderPad(r) {
    const s = state;
    const me = r.you;
    const hostName = r.players.find((p) => p.id === r.host)?.name ?? "isäntä";
    const startButton = (text) => {
      const b = el("button", "btn primary", text);
      b.onclick = () => net.send({ type: "start" });
      return b;
    };
    const parts = [];
    let cls = "idle";

    if (net.status === "offline") {
      parts.push(el("div", "big", "Yhteys poikki"), el("div", "small", "Pelipalvelin ei vastaa. Yritetään uudelleen…"));
    } else if (!s || s.phase === "lobby") {
      parts.push(el("div", "big", "Valmiina?"));
      parts.push(el("div", "small", r.players.length > 1
        ? `${r.players.length} pelaajaa huoneessa.`
        : "Kutsu kaverit kutsulinkillä tai pelaa yksin."));
      parts.push(net.isHost ? startButton("Aloita peli") : el("div", "small", `Odotetaan, että ${hostName} aloittaa…`));
    } else if (s.phase === "wait" || s.phase === "go") {
      const round = el("div", "round", `Kierros ${s.round}/${s.rounds}`);
      const mine = s.entries[me] ?? (localRound === s.round ? local : null);
      if (!s.totals[me]) {
        cls = s.phase;
        parts.push(round, el("div", "big", s.phase === "go" ? "NYT!" : "Odota…"), el("div", "small", "Seuraat peliä. Pääset mukaan seuraavaan."));
      } else if (mine?.early) {
        cls = "early";
        parts.push(round, el("div", "big", "Liian aikaisin!"), el("div", "small", `+${ms(s.penalty)}`));
      } else if (mine?.miss) {
        cls = "early";
        parts.push(round, el("div", "big", "Myöhästyit!"), el("div", "small", `+${ms(s.penalty)}`));
      } else if (mine) {
        cls = "done";
        parts.push(round, el("div", "big", ms(mine.ms)), el("div", "small", "Odotetaan muita…"));
      } else if (s.phase === "wait") {
        cls = "wait";
        parts.push(round, el("div", "big", "Odota…"), el("div", "small", "Klikkaa heti, kun ruutu muuttuu vihreäksi."));
      } else {
        cls = "go";
        parts.push(round, el("div", "big", "NYT!"));
      }
    } else if (s.phase === "result") {
      parts.push(el("div", "round", `Kierros ${s.round}/${s.rounds}`), resultsList(s, me, false));
      parts.push(el("div", "small", "Seuraava kierros alkaa pian…"));
    } else if (s.phase === "end") {
      const ranking = Object.entries(s.totals).sort((a, b) => a[1].total - b[1].total);
      if (ranking.length === 1) {
        parts.push(el("div", "round", "Yhteisaikasi"), el("div", "big", ms(ranking[0][1].total)));
        if (ranking[0][1].best != null) parts.push(el("div", "small", `Paras reaktio ${ms(ranking[0][1].best)}`));
      } else {
        const [winnerId, winner] = ranking[0] ?? [];
        parts.push(el("div", "big", winnerId === String(me) ? "Voitit!" : winner ? `${winner.name} voitti!` : "Peli päättyi"));
        parts.push(resultsList(s, me, true));
      }
      parts.push(net.isHost ? startButton("Uusi peli") : el("div", "small", `${hostName} voi aloittaa uuden pelin.`));
    }

    $("pad").className = "pad " + cls;
    $("pad").replaceChildren(...parts);
  }

  // ---------- huoneeseen liittyminen ----------

  $("name").value = store.get("rk-name");
  const invited = (params.get("room") || "").trim().toUpperCase();
  if (invited) $("code").value = invited;

  function name() {
    const n = $("name").value.trim();
    if (!n) {
      $("error").textContent = "Anna ensin nimi.";
      $("name").focus();
      return null;
    }
    store.set("rk-name", n);
    $("error").textContent = "";
    return n;
  }

  $("create").onclick = () => {
    const n = name();
    if (n) net.create(n);
  };
  $("join-btn").onclick = () => {
    const code = $("code").value.trim();
    if (!code) {
      $("error").textContent = "Kirjoita huoneen koodi.";
      return $("code").focus();
    }
    const n = name();
    if (n) net.join(code, n);
  };
  $("name").onkeydown = (e) => {
    if (e.key === "Enter") ($("code").value.trim() ? $("join-btn") : $("create")).click();
  };
  $("code").onkeydown = (e) => {
    if (e.key === "Enter") $("join-btn").click();
  };
  $("leave").onclick = () => net.leave();
  $("invite").onclick = async () => {
    const link = new URL(location.pathname, location.origin);
    link.searchParams.set("room", net.room.code);
    if (params.get("server")) link.searchParams.set("server", params.get("server"));
    try {
      await navigator.clipboard.writeText(link.href);
      $("invite").textContent = "Kopioitu!";
    } catch {
      prompt("Kutsulinkki:", link.href);
    }
    setTimeout(() => ($("invite").textContent = "Kopioi kutsulinkki"), 1500);
  };

  // Kutsulinkillä tullut, jonka nimi on jo tiedossa, pääsee suoraan huoneeseen
  if (invited && $("name").value.trim()) net.join(invited, $("name").value.trim());

  render();
})();
