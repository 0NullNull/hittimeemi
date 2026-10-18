// "Kokeile myös": mainostaa sivuston muita pelejä, ei koskaan nykyistä
// (<body data-game="…">). Kirjautumaton kävijä näkee lisäksi "Luo oma tili" -kortin,
// joka avaa tilin luonnin (shared/account.js). Kortit ovat pelin ulkopuolella:
//   - leveällä näytöllä sivun tyhjissä reunoissa, yksi kortti per reuna
//   - kapeammalla yksi rivi sivun alalaidassa
(() => {
  const here = document.body.dataset.game;
  const main = document.querySelector("main");
  if (!main) return;

  // satunnainen järjestys, jotta pelit vuorottelevat
  const picks = (window.GAMES || [])
    .filter((g) => g.id !== here)
    .map((g) => [Math.random(), g])
    .sort((a, b) => a[0] - b[0])
    .map(([, g]) => g);

  const ACCOUNT = {
    account: true,
    title: "Luo oma tili",
    tagline: "Tallenna tuloksesi ja kisaa kavereita vastaan tulostauluilla.",
    url: "#luo-tili",
    image: "/shared/thumbs/account.png",
    eyebrow: "Oma tili",
    cta: "Luo tili →",
  };
  const signedIn = () => {
    try { return !!localStorage.getItem("fun-session"); } catch { return false; }
  };
  // Oikealle peli, vasemmalle tilikortti (kirjautuneelle toinen peli)
  const cards = () => (signedIn() ? picks : [picks[0], ACCOUNT, ...picks.slice(1)].filter(Boolean));

  const card = (g, cls, eyebrow) => `
    <a class="mg-card ${cls}" href="${g.url}"${g.account ? " data-account" : ""}>
      ${eyebrow ? `<span class="mg-eyebrow">${g.eyebrow || "Kokeile myös"}</span>` : ""}
      <img src="${g.image}" alt="">
      <span class="mg-body">
        <strong>${g.title}</strong>
        <span class="mg-tag">${g.tagline}</span>
      </span>
      <span class="mg-play">${g.cta || "Pelaa →"}</span>
    </a>`;

  const sides = ["mg-right", "mg-left"].map((side) => {
    const el = document.createElement("aside");
    el.className = `mg-side ${side}`;
    el.hidden = true;
    document.body.append(el);
    return el;
  });
  const bottom = document.createElement("aside");
  bottom.className = "mg-bottom";
  bottom.hidden = true;
  main.after(bottom);

  const MIN_CARD = 220, MAX_CARD = 400, MARGIN = 80;

  function layout() {
    const vw = document.documentElement.clientWidth;
    const r = main.getBoundingClientRect();
    const gutter = Math.min(r.left, vw - r.right);
    const width = Math.min(MAX_CARD, gutter - MARGIN);
    const useSides = width >= MIN_CARD;
    for (const el of sides) {
      el.hidden = !useSides || !el.firstElementChild;
      el.style.width = gutter + "px";
      if (el.firstElementChild) el.firstElementChild.style.width = width + "px";
    }
    bottom.hidden = useSides || !bottom.querySelector(".mg-card");
    bottom.style.maxWidth = getComputedStyle(main).maxWidth;
  }

  function build() {
    const list = cards();
    sides.forEach((el, i) => (el.innerHTML = list[i] ? card(list[i], "mg-tall", true) : ""));
    bottom.innerHTML = list.length
      ? `<span class="mg-eyebrow">Kokeile myös</span>
         <div class="mg-row">${list.slice(0, 2).map((g) => card(g, "mg-wide", false)).join("")}</div>`
      : "";
    layout();
  }

  // Tilikortti avaa kirjautumisikkunan suoraan tilin luontiin
  document.addEventListener("click", (e) => {
    const link = e.target.closest?.("[data-account]");
    if (link && window.Account) {
      e.preventDefault();
      Account.open("signup");
    }
  });
  addEventListener("resize", layout);
  addEventListener("fun-account", build); // kirjautuminen piilottaa tilikortin, uloskirjautuminen tuo takaisin
  build();
})();
