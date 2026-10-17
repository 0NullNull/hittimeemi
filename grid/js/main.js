// 50 Hz – käynnistys, pelisilmukka ja tallennus.
(async function () {
  const G = window.GridGame;
  const SAVE_KEY = "grid-save-v1";
  const $ = (id) => document.getElementById(id);
  const SPEEDS = [0, 1, 60, 600, 3600, 21600, 86400];

  const data = await G.loadData(
    async (p) => (await fetch(p)).arrayBuffer(),
    async (p) => (await fetch(p)).json(),
  );

  const app = {
    sim: null,
    speedIdx: 3,
    get speed() { return SPEEDS[this.speedIdx]; },
    lastSpeed: 3,
    setSpeed(i) {
      this.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, i));
      if (i > 0) this.lastSpeed = i;
      this.ui.renderPanels(true);
    },
    togglePause() { this.setSpeed(this.speedIdx === 0 ? this.lastSpeed : 0); },
  };
  app.ui = new G.UI(app);

  function startSim(sim) {
    app.sim = sim;
    sim.on((e) => app.ui.onEvent(e));
    app.ui.setSimStatic();
    app.ui.sel = { kind: "bus", id: sim.state.startTown };
    app.ui.panelDirty = true;
    app.ui.updateHint();
    // pari askelta, jotta kojelauta saa arvot heti
    sim.step(1);
    app.ui.renderPanels(true);
  }

  function save() {
    if (!app.sim || app.preview) return;
    try { localStorage.setItem(SAVE_KEY, app.sim.serialize()); } catch {}
  }

  function showStart() {
    // taustalle esikatselu, jotta kartta näkyy valinnan aikana
    app.preview = true;
    startSim(G.Sim.newGame(data, "Kajaani", 1));
    app.ui.sel = null;
    const towns = app.sim.buses.filter((b) => b.kind === "town").sort((a, b) => b.pop - a.pop);
    $("start-list").innerHTML = towns.map((b) => `<button data-town="${b.name}"><b>${b.name}</b><span>${new Intl.NumberFormat("fi-FI").format(b.pop)} as. · ≈ ${Math.round(data.nationalLoad(0) * b.share)} MW</span></button>`).join("");
    $("dlg-start").showModal();
  }
  $("start-list").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $("dlg-start").close();
    app.preview = false;
    startSim(G.Sim.newGame(data, b.dataset.town));
    save();
    if (!localStorage.getItem("grid-seen-help")) { $("dlg-help").showModal(); try { localStorage.setItem("grid-seen-help", "1"); } catch {} }
  });
  $("dlg-start").addEventListener("cancel", (e) => e.preventDefault());

  // valikko
  $("m-export").addEventListener("click", async () => {
    const text = btoa(unescape(encodeURIComponent(app.sim.serialize())));
    try { await navigator.clipboard.writeText(text); app.ui.toast("Tallennus kopioitu leikepöydälle.", "good"); }
    catch { prompt("Kopioi tallennus:", text); }
  });
  $("m-import").addEventListener("click", () => {
    const text = prompt("Liitä tallennus:");
    if (!text) return;
    try {
      const json = decodeURIComponent(escape(atob(text.trim())));
      startSim(G.Sim.restore(data, json));
      save();
      $("dlg-menu").close();
      app.ui.toast("Tallennus ladattu.", "good");
    } catch { app.ui.toast("Tallennus ei kelpaa.", "high"); }
  });
  $("m-new").addEventListener("click", () => {
    if (!confirm("Aloitetaanko uusi peli? Nykyinen verkko katoaa.")) return;
    try { localStorage.removeItem(SAVE_KEY); } catch {}
    $("dlg-menu").close();
    showStart();
  });

  // tallennettu peli vai uusi
  let saved = null;
  try { saved = localStorage.getItem(SAVE_KEY); } catch {}
  if (saved) {
    try { startSim(G.Sim.restore(data, saved)); } catch { saved = null; }
  }
  if (!saved) showStart();
  $("loading").hidden = true;

  setInterval(save, 20000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
  window.addEventListener("pagehide", save);

  // pelisilmukka
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const paused = app.preview || document.querySelector("dialog[open]");
    if (app.sim && app.speed > 0 && !paused) app.sim.advance(dt * app.speed, app.speed);
    app.ui.render(now);
    app.ui.renderPanels();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.GridApp = app; // kehitystä ja testejä varten
})();
