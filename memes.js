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
  { title: "Kaminaa lämpöö", aliases: ["Kamiinaa lämpöö", "Kamiina", "Kamina"], youtube: "https://www.youtube.com/watch?v=M90uV16YgpE" },
  { title: "Älä tuu kurkistelee", aliases: ["Kurkistelee", "Älä tule kurkistelemaan"], youtube: "https://www.youtube.com/watch?v=bV8Hgn2-5tw" },
  { title: "Tuli iso jytky", aliases: ["Iso jytky", "Jytky", "Soini"], youtube: "https://www.youtube.com/watch?v=HLJAuYhJtJ4" },
  { title: "The Wall Suomi – Mitä vittua", aliases: ["The Wall", "Mitä vittua"], youtube: "https://youtu.be/uzHaV0tq3Sg?t=29" },
  { title: "Mitä saisi olla saatana", aliases: ["Mitä saisi olla", "Mitä saisi olla, saatana"], youtube: "https://www.youtube.com/watch?v=eAk1wBPanVc" },
  { title: "Markku se sinua kuristi", aliases: ["Markku", "Kuristi"], youtube: "https://www.youtube.com/watch?v=aothrVvyCk0" },
  { title: "Mikä on Suomen kansalliskala? – Joutsen", aliases: ["Suomen kansalliskala", "Kansalliskala", "Joutsen", "Seksikäs-Suklaa", "Seksikäs Suklaa"], youtube: "https://www.youtube.com/watch?v=Ij2PRA8iGZ4" },

  // ---------- Tubettajat ----------
  { title: "Topi", aliases: ["Topi karkaa", "Kissa karkaa", "Markoboy kissa"], youtube: "https://youtu.be/ql7k3aq3lo0?t=4" },
  { title: "Arkkivihollinen on palannut", aliases: ["Arkkivihollinen", "Vitun grilli", "Grilli", "Markoboy grilli"], youtube: "https://youtu.be/tCrn38XM-vE?t=89" },
  { title: "Niilo22 – Vituttaa", aliases: ["Niilo22", "Niilo", "Vituttaa"], youtube: "https://www.youtube.com/watch?v=mKLlYlyZvlA" },

  // ---------- TV ja elokuvat ----------
  // ---------- Kummeli ----------
  // Jokaisella on "Kummeli …"-alias, jotta "kummeli" kirjoittamalla löytyvät kaikki
  { title: "Tonnin seteli", aliases: ["Kummeli – Tonnin seteli", "Se oli tonnin seteli", "Tonni"], youtube: "https://youtu.be/mHvBvkSCx2w?t=24" },
  { title: "Jankon Betoni", aliases: ["Kummeli – Jankon Betoni", "Jankko", "Kalervo Jankko", "Betoni"], youtube: "https://youtu.be/A7_Qko2xrjA?t=37" },
  { title: "Kummeli – Biologian tunti", aliases: ["Biologian tunti", "Speedy ja Saku: Biologian tunti"], youtube: "https://www.youtube.com/watch?v=fuYyPqtSVUw" },
  { title: "Hei mulla on reikiä päässä", aliases: ["Kummeli – Reikiä päässä", "Reikiä päässä", "Mulla on reikiä päässä"], youtube: "https://youtu.be/BSOPmUo-BNo?t=7" },
  { title: "Kummeli – Panomies", aliases: ["Panomies"], youtube: "https://youtu.be/jrqEe6XK3VI?t=60" },
  { title: "Kummeli – Älykääpiöt", aliases: ["Älykääpiö", "esa nahka" ,"tero nuppi"], youtube: "https://youtu.be/mQ1jjbdGwhk" },

  // ---------- Muu TV ja elokuvat ----------
  { title: "Olitkos vielä nukkumassa?", aliases: ["Uuno nukkumassa", "Olitko vielä nukkumassa"], youtube: "https://www.youtube.com/watch?v=L5illCCR70U" },
  { title: "Tupakan mittane tauko", aliases: ["Uuno tupakka", "Tupakka", "Tupakkatauko"], youtube: "https://youtu.be/kb6cpwAnShk?t=46" },
  { title: "Tsajajajaja", aliases: ["Ismo", "Ismo Laitela", "Salkkarit", "Tsajajaja"], youtube: "https://youtu.be/UZMcLnccE-I?t=15" },
  { title: "Ämmä alkaa disrispektaa", aliases: ["Disrispektaa", "Au pairit", "Au pairit Panamassa", "Tiia"], youtube: "https://youtu.be/p83lSCGY3Q8?t=3" },

  // ---------- Justimusfilms ----------
  { title: "Justimusfilms – Kevätjuhla", aliases: ["Kevätjuhla", "Justimus kevätjuhla"], youtube: "https://youtu.be/HPMTDaxGQl8?t=47" },
  { title: "Justimusfilms – Aamunavaus", aliases: ["Aamunavaus", "Justimus aamunavaus"], youtube: "https://youtu.be/IAGuoo_uhUM?t=103" },
  { title: "Justimusfilms – Et uskalla", aliases: ["Et uskalla", "Justimus et uskalla"], youtube: "https://youtu.be/KnYPVO3bFFc?t=10" },
  { title: "Justimusfilms – Keltainen auto", aliases: ["Keltainen auto", "Justimus keltainen auto"], youtube: "https://youtu.be/k9FPgPuhU-w?t=13" },
  { title: "Justimusfilms – Santeri", aliases: ["Santeri", "Justimus santeri"], youtube: "https://youtu.be/_BLOcUv-UY4" },
  { title: "Justimusfilms – Autokoulu: Masa", aliases: ["Autokoulu", "Masa", "Justimus autokoulu"], youtube: "https://youtu.be/M4jvynnzMgk?t=180" },
  { title: "Justimusfilms – Suomalainen mies lääkärissä", aliases: ["Suomalainen mies lääkärissä", "Lääkärissä", "Justimus lääkäri"], youtube: "https://www.youtube.com/watch?v=CmQeCSQal6U" },
  { title: "Justimusfilms – Päiväni kalareissulla", aliases: ["Päiväni kalareissulla", "Kalareissu", "Justimus kalareissu"], youtube: "https://www.youtube.com/watch?v=PlHYu33tkBM" },
  { title: "Justimusfilms – Lanit", aliases: ["Masa Teurastaja", "Justimus Lanit"], youtube: "https://youtu.be/lcb8uafr0cw?t=35" },

  
  // ---------- Urheilu ----------
  { title: "Mertaranta – Granlundin ilmaveivi", aliases: ["Mertaranta", "Granlund", "Ilmaveivi", "MM 2011"], youtube: "https://www.youtube.com/watch?v=kqRyUSw6WjY" },
  { title: "Matti Nykänen – Ehkä on, ehkä ei", aliases: ["Matti Nykänen", "Nykänen", "Ehkä on ehkä ei", "Normien mukaan"], youtube: "https://youtu.be/GZ_s5yYfSpA?t=22" },

  // ---------- Muut ----------
  { title: "Do you know da wae", aliases: ["Ugandan Knuckles", "Do you know the way", "Da wae"], youtube: "https://youtu.be/P31z2qbErpc" },
  { title: "Jari sinut pittää nyt tappaa", aliases: ["Jari", "Jari sinut pitää nyt tappaa"], youtube: "https://www.youtube.com/watch?v=32_wX1eDe_M" },
];
