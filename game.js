(() => {
  // Kuinka pitkä pätkä kuullaan kullakin yrityksellä (sekunteina)
  const STEPS = [0.1, 0.5, 1, 2, 5, 10];
  // Kuinka pitkään "Kuuntele koko pätkä" soittaa
  const FULL_LENGTH = 20;
  // Päivä, josta päivän meemien numerointi alkaa
  const EPOCH = Date.UTC(2026, 0, 1);

  const MEMES = window.MEMES || [];
  const $ = (id) => document.getElementById(id);
  const fmt = (s) => s.toFixed(1).replace(".", ",") + " s";
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

  function newGame() {
    stopAudio();
    $("message").textContent = "";
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
      let index = Math.floor(Math.random() * MEMES.length);
      if (game && MEMES.length > 1 && index === game.index) index = (index + 1) % MEMES.length;
      game = { index, guesses: [], done: false, won: false };
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
      101: "Videon omistaja ei salli upottamista",
      150: "Videon omistaja ei salli upottamista",
      153: "YouTube vaatii palvelimen: käynnistä peli start.bat-tiedostolla",
    };

    function api() {
      if (ready) return ready;
      ready = new Promise((resolve, reject) => {
        window.onYouTubeIframeAPIReady = () => {
          player = new YT.Player("yt-player", {
            playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3 },
            events: {
              onReady: () => resolve(),
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
    $("play").textContent = playing ? "■" : "▶";
    $("play-full").textContent = playing ? "■ Pysäytä" : "▶ Kuuntele koko pätkä";
  }

  function render() {
    const g = game.guesses.length;

    $("board").innerHTML = "";
    for (let i = 0; i < STEPS.length; i++) {
      const li = document.createElement("li");
      if (game.guesses[i]) {
        li.className = game.guesses[i].type;
        li.textContent = (game.guesses[i].type === "wrong" ? "✗ " : "") + game.guesses[i].text;
      }
      $("board").appendChild(li);
    }

    const unlocked = game.done ? STEPS.length : g + 1;
    $("bar").innerHTML = STEPS.map((_, i) =>
      `<div class="seg${i < unlocked ? " unlocked" : ""}"><div class="fill"></div></div>`).join("");

    $("limit").textContent = fmt(currentLimit());
    $("time").textContent = fmt(0);

    const last = g >= STEPS.length - 1;
    $("skip").textContent = last ? "Luovuta" : `Ohita (+${fmt(STEPS[g + 1] - STEPS[g])})`;

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
    $("result-title").textContent = game.won
      ? `Oikein! ${fmt(STEPS[game.guesses.length - 1])} riitti 🎉`
      : "Ei tällä kertaa 😔";
    $("result-answer").textContent = meme().title;

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
    const secs = Math.floor((midnight - now) / 1000);
    const pad = (n) => String(n).padStart(2, "0");
    $("countdown").textContent =
      `Uusi meemi ${Math.floor(secs / 3600)}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)} kuluttua`;
  }

  setInterval(() => {
    if (mode !== "daily") return;
    if (todayNumber() !== day) newGame();
    else if (game.done) updateCountdown();
  }, 1000);

  async function share() {
    const squares = STEPS.map((_, i) => {
      const g = game.guesses[i];
      if (!g) return "⬜";
      return { correct: "🟩", wrong: "🟥", skip: "⬛" }[g.type];
    }).join("");
    const url = location.protocol.startsWith("http") ? "\n" + location.href.split("#")[0] : "";
    const text = `Hittimeemi #${day + 1}\n🔊${squares}${url}`;
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
      [m.title, ...(m.aliases || [])].some((name) => norm(name).includes(q))).slice(0, 8);
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
  $("next").addEventListener("click", newGame);
  $("share").addEventListener("click", share);

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
