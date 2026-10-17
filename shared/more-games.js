// "Kokeile myös": mainostaa sivuston muita pelejä, ei koskaan nykyistä
// (<body data-game="…">). Kortit ovat pelin ulkopuolella:
//   - leveällä näytöllä sivun tyhjissä reunoissa, yksi kortti per reuna
//   - kapeammalla yksi rivi sivun alalaidassa
(() => {
  const here = document.body.dataset.game;
  const main = document.querySelector("main");
  const others = (window.GAMES || []).filter((g) => g.id !== here);
  if (!others.length || !main) return;

  // satunnainen järjestys, jotta pelit vuorottelevat
  const picks = others
    .map((g) => [Math.random(), g])
    .sort((a, b) => a[0] - b[0])
    .map(([, g]) => g);

  const card = (g, cls, eyebrow) => `
    <a class="mg-card ${cls}" href="${g.url}">
      ${eyebrow ? '<span class="mg-eyebrow">Kokeile myös</span>' : ""}
      <img src="${g.image}" alt="">
      <span class="mg-body">
        <strong>${g.title}</strong>
        <span class="mg-tag">${g.tagline}</span>
      </span>
      <span class="mg-play">Pelaa →</span>
    </a>`;

  // Reunat: oikealle ensimmäinen, vasemmalle toinen (jos muita pelejä on vähintään kaksi)
  const sides = [];
  for (const [side, g] of [["mg-right", picks[0]], ["mg-left", picks[1]]]) {
    if (!g) continue;
    const el = document.createElement("aside");
    el.className = `mg-side ${side}`;
    el.hidden = true;
    el.innerHTML = card(g, "mg-tall", true);
    document.body.append(el);
    sides.push(el);
  }

  const bottom = document.createElement("aside");
  bottom.className = "mg-bottom";
  bottom.hidden = true;
  bottom.innerHTML = `<span class="mg-eyebrow">Kokeile myös</span>
    <div class="mg-row">${picks.slice(0, 2).map((g) => card(g, "mg-wide", false)).join("")}</div>`;
  main.after(bottom);

  const MIN_CARD = 220, MAX_CARD = 400, MARGIN = 80;

  function layout() {
    const vw = document.documentElement.clientWidth;
    const r = main.getBoundingClientRect();
    const gutter = Math.min(r.left, vw - r.right);
    const width = Math.min(MAX_CARD, gutter - MARGIN);
    const useSides = width >= MIN_CARD;
    for (const el of sides) {
      el.hidden = !useSides;
      el.style.width = gutter + "px";
      el.firstElementChild.style.width = width + "px";
    }
    bottom.hidden = useSides;
    bottom.style.maxWidth = getComputedStyle(main).maxWidth;
  }
  addEventListener("resize", layout);
  layout();
})();
