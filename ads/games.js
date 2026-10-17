// Kaikki sivuston pelit. Uusi peli rekisteröidään lisäämällä rivi tähän:
// se näkyy silloin etusivulla ja mainoksena kaikissa muissa peleissä.
//   id      = pelin kansion nimi (sama kuin mainospaikan data-game)
//   title   = pelin nimi
//   tagline = lyhyt houkutteleva kuvaus
//   url     = pelin osoite sivuston juuresta
//   ad      = mainoskuva (1200×630), mieluiten ads-kansiossa
window.GAMES = [
  {
    id: "hittimeemi",
    title: "Hittimeemi",
    tagline: "Tunnistatko suomimeemin puolessa sekunnissa?",
    url: "/hittimeemi/",
    ad: "/ads/hittimeemi.png",
  },
];
