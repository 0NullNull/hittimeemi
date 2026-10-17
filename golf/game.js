(() => {
  const G = window.Golf, L = window.GolfLevels;
  const { W, H, BALL_R, PORTAL_R, MODS } = G;
  const STEP = 1 / 120;      // fysiikan aika-askel
  const MAX_STROKES = 10;    // reikä päättyy viimeistään tähän
  const DRAG_MAX = 220;      // näin pitkä veto = täysi lyönti

  const $ = (id) => document.getElementById(id);
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  };

  const canvas = $("course");
  const ctx = canvas.getContext("2d");
  let dpr = 1;

  // ---------- Tila ----------
  let mode = "daily";
  let course = null;      // { day?, modifier, windDir, holes }
  let holeIdx = 0;
  let scores = [];        // valmiiden reikien lyönnit
  let strokes = 0;
  let world = null, ball = null, lastShot = null;
  let phase = "aim";      // aim | rolling | water | sinking | between | done
  let aim = null;         // hiiren paikka tähdätessä
  let staticLayer = null;
  let simT = 0, anim = 0, sinkStart = 0;
  let effects = [];       // roiskeet ja välähdykset
  let practiceCount = 0, practiceDiff = 0;

  const par = () => course.holes[holeIdx].par;

  function scoreName(s, p) {
    if (s === 1) return "Hole-in-one!";
    const d = s - p;
    return { "-3": "Albatrossi!", "-2": "Eagle!", "-1": "Birdie!", 0: "Par", 1: "Bogey", 2: "Tuplabogey" }[d] || (d > 0 ? `+${d}` : `${d}`);
  }
  const fmtDiff = (d) => (d === 0 ? "±0" : d > 0 ? `+${d}` : `${d}`);
  const square = (s, p) => (s < p ? "🟦" : s === p ? "🟩" : s === p + 1 ? "🟨" : "🟥");

  // ---------- Radan lataus ----------

  function loadHole(i, resume = null) {
    holeIdx = i;
    world = G.buildWorld(course.holes[i], course.modifier, course.windDir);
    strokes = resume ? resume.strokes : 0;
    ball = G.newBall(resume ? resume.x : world.start.x, resume ? resume.y : world.start.y, simT);
    lastShot = { x: ball.x, y: ball.y };
    phase = "aim";
    aim = null;
    effects = [];
    staticLayer = null;
    renderInfo();
  }

  function startDaily() {
    mode = "daily";
    const day = L.todayNumber();
    course = L.dailyCourse(day);
    const saved = store.get("golf-daily", null);
    if (saved && saved.day === day) {
      scores = saved.scores || [];
      if (saved.done) {
        loadHole(course.holes.length - 1);
        phase = "done";
        renderResult();
      } else {
        loadHole(saved.holeIdx || 0, saved.ball ? { strokes: saved.strokes || 0, x: saved.ball.x, y: saved.ball.y } : null);
      }
    } else {
      scores = [];
      loadHole(0);
      saveDaily();
    }
    renderInfo();
  }

  function startPractice() {
    mode = "practice";
    const p = L.practiceHole();
    course = { modifier: p.modifier, windDir: p.windDir, holes: [p.hole] };
    scores = [];
    practiceCount++;
    loadHole(0);
    $("result").hidden = true;
  }

  function saveDaily(extra = {}) {
    if (mode !== "daily") return;
    const prev = store.get("golf-daily", {});
    store.set("golf-daily", {
      ...(prev.day === course.day ? prev : {}),
      day: course.day,
      holeIdx,
      scores,
      strokes,
      ball: phase === "aim" ? { x: ball.x, y: ball.y } : { x: lastShot.x, y: lastShot.y },
      done: false,
      ...extra,
    });
  }

  // ---------- Pelitapahtumat ----------

  function onShoot(angle, power) {
    lastShot = { x: ball.x, y: ball.y };
    strokes++;
    G.shoot(world, ball, angle, power);
    phase = "rolling";
    renderInfo();
  }

  function onStop() {
    phase = "aim";
    if (strokes >= MAX_STROKES) { finishHole(MAX_STROKES, "Lyönnit loppuivat"); return; }
    saveDaily();
  }

  function onWater() {
    phase = "water";
    effects.push({ type: "splash", x: ball.x, y: ball.y, t: anim });
    strokes++;
    toast("Splash!", "+1 lyönti", 900);
    renderInfo();
    setTimeout(() => {
      ball = G.newBall(lastShot.x, lastShot.y, simT);
      phase = "aim";
      if (strokes >= MAX_STROKES) finishHole(MAX_STROKES, "Lyönnit loppuivat");
      else saveDaily();
    }, 750);
  }

  function onSunk() {
    phase = "sinking";
    sinkStart = anim;
    ball.vx = ball.vy = 0;
    setTimeout(() => finishHole(strokes), 450);
  }

  function finishHole(s, note) {
    phase = "between";
    scores[holeIdx] = s;
    toast(scoreName(s, par()), note || `${s} ${s === 1 ? "lyönti" : "lyöntiä"} · par ${par()}`, 1500);
    renderInfo();

    if (mode === "practice") {
      practiceDiff += s - par();
      renderInfo();
      setTimeout(startPractice, 1700);
      return;
    }
    const last = holeIdx === course.holes.length - 1;
    saveDaily({ holeIdx: last ? holeIdx : holeIdx + 1, strokes: 0, ball: null });
    setTimeout(() => (last ? finishCourse() : loadHole(holeIdx + 1)), 1700);
  }

  function finishCourse() {
    phase = "done";
    const total = scores.reduce((a, b) => a + b, 0);
    const prev = store.get("golf-daily", {});
    const best = prev.best && prev.best.total <= total ? prev.best : { scores: [...scores], total };
    const firstFinish = !prev.best;
    store.set("golf-daily", { ...prev, day: course.day, scores, done: true, best });

    if (firstFinish) {
      const s = store.get("golf-stats", { played: 0, streak: 0, bestStreak: 0, lastDay: null, bestDiff: null });
      const diff = total - coursePar();
      s.played++;
      s.streak = s.lastDay === course.day - 1 ? s.streak + 1 : 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      s.lastDay = course.day;
      s.bestDiff = s.bestDiff === null ? diff : Math.min(s.bestDiff, diff);
      store.set("golf-stats", s);
    }
    renderInfo();
    renderResult();
  }

  const coursePar = () => course.holes.reduce((a, h) => a + h.par, 0);

  // ---------- Fysiikkasilmukka ----------

  let lastTime = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    acc += dt;
    anim += dt;
    while (acc >= STEP) {
      acc -= STEP;
      simT += STEP;
      tick(STEP);
    }
    draw();
    requestAnimationFrame(frame);
  }

  function tick(dt) {
    if (!world || !(phase === "aim" || phase === "rolling")) return;
    ball.t = simT;
    const ev = G.step(world, ball, dt);
    if (ball.bumped) { effects.push({ type: "bump", x: ball.x, y: ball.y, t: anim }); ball.bumped = false; }
    if (ev === "sunk") return onSunk();
    if (ev === "water") return onWater();
    if (phase === "aim") {
      // esim. magneetti tai liikkuva seinä liikautti palloa
      if (ev !== "stop" && Math.hypot(ball.vx, ball.vy) > 0) { phase = "rolling"; aim = null; }
      return;
    }
    if (ev === "stop") onStop();
  }

  // ---------- Piirto ----------

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    staticLayer = null;
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.roundRect(x, y, w, h, r);
  }

  function renderStatic() {
    const off = document.createElement("canvas");
    off.width = W * dpr;
    off.height = H * dpr;
    const c = off.getContext("2d");
    c.scale(dpr, dpr);

    // nurmi raidoilla
    c.fillStyle = "#2f9e5b";
    c.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 100) {
      c.fillStyle = "rgba(255,255,255,0.045)";
      c.fillRect(x, 0, 50, H);
    }
    const vignette = c.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 700);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.22)");
    c.fillStyle = vignette;
    c.fillRect(0, 0, W, H);

    // hiekka pilkuilla
    for (const r of world.sand) {
      c.fillStyle = "#e6cc8f";
      roundRect(c, r.x, r.y, r.w, r.h, 18);
      c.fill();
      c.save();
      c.clip();
      c.fillStyle = "rgba(150,110,50,0.25)";
      let seed = r.x * 7 + r.y * 13;
      for (let i = 0; i < (r.w * r.h) / 120; i++) {
        seed = (seed * 9301 + 49297) % 233280;
        const px = r.x + (seed / 233280) * r.w;
        seed = (seed * 9301 + 49297) % 233280;
        const py = r.y + (seed / 233280) * r.h;
        c.fillRect(px, py, 2, 2);
      }
      c.restore();
    }

    // veden pohja
    for (const r of world.water) {
      c.fillStyle = "#1f6fbf";
      roundRect(c, r.x, r.y, r.w, r.h, 16);
      c.fill();
      c.strokeStyle = "rgba(255,255,255,0.35)";
      c.lineWidth = 3;
      c.stroke();
    }

    // kiihdyttimien pohja
    for (const b of world.boosts) {
      c.save();
      c.translate(b.x + b.w / 2, b.y + b.h / 2);
      c.rotate((b.deg * Math.PI) / 180);
      c.fillStyle = "#c2410c";
      roundRect(c, -b.w / 2, -b.h / 2, b.w, b.h, 10);
      c.fill();
      c.restore();
    }

    // reikä
    c.fillStyle = "#0e1a12";
    c.beginPath();
    c.arc(world.hole.x, world.hole.y, world.hole.r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.55)";
    c.lineWidth = 2;
    c.stroke();

    // laatikot ja reunat
    const wall = "#efe6d2", wallEdge = "#a8997a";
    for (const b of world.blocks) {
      c.fillStyle = "rgba(0,0,0,0.25)";
      roundRect(c, b.x + 4, b.y + 6, b.w, b.h, 6);
      c.fill();
    }
    for (const b of world.blocks) {
      c.fillStyle = wall;
      roundRect(c, b.x, b.y, b.w, b.h, 6);
      c.fill();
      c.strokeStyle = wallEdge;
      c.lineWidth = 2;
      c.stroke();
    }
    c.strokeStyle = wall;
    c.lineCap = "round";
    c.lineWidth = 8;
    for (const s of world.segs.slice(4 + world.blocks.length * 4)) {
      c.beginPath();
      c.moveTo(s.x1, s.y1);
      c.lineTo(s.x2, s.y2);
      c.stroke();
    }
    c.lineWidth = 12;
    c.strokeStyle = wall;
    c.strokeRect(6, 6, W - 12, H - 12);
    return off;
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!world) return;
    if (!staticLayer) staticLayer = renderStatic();
    ctx.drawImage(staticLayer, 0, 0, W, H);

    // aallot
    for (const r of world.water) {
      ctx.save();
      roundRect(ctx, r.x, r.y, r.w, r.h, 16);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 2;
      for (let y = r.y + 12; y < r.y + r.h; y += 18) {
        ctx.beginPath();
        for (let x = r.x; x <= r.x + r.w; x += 8) {
          const yy = y + Math.sin(x / 18 + anim * 2 + y) * 3;
          x === r.x ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // kiihdyttimien liikkuvat nuolet
    for (const b of world.boosts) {
      ctx.save();
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      ctx.rotate((b.deg * Math.PI) / 180);
      roundRect(ctx, -b.w / 2, -b.h / 2, b.w, b.h, 10);
      ctx.clip();
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      const off = (anim * 70) % 26;
      for (let x = -b.w / 2 - 26 + off; x < b.w / 2 + 26; x += 26) {
        ctx.beginPath();
        ctx.moveTo(x - 7, -11);
        ctx.lineTo(x + 5, 0);
        ctx.lineTo(x - 7, 11);
        ctx.stroke();
      }
      ctx.restore();
    }

    // portaalit
    for (const p of world.portals) {
      for (const [q, hue] of [[p.a, "#b06cff"], [p.b, "#ff7ad9"]]) {
        const pulse = 1 + Math.sin(anim * 4) * 0.08;
        const g = ctx.createRadialGradient(q.x, q.y, 2, q.x, q.y, PORTAL_R * 1.6);
        g.addColorStop(0, "rgba(20,10,40,0.95)");
        g.addColorStop(0.6, "rgba(40,20,80,0.7)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(q.x, q.y, PORTAL_R * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hue;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(q.x, q.y, PORTAL_R * pulse, anim * 3, anim * 3 + Math.PI * 1.5);
        ctx.stroke();
      }
    }

    // pomppupallot
    for (const c of world.bumpers) {
      const hit = effects.some((e) => e.type === "bump" && anim - e.t < 0.15 && Math.hypot(e.x - c.x, e.y - c.y) < c.r + 14);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.arc(c.x + 3, c.y + 5, c.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hit ? "#fecaca" : "#ef4444";
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r * (hit ? 1.12 : 1), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 0.55, 0, Math.PI * 2); ctx.stroke();
    }

    // liikkuvat seinät
    ctx.lineCap = "round";
    for (const m of world.movers) {
      const s = G.moverAt(m, simT);
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(s.x1 + 3, s.y1 + 5); ctx.lineTo(s.x2 + 3, s.y2 + 5); ctx.stroke();
      ctx.strokeStyle = "#efe6d2"; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    }

    // lippu
    const hx = world.hole.x, hy = world.hole.y;
    ctx.strokeStyle = "#f1f3fb"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, hy - 48); ctx.stroke();
    const wave = Math.sin(anim * 5) * 3;
    ctx.fillStyle = "#ffd34d";
    ctx.beginPath(); ctx.moveTo(hx, hy - 48); ctx.lineTo(hx + 24, hy - 41 + wave); ctx.lineTo(hx, hy - 34); ctx.closePath(); ctx.fill();

    // roiskeet
    effects = effects.filter((e) => anim - e.t < 0.8);
    for (const e of effects) {
      if (e.type !== "splash") continue;
      const k = (anim - e.t) / 0.8;
      ctx.strokeStyle = `rgba(255,255,255,${1 - k})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(e.x, e.y, 8 + k * 40, 0, Math.PI * 2); ctx.stroke();
    }

    // pallo
    if (phase !== "water") {
      let scale = 1, bx = ball.x, by = ball.y;
      if (phase === "sinking" || phase === "between" || phase === "done") {
        const k = phase === "sinking" ? Math.min(1, (anim - sinkStart) / 0.4) : 1;
        bx += (hx - bx) * k; by += (hy - by) * k;
        scale = 1 - k;
      }
      if (scale > 0.02) {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath(); ctx.ellipse(bx + 3, by + 4, BALL_R * scale, BALL_R * 0.8 * scale, 0, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(bx - 3, by - 3, 1, bx, by, BALL_R * scale);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(1, "#d9dde8");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(bx, by, BALL_R * scale, 0, Math.PI * 2); ctx.fill();
      }
    }

    // tähtäys
    if (aim && phase === "aim") {
      const { angle, power } = aimShot();
      const len = 30 + power * 190;
      const col = power < 0.5 ? `hsl(${130 - power * 80}, 80%, 60%)` : `hsl(${90 - (power - 0.5) * 180}, 90%, 58%)`;
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(ball.x, ball.y); ctx.lineTo(aim.x, aim.y); ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -anim * 40;
      ctx.beginPath();
      ctx.moveTo(ball.x + Math.cos(angle) * 14, ball.y + Math.sin(angle) * 14);
      ctx.lineTo(ball.x + Math.cos(angle) * len, ball.y + Math.sin(angle) * len);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 18, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
      ctx.stroke();
    }

    // tuulen suunta
    if (world.mod.wind) {
      const a = world.mod.wind.angle, cx = W - 60, cy = 50;
      ctx.fillStyle = "rgba(11,13,23,0.55)";
      ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.strokeStyle = "#fff"; ctx.fillStyle = "#fff"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(12, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(8, -7); ctx.lineTo(8, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ---------- Ohjaus ----------

  function toCourse(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  }
  function aimShot() {
    const dx = ball.x - aim.x, dy = ball.y - aim.y;
    return { angle: Math.atan2(dy, dx), power: Math.min(1, Math.hypot(dx, dy) / DRAG_MAX) };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || phase !== "aim") return;
    aim = toCourse(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => { if (aim) aim = toCourse(e); });
  canvas.addEventListener("pointerup", () => {
    if (!aim || phase !== "aim") { aim = null; return; }
    const { angle, power } = aimShot();
    aim = null;
    if (power > 0.03) onShoot(angle, power);
  });
  canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); aim = null; });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") aim = null; });

  // ---------- Käyttöliittymä ----------

  let toastTimer = null;
  function toast(title, sub, ms) {
    const t = $("toast");
    t.innerHTML = "";
    t.append(title);
    if (sub) { const s = document.createElement("small"); s.textContent = sub; t.append(s); }
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  function renderInfo() {
    if (!course) return;
    const m = MODS[course.modifier];
    $("modifier").innerHTML = `${m.icon} ${m.name} <small>${m.desc}</small>`;
    $("modifier").title = m.desc;
    $("par").textContent = par();
    $("strokes").textContent = strokes;
    $("new-hole").hidden = mode !== "practice";

    if (mode === "practice") {
      $("hole-no").textContent = `#${practiceCount}`;
      $("total").textContent = fmtDiff(practiceDiff);
    } else {
      $("hole-no").textContent = `${Math.min(holeIdx + 1, course.holes.length)} / ${course.holes.length}`;
      const done = scores.filter((s) => s != null);
      $("total").textContent = fmtDiff(done.reduce((a, s, i) => a + s - course.holes[i].par, 0));
    }
    renderScorecard();
  }

  function renderScorecard() {
    const holes = course.holes;
    const cell = (tag, text, cls = "") => `<${tag}${cls ? ` class="${cls}"` : ""}>${text}</${tag}>`;
    $("sc-head").innerHTML = cell("th", mode === "practice" ? "Harjoitus" : "Reikä") + holes.map((_, i) => cell("th", i + 1)).join("") + cell("th", "Yht.");
    $("sc-par").innerHTML = cell("td", "Par") + holes.map((h) => cell("td", h.par)).join("") + cell("td", coursePar());
    const you = holes.map((h, i) => {
      const s = scores[i];
      if (s == null) return cell("td", i === holeIdx && phase !== "done" ? strokes || "–" : "–", i === holeIdx ? "current" : "");
      const d = s - h.par;
      return cell("td", s, d < 0 ? "under" : d === 0 ? "even" : d === 1 ? "over" : "way-over");
    });
    const total = scores.reduce((a, s) => a + (s || 0), 0);
    $("sc-you").innerHTML = cell("td", "Sinä") + you.join("") + cell("td", total || "–");

    const st = store.get("golf-stats", null);
    $("stats").hidden = mode !== "daily" || !st;
    if (st) {
      $("stats").innerHTML = [
        [st.played, "Pelattu"],
        [st.streak, "Putki"],
        [st.bestStreak, "Paras putki"],
        [st.bestDiff === null ? "–" : fmtDiff(st.bestDiff), "Paras tulos"],
      ].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("");
    }
  }

  function renderResult() {
    if (mode !== "daily") { $("result").hidden = true; return; }
    const saved = store.get("golf-daily", {});
    const best = saved.best;
    if (!best) return;
    const diff = best.total - coursePar();
    $("result").hidden = false;
    $("result-emoji").textContent = diff < 0 ? "🏆" : diff === 0 ? "⛳" : diff <= 2 ? "🙂" : "😅";
    $("result-title").textContent = `${best.total} lyöntiä (${fmtDiff(diff)})`;
    $("result-sub").textContent = `Päivän paras tuloksesi · par ${coursePar()}`;
    $("result-squares").textContent = best.scores.map((s, i) => square(s, course.holes[i].par)).join("");
    updateCountdown();
  }

  function updateCountdown() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const left = Math.floor((midnight - now) / 1000);
    const pad = (n) => String(n).padStart(2, "0");
    $("countdown").textContent = `Uusi rata ${Math.floor(left / 3600)}:${pad(Math.floor(left / 60) % 60)}:${pad(left % 60)} kuluttua`;
  }
  setInterval(() => {
    if (mode !== "daily" || !course) return;
    if (L.todayNumber() !== course.day) startDaily();
    else if (phase === "done") updateCountdown();
  }, 1000);

  async function share() {
    const best = store.get("golf-daily", {}).best;
    if (!best) return;
    const m = MODS[course.modifier];
    const diff = best.total - coursePar();
    const url = location.protocol.startsWith("http") ? "\n" + location.href.split("#")[0] : "";
    const text = `Päivän rata #${course.day + 1} ${m.icon} ${m.name}\n${best.scores.map((s, i) => square(s, course.holes[i].par)).join("")}  ${best.total} lyöntiä (${fmtDiff(diff)})${url}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); $("countdown").textContent = "Tulos kopioitu leikepöydälle!"; }
    } catch {}
  }

  $("share").addEventListener("click", share);
  $("replay").addEventListener("click", () => {
    scores = [];
    $("result").hidden = true;
    loadHole(0);
    saveDaily();
  });
  $("new-hole").addEventListener("click", startPractice);
  $("help-btn").addEventListener("click", () => $("help").showModal());
  document.querySelectorAll(".modes button").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === mode) return;
      document.querySelectorAll(".modes button").forEach((b) => b.classList.toggle("active", b === btn));
      if (btn.dataset.mode === "daily") startDaily();
      else { practiceCount = 0; practiceDiff = 0; startPractice(); }
    }));

  // Vain luku: testit ja kehitys näkevät pelin tilan
  window.GolfDebug = () => ({ mode, phase, holeIdx, strokes, scores: [...scores], ball: ball && { x: ball.x, y: ball.y }, modifier: course?.modifier });

  // ---------- Käynnistys ----------
  window.addEventListener("resize", resize);
  resize();
  // annetaan "Rakennetaan rataa" -tekstin piirtyä ennen generointia
  requestAnimationFrame(() => setTimeout(() => {
    startDaily();
    $("loading").hidden = true;
    if (!store.get("golf-seen-help", false)) { $("help").showModal(); store.set("golf-seen-help", true); }
    requestAnimationFrame(frame);
  }, 30));
})();
