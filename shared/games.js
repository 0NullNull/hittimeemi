// Kaikki sivuston pelit. Uusi peli rekisteröidään lisäämällä rivi tähän:
// se näkyy silloin etusivulla ja "Kokeile myös" -kortteina kaikissa muissa peleissä.
//   id      = pelin kansion nimi (sama kuin pelisivun <body data-game="…">)
//   title   = pelin nimi
//   tagline = lyhyt houkutteleva kuvaus
//   url     = pelin osoite sivuston juuresta
//   image   = kuva (1200×630), shared/thumbs-kansiossa
//
// Huom: tiedostoissa ja luokissa ei käytetä sanaa "ad"/"ads", koska
// mainosten estäjät piilottavat sellaiset automaattisesti.
window.GAMES = [
  {
    id: "hittimeemi",
    title: "Hittimeemi",
    tagline: "Tunnistatko suomimeemin puolessa sekunnissa?",
    url: "/hittimeemi/",
    image: "/shared/thumbs/hittimeemi.png",
  },
  {
    id: "reaktio",
    title: "Reaktio",
    tagline: "Kuka teistä on nopein? Reaktiokisa kavereiden kanssa.",
    url: "/reaktio/",
    image: "/shared/thumbs/reaktio.png",
  },
];
