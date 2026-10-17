// 50 Hz – voimalatyypit, linjat ja talous.
// Luvut ovat pyöristettyjä mutta realistisen suuruisia; pelin tahtia säädetään ECON-kertoimilla.
(function (root) {
  const G = (root.GridGame = root.GridGame || {});

  // Polttoaineiden ja päästöoikeuksien vuosikeskiarvot (likimääräiset todelliset), €/MWh polttoainetta tai €/t CO2
  const PRICES = {
    gas: { 2015: 21, 2016: 14, 2017: 17, 2018: 23, 2019: 14 },
    coal: { 2015: 7, 2016: 7, 2017: 10, 2018: 11, 2019: 7.5 },
    co2: { 2015: 7.7, 2016: 5.3, 2017: 5.8, 2018: 15.5, 2019: 24.8 },
  };
  function priceFor(kind, year) {
    const t = PRICES[kind];
    if (t[year] != null) return t[year];
    const last = Math.max(...Object.keys(t).map(Number));
    // tulevaisuus: päästöoikeus kallistuu, muut pysyvät
    return kind === "co2" ? t[last] + 4 * (year - last) : t[last];
  }

  const ECON = {
    startMoney: 80e6,
    retailPrice: 90,          // €/MWh, jonka asiakkaat maksavat toimitetusta sähköstä
    unservedPenalty: 1000,    // €/MWh toimittamatta jäänyttä sähköä (korvaukset)
    connectionFee: 500,       // € / painotettu asukas, kun kaupunki liitetään ensimmäistä kertaa
    lineOMPerKmYear: 2000,
    // Pelin tahti: rakennus- ja kiinteät kulut neljäsosa todellisesta, tulot todellisia.
    // Muuten ensimmäinen tuulipuisto maksaisi vuosien tulot.
    capexScale: 0.15,
    omScale: 0.2,
  };

  // Rakennuskustannus laskee joillakin teknologioilla vuosittain (€M/MW)
  const learning = (base, perYear, floor) => (year) => Math.max(floor, base * Math.pow(1 - perYear, Math.max(0, year - 2015)));

  // fuel(year): muuttuva kustannus €/MWh sähköä. co2: t/MWh sähköä.
  // ramp: osuus nimellistehosta minuutissa. minLoad: minimiteho päällä ollessa.
  // H: hitausvakio (s) – vain synkronikoneilla. fcr: osuus tehosta, jonka voi pitää taajuusreservinä.
  // tripsPerYear: vikaantumistaajuus. repairDays: korjausaika. startHours: käynnistysaika.
  const UNITS = {
    diesel: {
      name: "Dieselvoimala", short: "Diesel", color: "#9ca3af", sizes: [10, 20, 50],
      capex: () => 0.35, omPerMWYear: 8000, fuel: () => 150, co2: 0.75,
      ramp: 0.5, minLoad: 0.3, startHours: 0.05, minUpHours: 0.5, H: 1.5, fcr: 0.3, fcrT: 2,
      tripsPerYear: 4, repairDays: 2, buildDays: 30, where: "town", blackStart: true,
      desc: "Nopea ja halpa rakentaa, mutta polttoaine on kallista.",
    },
    ocgt: {
      name: "Kaasuturbiini", short: "Kaasuturb.", color: "#f59e0b", sizes: [50, 100, 200],
      capex: () => 0.55, omPerMWYear: 10000, fuel: (y) => priceFor("gas", y) / 0.36 + priceFor("co2", y) * 0.56, co2: 0.56,
      ramp: 0.2, minLoad: 0.3, startHours: 0.2, minUpHours: 1, H: 4, fcr: 0.3, fcrT: 3,
      tripsPerYear: 2, repairDays: 2, buildDays: 90, where: "town", blackStart: true,
      desc: "Huippuvoimaa: käynnistyy minuuteissa, hyvä taajuusreservi.",
    },
    ccgt: {
      name: "Kombivoimala", short: "Kombi", color: "#fb923c", sizes: [250, 450],
      capex: () => 0.9, omPerMWYear: 20000, fuel: (y) => priceFor("gas", y) / 0.56 + priceFor("co2", y) * 0.36, co2: 0.36,
      ramp: 0.05, minLoad: 0.4, startHours: 3, minUpHours: 4, H: 5, fcr: 0.1, fcrT: 6,
      tripsPerYear: 2, repairDays: 3, buildDays: 400, where: "town", unlock: "mid",
      desc: "Tehokas kaasuvoimala keskikuormaan. Käynnistys kestää tunteja.",
    },
    coal: {
      name: "Hiilivoimala", short: "Hiili", color: "#6b7280", sizes: [250, 500],
      capex: () => 1.6, omPerMWYear: 35000, fuel: (y) => priceFor("coal", y) / 0.4 + priceFor("co2", y) * 0.86, co2: 0.86,
      ramp: 0.02, minLoad: 0.4, startHours: 8, minUpHours: 12, H: 6, fcr: 0.05, fcrT: 10,
      tripsPerYear: 3, repairDays: 4, buildDays: 700, where: "town", unlock: "mid",
      desc: "Halpaa perusvoimaa – kunnes päästöoikeus kallistuu. Hidas säätää.",
    },
    chp: {
      name: "Yhteistuotanto (CHP)", short: "CHP", color: "#a16207", sizes: [50, 150, 300],
      capex: () => 1.8, omPerMWYear: 40000, fuel: (y) => 25 + priceFor("co2", y) * 0.35, co2: 0.35,
      ramp: 0.03, minLoad: 0, startHours: 4, minUpHours: 6, H: 5, fcr: 0.05, fcrT: 10,
      tripsPerYear: 2, repairDays: 3, buildDays: 500, where: "town", minPop: 30000, heatDriven: true,
      desc: "Kaukolämpövoimala: tuottaa sähköä sitä enemmän, mitä kylmempää on. Kesällä lähes seis.",
    },
    nuclear: {
      name: "Ydinvoimala", short: "Ydin", color: "#a78bfa", sizes: [500, 1000, 1600],
      capex: () => 5.5, omPerMWYear: 100000, fuel: () => 8, co2: 0,
      ramp: 0.005, minLoad: 0.7, startHours: 48, minUpHours: 1e9, H: 6, fcr: 0, fcrT: 10,
      tripsPerYear: 1, repairDays: 6, buildDays: 2000, where: "nuclear", unlock: "high", refuelDays: 21,
      desc: "Valtava, halpa ja tasainen. Jos se laukeaa, koko verkko tuntee sen.",
    },
    hydro: {
      name: "Vesivoimala", short: "Vesi", color: "#38bdf8", sizes: [50, 100, 200],
      capex: () => 2.5, omPerMWYear: 25000, fuel: () => 0, co2: 0,
      ramp: 0.3, minLoad: 0.05, startHours: 0.1, minUpHours: 0, H: 3, fcr: 0.4, fcrT: 5,
      tripsPerYear: 0.5, repairDays: 2, buildDays: 600, where: "hydro", blackStart: true,
      desc: "Säädettävä ja päästötön. Vesivarasto riittää rajallisesti – kevättulva täyttää altaat.",
    },
    wind: {
      name: "Tuulipuisto", short: "Tuuli", color: "#5eead4", sizes: [50, 100, 200],
      capex: learning(1.6, 0.05, 1.0), omPerMWYear: 30000, fuel: () => 0, co2: 0,
      ramp: 1, minLoad: 0, startHours: 0, minUpHours: 0, H: 0, fcr: 0, fcrT: 1,
      tripsPerYear: 0, repairDays: 0, buildDays: 180, where: "town", weather: "wind",
      desc: "Ilmainen sähkö, kun tuulee. Ei hitausmassaa eikä reserviä.",
    },
    solar: {
      name: "Aurinkopuisto", short: "Aurinko", color: "#fde047", sizes: [20, 50, 100],
      capex: learning(1.1, 0.12, 0.45), omPerMWYear: 12000, fuel: () => 0, co2: 0,
      ramp: 1, minLoad: 0, startHours: 0, minUpHours: 0, H: 0, fcr: 0, fcrT: 1,
      tripsPerYear: 0, repairDays: 0, buildDays: 60, where: "town", weather: "solar",
      desc: "Halpenee vuosi vuodelta. Talvella Suomessa lähes hyödytön.",
    },
    battery: {
      name: "Akkuvarasto (2 h)", short: "Akku", color: "#f472b6", sizes: [20, 50, 100],
      capex: learning(1.6, 0.15, 0.5), omPerMWYear: 10000, fuel: () => 0, co2: 0,
      ramp: 1, minLoad: 0, startHours: 0, minUpHours: 0, H: 0, fcr: 1, fcrT: 0.3,
      tripsPerYear: 0.3, repairDays: 1, buildDays: 90, where: "town", storageHours: 2, efficiency: 0.9,
      desc: "Reagoi millisekunneissa: paras taajuusreservi. Varastoi halpaa sähköä kalliille tunneille.",
    },
  };

  // Linjat: x = reaktanssi Ω/km, limit = siirtokyky MW, capex €M/km
  const LINES = {
    110: { name: "110 kV", limit: 120, xPerKm: 0.4, capexPerKm: 0.25, buildDays: 45, faultsPer100kmYear: 0.6, repairHours: 8, color: "#94a3b8" },
    220: { name: "220 kV", limit: 350, xPerKm: 0.4, capexPerKm: 0.45, buildDays: 90, faultsPer100kmYear: 0.4, repairHours: 12, color: "#cbd5e1", unlock: "mid" },
    400: { name: "400 kV", limit: 1400, xPerKm: 0.3, capexPerKm: 0.9, buildDays: 150, faultsPer100kmYear: 0.25, repairHours: 16, color: "#f1f5f9", unlock: "high" },
  };
  const MAX_LINE_KM = 320;

  // Ulkomaanyhteydet (asetukset world.json:ssa), rakennuskustannus €M/MW
  const LINK = { capexPerMW: 0.5, buildDays: 365, tripsPerYear: 1, repairDays: 2, unlock: "high" };

  // Avausvaiheet: huipputeho, jonka verkko on toimittanut
  const UNLOCKS = {
    mid: { peakMW: 400, label: "Avautuu, kun verkon huippukuorma on 400 MW" },
    high: { peakMW: 1500, label: "Avautuu, kun verkon huippukuorma on 1 500 MW" },
  };

  // Tuulivoimalan tehokäyrä: tuulen nopeus 100 m korkeudessa (m/s) → osuus nimellistehosta
  function windCurve(v) {
    if (v < 3 || v > 25) return 0;
    if (v >= 12) return 1;
    const x = (v - 3) / 9;
    return x * x * x * 0.85 + x * 0.15;
  }
  // Aurinko: säteily W/m² → osuus nimellistehosta
  const solarCurve = (rad) => Math.min(1, (rad / 1000) * 0.9);
  // Kaukolämmön tarve 0..1 ulkolämpötilasta
  const heatFactor = (temp) => Math.max(0, Math.min(1, (17 - temp) / 35));

  // Vesivoiman kuukausittainen virtaama suhteessa keskiarvoon (kevättulva toukokuussa)
  const HYDRO_INFLOW = [0.7, 0.62, 0.65, 0.85, 2.3, 1.65, 1.0, 0.8, 0.85, 0.95, 0.95, 0.8];
  const HYDRO_CF = 0.48; // keskimääräinen virtaama suhteessa asennettuun tehoon

  G.Tech = { ECON, UNITS, LINES, LINK, UNLOCKS, MAX_LINE_KM, priceFor, windCurve, solarCurve, heatFactor, HYDRO_INFLOW, HYDRO_CF };
})(typeof window !== "undefined" ? window : globalThis);
