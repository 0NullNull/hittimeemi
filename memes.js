// Meemilista. Lisää uusi meemi kopioimalla rivi ja vaihtamalla tiedot.
//   title   = oikea vastaus (näkyy ehdotuslistassa)
//   aliases = muut kirjoitusasut, jotka hyväksytään oikeaksi (ei pakollinen)
//   youtube = YouTube-linkki (youtube.com/watch?v=..., youtu.be/..., shorts/...)
//   file    = TAI oma äänitiedosto audio-kansiossa (mp3, ogg, m4a, wav...)
//   start   = mistä kohtaa pätkä alkaa: 12, 12.5, "1:05" tai "1:05.3" (ei pakollinen)
//             Jos startia ei ole, käytetään linkin ?t=-aikaleimaa, muuten 0.
window.MEMES = [
  // GlobalConnectin "Suomen ikimuistoisin viraalivideo" -äänestyksen top 10 (2024)
  { title: "Ui juma", aliases: ["Voi juma", "Avantouinti"], youtube: "https://youtu.be/nWm6apd6mp8?t=17" },
  { title: "Kahen kilon siika", aliases: ["Kahden kilon siika", "Siika", "Tuoppi"], youtube: "https://youtu.be/SlIw7GiHUkc?t=26" },
  { title: "Puuhöylä", aliases: ["Voittopotti", "Hasita vittu", "Tony Hällfors"], youtube: "https://youtu.be/rJrEe8_gi64?t=145" },
  { title: "Perkele, siihen et koske (Karhumies)", aliases: ["Siihen et koske", "Karhumies", "Karhu"], youtube: "https://youtu.be/6x9hNk1dk_o?t=2" },
  { title: "Tonnin seteli", aliases: ["Se oli tonnin seteli", "Kummeli"], youtube: "https://youtu.be/mHvBvkSCx2w?t=24" },
  { title: "Olitkos vielä nukkumassa?", aliases: ["Uuno Turhapuro", "Uuno", "Olitko vielä nukkumassa"], youtube: "https://www.youtube.com/watch?v=L5illCCR70U" },
  { title: "Tsajajajaja", aliases: ["Ismo", "Ismo Laitela", "Salkkarit", "Tsajajaja"], youtube: "https://youtu.be/UZMcLnccE-I?t=15" },

  // TV-kohtauksia, joista tuli meemejä
  { title: "Jankon Betoni", aliases: ["Kummeli", "Jankko", "Kalervo Jankko"], youtube: "https://youtu.be/A7_Qko2xrjA?t=37" },
  { title: "Ämmä alkaa disrispektaa", aliases: ["Disrispektaa", "Au pairit", "Au pairit Panamassa", "Tiia"], youtube: "https://youtu.be/p83lSCGY3Q8?t=3" },
  { title: "Tämä on vettä", aliases: ["Muumit", "Muumilaakso", "Vettä"], youtube: "https://www.youtube.com/shorts/jNcg6IOiLhg" },

  // Muut
];
