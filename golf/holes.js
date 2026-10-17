// Käsin tehdyt radat. Jos päivälle on rata tässä, sitä käytetään generoidun sijaan.
// Avain on päivämäärä (VVVV-KK-PP). Rata on 1000 × 600 yksikköä, (0,0) vasen yläkulma.
//
//   modifier: "normal" | "ice" | "wind" | "bouncy" | "magnet" | "heavy" | "tiny"
//   holes: lista reikiä, jokaisessa:
//     par:     reiän par
//     start:   [x, y]          pallon aloituspaikka
//     hole:    [x, y]          reikä
//     blocks:  [[x, y, w, h]]  seinälaatikot
//     walls:   [[x1, y1, x2, y2]]  ohuet seinät (myös vinot)
//     sand:    [[x, y, w, h]]  hiekka hidastaa
//     water:   [[x, y, w, h]]  vesi: lyönti alusta, +1 lyönti
//     boosts:  [[x, y, w, h, suunta°]]  kiihdytin (0° = oikealle, 90° = alas)
//     portals: [[ax, ay, bx, by]]  portaalipari
//     bumpers: [[x, y, säde]]  pomppupallot
//     movers:  [[x1, y1, x2, y2, siirtymäX, siirtymäY, jakso s]]  liikkuva seinä
window.HANDMADE_COURSES = {
  // Esimerkki (mennyt päivä, ei vaikuta mihinkään). Kopioi ja vaihda päivämäärä.
  "2026-01-01": {
    modifier: "normal",
    holes: [
      {
        par: 2,
        start: [120, 300],
        hole: [880, 300],
        blocks: [[470, 0, 60, 230], [470, 370, 60, 230]],
        sand: [[760, 220, 90, 160]],
      },
      {
        par: 3,
        start: [100, 500],
        hole: [900, 100],
        blocks: [[300, 200, 400, 60]],
        water: [[330, 360, 300, 140]],
        boosts: [[150, 120, 90, 44, 0]],
        bumpers: [[780, 330, 20]],
      },
      {
        par: 3,
        start: [100, 100],
        hole: [900, 500],
        blocks: [[0, 260, 640, 60]],
        portals: [[560, 140, 160, 480]],
        movers: [[750, 330, 750, 470, 90, 0, 3]],
      },
    ],
  },
};
