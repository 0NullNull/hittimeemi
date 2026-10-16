// Meemilista. Lisää uusi meemi kopioimalla rivi ja vaihtamalla tiedot.
//   title   = oikea vastaus (näkyy ehdotuslistassa)
//   aliases = muut kirjoitusasut, jotka hyväksytään oikeaksi (ei pakollinen)
//             Älä käytä samaa aliasta kahdella meemillä (esim. "Kummeli"),
//             muuten arvaus voi osua väärään meemiin.
//   youtube = YouTube-linkki (youtube.com/watch?v=..., youtu.be/..., shorts/...)
//   file    = TAI oma äänitiedosto audio-kansiossa (mp3, ogg, m4a, wav...)
//   start   = mistä kohtaa pätkä alkaa: 12, 12.5, "1:05" tai "1:05.3" (ei pakollinen)
//             Jos startia ei ole, käytetään linkin ?t=-aikaleimaa, muuten 0.
window.MEMES = [
  // ---------- Viraalivideot ----------
  { title: "Ui juma", aliases: ["Voi juma", "Avantouinti"], youtube: "https://youtu.be/nWm6apd6mp8?t=17" },
  { title: "Kahen kilon siika", aliases: ["Kahden kilon siika", "Siika", "Tuoppi"], youtube: "https://youtu.be/SlIw7GiHUkc?t=26" },
  { title: "Puuhöylä", aliases: ["Voittopotti", "Hasita vittu", "Tony Hällfors"], youtube: "https://youtu.be/rJrEe8_gi64?t=145" },
  { title: "Karhu vie roskat", aliases: ["Perkele, siihen et koske", "Siihen et koske", "Karhumies", "Karhu"], youtube: "https://youtu.be/6x9hNk1dk_o?t=2" },
  { title: "Kylläpä kiehahti", aliases: ["Kylläpäs kiehahti", "Kiehahti", "Coca-Cola"], youtube: "https://youtu.be/KXkFLqJWT1A" },
  { title: "Laihian Alko", aliases: ["Laihia", "Alko", "Loppukevennys"], youtube: "https://www.youtube.com/watch?v=A-oIZNc2e1k" },

  // ---------- Tubettajat ----------
  { title: "Risumies", youtube: "https://youtu.be/2PT4aRyqeoI?t=30" },
  { title: "Topi", aliases: ["Topi karkaa", "Kissa karkaa", "Markoboy kissa"], youtube: "https://youtu.be/ql7k3aq3lo0?t=4" },
  { title: "Arkkivihollinen on palannut", aliases: ["Arkkivihollinen", "Vitun grilli", "Grilli", "Markoboy grilli"], youtube: "https://youtu.be/tCrn38XM-vE?t=89" },
  { title: "Niilo22 – Vituttaa", aliases: ["Niilo22", "Niilo", "Vituttaa"], youtube: "https://www.youtube.com/watch?v=mKLlYlyZvlA" },

  // ---------- TV ja elokuvat ----------
  { title: "Tonnin seteli", aliases: ["Se oli tonnin seteli", "Tonni"], youtube: "https://youtu.be/mHvBvkSCx2w?t=24" },
  { title: "Jankon Betoni", aliases: ["Jankko", "Kalervo Jankko", "Betoni"], youtube: "https://youtu.be/A7_Qko2xrjA?t=37" },
  { title: "Pihamökin vuokraus", aliases: ["Ei se oo kun parin kuun vuokra", "Parin kuun vuokra", "Pihamökki"], youtube: "https://www.youtube.com/watch?v=tRkWpO053AQ" },
  { title: "Jakke ja Sepi – Johdot", aliases: ["Jakke ja Sepi", "Jakke", "Sepi", "Johdot"], youtube: "https://www.youtube.com/watch?v=OmtFiz7XCeU" },
  { title: "Olitkos vielä nukkumassa?", aliases: ["Uuno Turhapuro", "Uuno", "Olitko vielä nukkumassa"], youtube: "https://www.youtube.com/watch?v=L5illCCR70U" },
  { title: "Spede Show – Viimeinen tupakka", aliases: ["Spede", "Spede Show", "Viimeinen tupakka", "Kuolemaantuomittu"], youtube: "https://www.youtube.com/watch?v=lo74-Dmx8wA" },
  { title: "Tsajajajaja", aliases: ["Ismo", "Ismo Laitela", "Salkkarit", "Tsajajaja"], youtube: "https://youtu.be/UZMcLnccE-I?t=15" },
  { title: "Ämmä alkaa disrispektaa", aliases: ["Disrispektaa", "Au pairit", "Au pairit Panamassa", "Tiia"], youtube: "https://youtu.be/p83lSCGY3Q8?t=3" },
  { title: "Tämä on vettä", aliases: ["Muumit", "Muumilaakso", "Vettä"], youtube: "https://www.youtube.com/shorts/jNcg6IOiLhg" },

  // ---------- Urheilu ----------
  { title: "Seppo Räty – Hall of Fame -haastattelu", aliases: ["Seppo Räty", "Räty", "Urheilugaala"], youtube: "https://www.youtube.com/watch?v=QfXbFMZ3zKE" },
  { title: "Mertaranta – Granlundin ilmaveivi", aliases: ["Mertaranta", "Granlund", "Ilmaveivi", "MM 2011"], youtube: "https://www.youtube.com/watch?v=kqRyUSw6WjY" },
  { title: "Matti Nykänen – Ehkä on, ehkä ei", aliases: ["Matti Nykänen", "Nykänen", "Ehkä on ehkä ei", "Normien mukaan"], youtube: "https://www.youtube.com/watch?v=GZ_s5yYfSpA" },

  // ---------- Muut ----------
  { title: "Do you know da wae", aliases: ["Ugandan Knuckles", "Do you know the way", "Da wae"], youtube: "https://youtu.be/P31z2qbErpc" },
];
