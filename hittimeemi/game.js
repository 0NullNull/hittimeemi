(() => {
  // Kuinka pitkä pätkä kuullaan kullakin yrityksellä (sekunteina)
  const STEPS = [0.5, 1, 2, 4, 8, 15];
  // Kuinka pitkään "Kuuntele pidempi pätkä" soittaa
  const FULL_LENGTH = 30;
  // Päivä, josta päivän meemien numerointi alkaa
  const EPOCH = Date.UTC(2026, 0, 1);

  const MEMES = window.MEMES || [];
  const $ = (id) => document.getElementById(id);
  const fmt = (s) => s.toFixed(1).replace(".", ",") + " s";
  // Pätkän pituus ilman turhaa desimaalia: "0,5 s", "2 s"
  const secs = (s) => String(+s.toFixed(1)).replace(".", ",") + " s";
  const norm = (s) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    },
  };

  // ---------- Meemilistan lukeminen ----------

  // "75", "75.5", "75s", "1m15s", "1:15", "1:02:03"
  function parseTime(t) {
    t = String(t).trim();
    if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
    if (t.includes(":")) return t.split(":").reduce((acc, part) => acc * 60 + parseFloat(part || 0), 0);
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (parseFloat(m[3]) || 0) : null;
  }

  function parseYouTube(link) {
    try {
      const u = new URL(link);
      const id = u.hostname.endsWith("youtu.be")
        ? u.pathname.slice(1, 12)
        : u.searchParams.get("v") || (u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/) || [])[1];
      const t = u.searchParams.get("t") || u.searchParams.get("start");
      return { id: id || null, start: t ? parseTime(t) : null };
    } catch {
      return { id: /^[\w-]{11}$/.test(link) ? link : null, start: null };
    }
  }

  for (const m of MEMES) {
    if (m.youtube) {
      const yt = parseYouTube(m.youtube);
      m.videoId = yt.id;
      if (m.start == null) m.start = yt.start;
    }
    m.start = parseTime(m.start ?? 0) || 0;
  }

  // ---------- Päivän meemi ----------

  function todayNumber() {
    const d = new Date();
    return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 864e5);
  }

  function seededRandom(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Sekoittaa listan joka "kierroksella" eri järjestykseen, joten sama meemi
  // ei toistu ennen kuin kaikki on käyty läpi.
  function dailyIndex(day) {
    const n = MEMES.length;
    const rand = seededRandom(1000 + Math.floor(day / n));
    const order = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order[((day % n) + n) % n];
  }

  // ---------- Pelitila ----------

  let mode = "daily";
  let day = todayNumber();
  let game = null; // { index, guesses: [{type, text}], done, won }

  const meme = () => MEMES[game.index];

  // Vapaa pelaus toimii kuin sekoitettu korttipakka: jokainen meemi tulee kerran
  // ennen kuin mikään toistuu. Meemi lasketaan pelatuksi vasta, kun sen kierros
  // on loppunut. Pelatut tallennetaan nimellä, joten listan muokkaaminen ei
  // sotke kirjanpitoa (poistetut eivät lasketa, uudet ovat pelaamattomia).
  function freeDone() {
    const titles = new Set(MEMES.map((m) => m.title));
    return new Set(store.get("hm-free-done", []).filter((t) => titles.has(t)));
  }

  function pickFreeIndex() {
    const done = freeDone();
    const notCurrent = (i) => !game || MEMES.length < 2 || i !== game.index;
    let options = MEMES.map((_, i) => i).filter((i) => !done.has(MEMES[i].title) && notCurrent(i));
    if (!options.length) {
      // Kaikki pelattu: uusi kierros alkaa, mutta ei heti samalla meemillä
      store.set("hm-free-done", []);
      options = MEMES.map((_, i) => i).filter(notCurrent);
    }
    return options[Math.floor(Math.random() * options.length)];
  }

  function saveFree() {
    if (mode !== "free") return;
    store.set("hm-free-current", { title: meme().title, ...game });
    if (game.done) store.set("hm-free-done", [...freeDone().add(meme().title)]);
  }

  function newGame(forceNew = false) {
    stopAudio();
    $("message").textContent = "";
    $("yt-help").hidden = true;
    $("guess").value = "";
    hideSuggestions();

    if (mode === "daily") {
      day = todayNumber();
      const index = dailyIndex(day);
      const saved = store.get("hm-daily", null);
      game = saved && saved.day === day && saved.title === MEMES[index].title
        ? { index, guesses: saved.guesses, done: saved.done, won: saved.won }
        : { index, guesses: [], done: false, won: false };
    } else {
      // Jatketaan kesken jäänyttä kierrosta (esim. sivun päivityksen jälkeen)
      const saved = store.get("hm-free-current", null);
      const index = saved ? MEMES.findIndex((m) => m.title === saved.title) : -1;
      if (!forceNew && index >= 0) {
        game = { index, guesses: saved.guesses, done: saved.done, won: saved.won };
      } else {
        game = { index: pickFreeIndex(), guesses: [], done: false, won: false };
        saveFree();
      }
    }

    backend = meme().videoId ? youtubeBackend : fileBackend;
    backend.load(meme());
    render();
  }

  function saveDaily() {
    if (mode !== "daily") return;
    store.set("hm-daily", { day, title: meme().title, ...game });
  }

  function recordStats() {
    if (mode !== "daily") return;
    const s = store.get("hm-stats", { played: 0, won: 0, streak: 0, maxStreak: 0, lastWinDay: null });
    s.played++;
    if (game.won) {
      s.won++;
      s.streak = s.lastWinDay === day - 1 ? s.streak + 1 : 1;
      s.maxStreak = Math.max(s.maxStreak, s.streak);
      s.lastWinDay = day;
    } else {
      s.streak = 0;
    }
    store.set("hm-stats", s);
  }

  function addGuess(entry) {
    game.guesses.push(entry);
    if (entry.type === "correct") {
      game.done = true;
      game.won = true;
    } else if (game.guesses.length >= STEPS.length) {
      game.done = true;
    }
    if (game.done) recordStats();
    saveDaily();
    saveFree();
    stopAudio();
    render();
  }

  function findMeme(text) {
    const q = norm(text);
    if (!q) return null;
    return MEMES.find((m) => [m.title, ...(m.aliases || [])].some((name) => norm(name) === q)) || null;
  }

  function submitGuess() {
    if (game.done) return;
    const picked = findMeme($("guess").value);
    if (!picked) {
      $("message").textContent = "Valitse meemi ehdotuslistasta.";
      return;
    }
    if (game.guesses.some((g) => g.text === picked.title)) {
      $("message").textContent = "Arvasit jo tämän.";
      return;
    }
    $("message").textContent = "";
    $("guess").value = "";
    hideSuggestions();
    addGuess({ type: picked === meme() ? "correct" : "wrong", text: picked.title });
  }

  function skip() {
    if (game.done) return;
    $("message").textContent = "";
    addGuess({ type: "skip", text: "Ohitettu" });
  }

  // ---------- Ääni ----------
  // Kaksi soitinta samalla rajapinnalla: omat äänitiedostot ja YouTube.
  // Kumpikin kutsuu clipStarted(), kun ääni oikeasti alkaa kuulua.

  let backend = null;
  let playing = false;
  let playLimit = 0;
  let safetyTimer = null;
  let volume = store.get("hm-volume", 80); // 0–100

  const fileBackend = (() => {
    const audio = new Audio();
    audio.preload = "auto";
    let current = null;
    audio.addEventListener("playing", () => clipStarted());
    audio.addEventListener("ended", () => stopAudio());

    function waitForMetadata() {
      if (audio.readyState >= 1) return Promise.resolve();
      return new Promise((resolve, reject) => {
        audio.addEventListener("loadedmetadata", resolve, { once: true });
        audio.addEventListener("error", reject, { once: true });
      });
    }

    return {
      load(m) { current = m; audio.src = m.file || ""; if (m.file) audio.load(); },
      async play() {
        if (!current.file) throw new Error("Meemiltä puuttuu file tai youtube");
        await waitForMetadata();
        audio.currentTime = current.start;
        await audio.play();
      },
      stop() { audio.pause(); },
      elapsed() { return audio.currentTime - current.start; },
      setVolume(v) { audio.volume = v / 100; },
    };
  })();

  const youtubeBackend = (() => {
    let player = null;
    let ready = null;
    let current = null;
    let wantPlay = false;
    let startedAt = 0;

    const ERRORS = {
      2: "Virheellinen YouTube-linkki",
      5: "Videota ei voi toistaa selaimessa",
      100: "Videota ei löytynyt (poistettu tai yksityinen)",
      // YouTube käyttää samaa koodia myös silloin, kun se epäilee yhteyttä botiksi
      101: "YouTube ei toista tätä videota",
      150: "YouTube ei toista tätä videota",
      153: "YouTube vaatii palvelimen: käynnistä peli start.bat-tiedostolla",
    };

    function api() {
      if (ready) return ready;
      ready = new Promise((resolve, reject) => {
        window.onYouTubeIframeAPIReady = () => {
          player = new YT.Player("yt-player", {
            playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3 },
            events: {
              onReady: () => { player.setVolume(volume); resolve(); },
              onStateChange: (e) => {
                if (e.data === YT.PlayerState.PLAYING && wantPlay) {
                  wantPlay = false;
                  startedAt = performance.now();
                  clipStarted();
                } else if (e.data === YT.PlayerState.ENDED) {
                  stopAudio();
                }
              },
              onError: (e) => {
                stopAudio();
                // Näytetään video-id eikä nimeä, ettei vastaus paljastu
                $("message").textContent = `${ERRORS[e.data] || "YouTube-virhe " + e.data} (video ${current.videoId})`;
                // 101/150: joko upotus estetty tai YouTube vaatii kirjautumisen → tarjotaan korjausnapit
                if (e.data === 101 || e.data === 150) $("yt-help").hidden = false;
              },
            },
          });
        };
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.onerror = () => reject(new Error("YouTube ei latautunut"));
        document.head.appendChild(script);
      });
      return ready;
    }

    return {
      load(m) {
        current = m;
        api().then(() => player.cueVideoById({ videoId: m.videoId, startSeconds: m.start })).catch(() => {});
      },
      async play() {
        await api();
        wantPlay = true;
        player.seekTo(current.start, true);
        player.playVideo();
      },
      stop() { wantPlay = false; if (player && player.pauseVideo) player.pauseVideo(); },
      elapsed() { return (performance.now() - startedAt) / 1000; },
      setVolume(v) { if (player && player.setVolume) player.setVolume(v); },
    };
  })();

  async function playClip(limit) {
    if (playing) { stopAudio(); return; }
    playLimit = limit;
    playing = true;
    updatePlayButtons();
    try {
      await backend.play();
    } catch {
      playing = false;
      updatePlayButtons();
      $("message").textContent = meme().videoId
        ? "YouTube ei latautunut. Onko netti päällä?"
        : `Äänitiedostoa ei voitu soittaa: ${meme().file || "(puuttuu)"}`;
    }
  }

  function clipStarted() {
    if (!playing) return;
    clearTimeout(safetyTimer);
    // Varmistus siltä varalta, että selain ei piirrä (esim. välilehti taustalla)
    safetyTimer = setTimeout(stopAudio, playLimit * 1000 + 300);
    requestAnimationFrame(tick);
  }

  function tick() {
    if (!playing) return;
    const elapsed = backend.elapsed();
    if (elapsed >= playLimit) { stopAudio(); return; }
    showProgress(elapsed);
    requestAnimationFrame(tick);
  }

  function stopAudio() {
    clearTimeout(safetyTimer);
    if (backend) backend.stop();
    playing = false;
    if (game) { showProgress(0); updatePlayButtons(); }
  }

  // ---------- Näkymä ----------

  function showProgress(elapsed) {
    $("time").textContent = fmt(Math.max(0, elapsed));
    document.querySelectorAll("#bar .fill").forEach((fill, i) => {
      const lo = i ? STEPS[i - 1] : 0;
      const ratio = (elapsed - lo) / (STEPS[i] - lo);
      fill.style.width = Math.min(100, Math.max(0, ratio * 100)) + "%";
    });
  }

  function updatePlayButtons() {
    $("play").classList.toggle("playing", playing);
    $("play").setAttribute("aria-label", playing ? "Pysäytä" : "Soita");
    $("play-full").textContent = playing ? "■ Pysäytä" : "▶ Kuuntele pidempi pätkä";
  }

  const ICONS = { wrong: "✕", skip: "↷", correct: "✓" };

  // Vapaan pelauksen laskuri: montako meemiä tällä kierroksella on vielä pelaamatta
  function renderProgress() {
    $("progress").hidden = mode !== "free";
    if (mode !== "free") return;
    const total = MEMES.length;
    const left = total - freeDone().size;
    $("progress-bar").style.width = ((total - left) / total) * 100 + "%";
    $("progress-text").textContent = left === 0
      ? `Kaikki ${total} meemiä pelattu! 🎉 Seuraavasta alkaa uusi kierros.`
      : `${left} / ${total} meemiä jäljellä`;
  }

  function render() {
    const g = game.guesses.length;

    $("board").innerHTML = "";
    for (let i = 0; i < STEPS.length; i++) {
      const guess = game.guesses[i];
      const li = document.createElement("li");
      li.innerHTML = `<span class="len">${secs(STEPS[i])}</span><span class="txt"></span><span class="icon"></span>`;
      if (guess) {
        li.className = guess.type;
        li.querySelector(".txt").textContent = guess.text;
        li.querySelector(".icon").textContent = ICONS[guess.type];
      } else if (!game.done && i === g) {
        li.className = "current";
        li.querySelector(".txt").textContent = "Kuuntele ja arvaa";
      }
      $("board").appendChild(li);
    }

    const unlocked = game.done ? STEPS.length : g + 1;
    $("bar").innerHTML = STEPS.map((_, i) =>
      `<div class="seg${i < unlocked ? " unlocked" : ""}"><div class="fill"></div></div>`).join("");
    $("ticks").innerHTML = STEPS.map((s, i) =>
      `<span${i < unlocked ? ' class="unlocked"' : ""}>${String(s).replace(".", ",")}</span>`).join("");

    $("limit").textContent = fmt(currentLimit());
    $("time").textContent = fmt(0);

    const last = g >= STEPS.length - 1;
    $("skip").textContent = last ? "Luovuta" : `Ohita (+${secs(STEPS[g + 1] - STEPS[g])})`;

    renderProgress();
    $("input-area").hidden = game.done;
    $("result").hidden = !game.done;
    // Video piilotetaan arvailun ajaksi ja näytetään, kun kierros on ohi
    $("yt-wrap").classList.toggle("revealed", game.done && !!meme().videoId);
    if (game.done) renderResult();
    updatePlayButtons();
  }

  function currentLimit() {
    return game.done ? FULL_LENGTH : STEPS[Math.min(game.guesses.length, STEPS.length - 1)];
  }

  function renderResult() {
    $("result-emoji").textContent = game.won ? (game.guesses.length === 1 ? "🤯" : "🎉") : "😔";
    $("result-title").textContent = game.won
      ? `Oikein! ${secs(STEPS[game.guesses.length - 1])} riitti`
      : "Ei tällä kertaa";
    $("result-answer").textContent = meme().title;
    $("result-squares").textContent = squares();

    const daily = mode === "daily";
    $("share").hidden = !daily;
    $("countdown").hidden = !daily;
    $("stats").hidden = !daily;
    $("next").hidden = daily;

    if (daily) {
      const s = store.get("hm-stats", { played: 0, won: 0, streak: 0, maxStreak: 0 });
      const pct = s.played ? Math.round((s.won / s.played) * 100) : 0;
      $("stats").innerHTML = [
        [s.played, "Pelattu"], [pct + " %", "Voitettu"], [s.streak, "Putki"], [s.maxStreak, "Paras putki"],
      ].map(([v, label]) => `<div><b>${v}</b><span>${label}</span></div>`).join("");
      updateCountdown();
    }
  }

  function updateCountdown() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const left = Math.floor((midnight - now) / 1000);
    const pad = (n) => String(n).padStart(2, "0");
    $("countdown").textContent =
      `Uusi meemi ${Math.floor(left / 3600)}:${pad(Math.floor(left / 60) % 60)}:${pad(left % 60)} kuluttua`;
  }

  setInterval(() => {
    if (mode !== "daily") return;
    if (todayNumber() !== day) newGame();
    else if (game.done) updateCountdown();
  }, 1000);

  function squares() {
    return STEPS.map((_, i) => {
      const g = game.guesses[i];
      if (!g) return "⬜";
      return { correct: "🟩", wrong: "🟥", skip: "⬛" }[g.type];
    }).join("");
  }

  async function share() {
    const url = location.protocol.startsWith("http") ? "\n" + location.href.split("#")[0] : "";
    const text = `Hittimeemi #${day + 1}\n🔊${squares()}${url}`;
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        $("countdown").textContent = "Tulos kopioitu leikepöydälle!";
      }
    } catch {}
  }

  // ---------- Ehdotukset ----------

  let activeSuggestion = -1;

  function showSuggestions() {
    const q = norm($("guess").value);
    const list = $("suggestions");
    activeSuggestion = -1;
    if (!q) { hideSuggestions(); return; }
    const matches = MEMES.filter((m) =>
      [m.title, ...(m.aliases || [])].some((name) => norm(name).includes(q))).slice(0, 20);
    if (!matches.length) { hideSuggestions(); return; }
    list.innerHTML = "";
    for (const m of matches) {
      const li = document.createElement("li");
      li.textContent = m.title;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        $("guess").value = m.title;
        hideSuggestions();
      });
      list.appendChild(li);
    }
    list.hidden = false;
  }

  function hideSuggestions() {
    $("suggestions").hidden = true;
    activeSuggestion = -1;
  }

  $("guess").addEventListener("input", showSuggestions);
  $("guess").addEventListener("blur", hideSuggestions);
  $("guess").addEventListener("keydown", (e) => {
    const items = [...$("suggestions").children];
    const open = !$("suggestions").hidden && items.length;
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      activeSuggestion = (activeSuggestion + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle("active", i === activeSuggestion));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && activeSuggestion >= 0) {
        $("guess").value = items[activeSuggestion].textContent;
        hideSuggestions();
      } else {
        submitGuess();
      }
    } else if (e.key === "Escape") {
      hideSuggestions();
    }
  });

  // ---------- Napit ----------

  $("play").addEventListener("click", () => playClip(currentLimit()));
  $("play-full").addEventListener("click", () => playClip(FULL_LENGTH));
  $("submit").addEventListener("click", submitGuess);
  $("skip").addEventListener("click", skip);
  $("next").addEventListener("click", () => newGame(true));
  // Kierroksen tila on tallessa, joten sivun uudelleenlataus jatkaa samasta kohdasta
  $("yt-retry").addEventListener("click", () => location.reload());
  $("share").addEventListener("click", share);

  // ---------- Äänenvoimakkuus ----------

  let volumeBeforeMute = volume || 80;

  function applyVolume() {
    fileBackend.setVolume(volume);
    youtubeBackend.setVolume(volume);
    $("volume").value = volume;
    $("volume").style.setProperty("--val", volume + "%");
    $("mute").classList.toggle("muted", volume === 0);
    $("mute").setAttribute("aria-label", volume === 0 ? "Palauta ääni" : "Mykistä");
    store.set("hm-volume", volume);
  }

  $("volume").addEventListener("input", (e) => { volume = +e.target.value; applyVolume(); });
  $("mute").addEventListener("click", () => {
    if (volume > 0) { volumeBeforeMute = volume; volume = 0; } else { volume = volumeBeforeMute; }
    applyVolume();
  });
  applyVolume();
  $("help-btn").addEventListener("click", () => $("help").showModal());
  $("help-first").textContent = secs(STEPS[0]).replace(" s", " sekuntia");
  const rest = STEPS.slice(1).map(secs);
  $("help-steps").textContent = rest.slice(0, -1).join(", ") + " ja " + rest[rest.length - 1];
  // Ohjeet näytetään automaattisesti ensimmäisellä käynnillä
  if (!store.get("hm-seen-help", false)) {
    $("help").showModal();
    store.set("hm-seen-help", true);
  }

  document.querySelectorAll(".modes button").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === mode) return;
      mode = btn.dataset.mode;
      document.querySelectorAll(".modes button").forEach((b) => b.classList.toggle("active", b === btn));
      newGame();
    }));

  if (!MEMES.length) {
    $("message").textContent = "Lisää meemejä tiedostoon memes.js.";
    return;
  }
  newGame();
  if (location.protocol === "file:" && MEMES.some((m) => m.videoId)) {
    $("message").textContent = "YouTube-klipit toimivat vain, kun peli käynnistetään start.bat-tiedostolla.";
  }
})();
