// Ristiinmainonta: täyttää jokaisen <div class="cross-ad" data-game="…"> -paikan
// satunnaisen *toisen* pelin mainoksella. Jos muita pelejä ei ole, paikka poistetaan.
(() => {
  const games = window.GAMES || [];
  document.querySelectorAll(".cross-ad").forEach((slot) => {
    const others = games.filter((g) => g.id !== slot.dataset.game);
    if (!others.length) {
      slot.remove();
      return;
    }
    const g = others[Math.floor(Math.random() * others.length)];
    slot.innerHTML = `
      <span class="ad-label">Kokeile myös</span>
      <a class="ad" href="${g.url}">
        <img src="${g.ad}" alt="">
        <div class="ad-text">
          <strong>${g.title}</strong>
          <span>${g.tagline}</span>
        </div>
        <span class="ad-cta">Pelaa →</span>
      </a>`;
    slot.hidden = false;
  });
})();
