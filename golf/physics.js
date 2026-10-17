// Minigolfin fysiikka. Sama koodi pyörittää peliä ja ratkaisijaa (levels.js),
// joka tarkistaa, että generoitu reikä on oikeasti läpäistävissä.
(() => {
  const W = 1000, H = 600;   // radan koordinaatisto
  const BALL_R = 8;
  const MAX_SPEED = 1300;    // täysi lyönti, px/s
  const STOP_SPEED = 6;
  const GRASS = { lin: 70, k: 0.85 };   // jarrutus: vakio + nopeuteen verrannollinen
  const SAND = { lin: 520, k: 3.2 };
  const BOOST = 1700;        // kiihtyvyys boostilla
  const PORTAL_R = 17;

  // Päivän muuttujat. friction/restitution/power ovat kertoimia.
  const MODS = {
    normal:  { name: "Tavallinen päivä", icon: "⛳", desc: "Ei erikoissääntöjä." },
    ice:     { name: "Jää", icon: "❄️", desc: "Pallo liukuu ja hidastuu tuskin lainkaan.", friction: 0.28 },
    wind:    { name: "Tuuli", icon: "💨", desc: "Tuuli puskee palloa koko ajan samaan suuntaan." },
    bouncy:  { name: "Kumiseinät", icon: "🏀", desc: "Seinät pomppauttavat pallon lähes täydellä vauhdilla.", restitution: 0.97 },
    magnet:  { name: "Magneettireikä", icon: "🧲", desc: "Reikä vetää palloa puoleensa läheltä." },
    heavy:   { name: "Raskas pallo", icon: "🪨", desc: "Lyönnit ovat heikompia ja pallo pysähtyy nopeammin.", power: 0.72, friction: 1.3 },
    tiny:    { name: "Pieni reikä", icon: "🎯", desc: "Reikä on puolet pienempi, ja sinne pitää osua hiljaa." },
  };

  const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  function rectSegs(r) {
    const { x, y, w, h } = r;
    return [
      { x1: x, y1: y, x2: x + w, y2: y },
      { x1: x + w, y1: y, x2: x + w, y2: y + h },
      { x1: x + w, y1: y + h, x2: x, y2: y + h },
      { x1: x, y1: y + h, x2: x, y2: y },
    ];
  }

  // Muuntaa reiän kuvauksen (holes.js / generaattori) simuloitavaksi maailmaksi
  function buildWorld(hole, modId, windDir = 0) {
    const base = MODS[modId] || MODS.normal;
    const mod = {
      id: modId,
      friction: base.friction || 1,
      restitution: base.restitution || 0.72,
      power: base.power || 1,
      wind: modId === "wind" ? { x: Math.cos(windDir) * 42, y: Math.sin(windDir) * 42, angle: windDir } : null,
      magnet: modId === "magnet" ? { r: 150, f: 950 } : null,
    };
    const holeR = modId === "tiny" ? 9 : 15;
    const blocks = (hole.blocks || []).map(([x, y, w, h]) => ({ x, y, w, h }));
    const segs = [
      ...rectSegs({ x: 0, y: 0, w: W, h: H }),
      ...blocks.flatMap(rectSegs),
      ...(hole.walls || []).map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 })),
    ];
    return {
      mod,
      segs,
      blocks,
      start: { x: hole.start[0], y: hole.start[1] },
      hole: { x: hole.hole[0], y: hole.hole[1], r: holeR, maxSpeed: modId === "tiny" ? 360 : 540 },
      sand: (hole.sand || []).map(([x, y, w, h]) => ({ x, y, w, h })),
      water: (hole.water || []).map(([x, y, w, h]) => ({ x, y, w, h })),
      boosts: (hole.boosts || []).map(([x, y, w, h, deg]) => ({ x, y, w, h, dx: Math.cos(deg * Math.PI / 180), dy: Math.sin(deg * Math.PI / 180), deg })),
      portals: (hole.portals || []).map(([ax, ay, bx, by]) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } })),
      bumpers: (hole.bumpers || []).map(([x, y, r]) => ({ x, y, r })),
      // liikkuva seinä: [x1, y1, x2, y2, siirtymäX, siirtymäY, jakso s]
      movers: (hole.movers || []).map(([x1, y1, x2, y2, dx, dy, period]) => ({ x1, y1, x2, y2, dx, dy, period })),
    };
  }

  function moverAt(m, t) {
    const s = Math.sin((2 * Math.PI * t) / m.period);
    return { x1: m.x1 + m.dx * s, y1: m.y1 + m.dy * s, x2: m.x2 + m.dx * s, y2: m.y2 + m.dy * s };
  }

  function collideSeg(b, s, e) {
    const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
    const L2 = ex * ex + ey * ey || 1;
    let u = ((b.x - s.x1) * ex + (b.y - s.y1) * ey) / L2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const cx = s.x1 + u * ex, cy = s.y1 + u * ey;
    const dx = b.x - cx, dy = b.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= BALL_R * BALL_R) return false;
    const d = Math.sqrt(d2) || 1e-4;
    const nx = dx / d, ny = dy / d;
    b.x = cx + nx * BALL_R;
    b.y = cy + ny * BALL_R;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
      b.bounced = true;
    }
    return true;
  }

  function collideBumper(b, c) {
    const dx = b.x - c.x, dy = b.y - c.y;
    const min = c.r + BALL_R;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return false;
    const d = Math.sqrt(d2) || 1e-4;
    const nx = dx / d, ny = dy / d;
    b.x = c.x + nx * min;
    b.y = c.y + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      // bumpperi lisää vauhtia
      b.vx -= 2.25 * vn * nx;
      b.vy -= 2.25 * vn * ny;
      const s = Math.hypot(b.vx, b.vy);
      if (s > 1500) { b.vx *= 1500 / s; b.vy *= 1500 / s; }
      b.bumped = true;
    }
    return true;
  }

  // Yksi aika-askel. Palauttaa null | "stop" | "sunk" | "water".
  // Nopeat pallot jaetaan pienempiin askeliin, ettei pallo mene seinien läpi.
  function step(w, b, dt) {
    const speed0 = Math.hypot(b.vx, b.vy);
    const n = Math.max(1, Math.ceil((speed0 * dt) / (BALL_R * 0.6)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const ev = substep(w, b, h);
      if (ev) return ev;
    }
    return null;
  }

  function substep(w, b, dt) {
    const m = w.mod;
    let ax = 0, ay = 0, boosting = false;
    if (m.wind) { ax += m.wind.x; ay += m.wind.y; }
    for (const p of w.boosts) {
      if (inRect(b.x, b.y, p)) { ax += p.dx * BOOST; ay += p.dy * BOOST; boosting = true; }
    }
    if (m.magnet) {
      const dx = w.hole.x - b.x, dy = w.hole.y - b.y, d = Math.hypot(dx, dy);
      if (d < m.magnet.r && d > 1) {
        const f = m.magnet.f * (1 - d / m.magnet.r);
        ax += (dx / d) * f; ay += (dy / d) * f;
      }
    }
    b.vx += ax * dt;
    b.vy += ay * dt;

    const fr = w.sand.some((r) => inRect(b.x, b.y, r)) ? SAND : GRASS;
    const s = Math.hypot(b.vx, b.vy);
    const ns = Math.max(0, s - (fr.lin + fr.k * s) * m.friction * dt);
    const k = s > 0 ? ns / s : 0;
    b.vx *= k;
    b.vy *= k;

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.t += dt;

    for (const sg of w.segs) collideSeg(b, sg, m.restitution);
    for (const mv of w.movers) collideSeg(b, moverAt(mv, b.t), m.restitution);
    for (const c of w.bumpers) collideBumper(b, c);

    // Portaalit: sisään toisesta, ulos toisesta. Ei uudelleen ennen kuin pallo on poistunut.
    for (const p of w.portals) {
      const inA = Math.hypot(b.x - p.a.x, b.y - p.a.y) < PORTAL_R;
      const inB = Math.hypot(b.x - p.b.x, b.y - p.b.y) < PORTAL_R;
      if (b.portalLock === p) {
        if (!inA && !inB) b.portalLock = null;
      } else if (inA || inB) {
        const to = inA ? p.b : p.a;
        b.x = to.x; b.y = to.y;
        b.portalLock = p;
        b.teleported = true;
      }
    }

    if (w.water.some((r) => inRect(b.x, b.y, r))) return "water";

    const hs = Math.hypot(b.vx, b.vy);
    const hd = Math.hypot(b.x - w.hole.x, b.y - w.hole.y);
    if (hd < w.hole.r) {
      if (hs < w.hole.maxSpeed) return "sunk";
      // liian kova vauhti: pallo pomppii reiän reunan yli
      b.vx *= 0.9; b.vy *= 0.9;
    }

    if (hs < STOP_SPEED && !boosting) {
      b.vx = 0; b.vy = 0;
      return "stop";
    }
    return null;
  }

  function newBall(x, y, t = 0) {
    return { x, y, vx: 0, vy: 0, t, portalLock: null };
  }

  function shoot(w, b, angle, power) {
    const sp = MAX_SPEED * Math.max(0, Math.min(1, power)) * w.mod.power;
    b.vx = Math.cos(angle) * sp;
    b.vy = Math.sin(angle) * sp;
  }

  // Simuloi yhden lyönnin loppuun asti (ratkaisija käyttää tätä)
  function simulateShot(w, x, y, angle, power, t0 = 0) {
    const b = newBall(x, y, t0);
    shoot(w, b, angle, power);
    for (let i = 0; i < 60 * 14; i++) {
      const ev = step(w, b, 1 / 60);
      if (ev === "sunk") return { result: "sunk", x: b.x, y: b.y };
      if (ev === "water") return { result: "water", x, y };
      if (ev === "stop") return { result: "stop", x: b.x, y: b.y };
    }
    return { result: "timeout", x: b.x, y: b.y };
  }

  window.Golf = { W, H, BALL_R, PORTAL_R, MODS, inRect, buildWorld, moverAt, step, newBall, shoot, simulateShot };
})();
