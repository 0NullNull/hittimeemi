// 50 Hz – todellisen datan lukeminen: kulutus (ENTSO-E/OPSD) ja sää (Open-Meteo).
// Pelin aika t = sekunteja hetkestä 1.1.2015 00:00 UTC.
(function (root) {
  const G = (root.GridGame = root.GridGame || {});
  const EPOCH_MS = Date.UTC(2015, 0, 1);
  const DATA_YEARS = [2015, 2016, 2017, 2018, 2019];

  class GridData {
    constructor(world, loadBuffer, weatherBuffers) {
      this.world = world;
      this.load = new Uint16Array(loadBuffer);
      this.weather = {};
      for (const y of DATA_YEARS) this.weather[y] = new Uint8Array(weatherBuffers[y]);
      this.stationCount = world.stations.length;
      // datavuosien alkuindeksit kulutussarjassa
      this.yearStart = {};
      let idx = 0;
      for (const y of DATA_YEARS) {
        this.yearStart[y] = idx;
        idx += world.yearHours[y];
      }
      this.cache = { hour: -1 };
    }

    // Pelin aika → datavuosi ja tunti sen sisällä
    locate(t) {
      const d = new Date(EPOCH_MS + t * 1000);
      const year = d.getUTCFullYear();
      const dataYear = 2015 + (((year - 2015) % 5) + 5) % 5;
      const hourF = (EPOCH_MS + t * 1000 - Date.UTC(year, 0, 1)) / 3600000;
      const maxH = this.world.yearHours[dataYear] - 1.001;
      return { year, dataYear, hourF: Math.min(hourF, maxH) };
    }

    // Sähkön kulutuksen kasvu datavuosien jälkeen (sähköistyminen)
    growth(year) {
      return year <= 2019 ? 1 : 1 + 0.012 * (year - 2019);
    }

    // Koko Suomen kulutus MW hetkellä t (tuntien välillä interpoloiden)
    nationalLoad(t) {
      const { year, dataYear, hourF } = this.locate(t);
      const h = Math.floor(hourF), f = hourF - h;
      const base = this.yearStart[dataYear];
      const a = this.load[base + h], b = this.load[base + Math.min(h + 1, this.world.yearHours[dataYear] - 1)];
      return (a + (b - a) * f) * this.growth(year);
    }

    // Sää sääasemalla s hetkellä t: { wind m/s, temp °C, rad W/m² }
    weatherAt(s, t) {
      const { dataYear, hourF } = this.locate(t);
      const w = this.weather[dataYear];
      const S = this.stationCount;
      const h = Math.floor(hourF), f = hourF - h;
      const h2 = Math.min(h + 1, this.world.yearHours[dataYear] - 1);
      const i1 = (h * S + s) * 3, i2 = (h2 * S + s) * 3;
      const lerp = (k) => w[i1 + k] + (w[i2 + k] - w[i1 + k]) * f;
      return { wind: lerp(0) * 0.25, temp: lerp(1) - 60, rad: lerp(2) * 4 };
    }
  }

  // ---------- Kartta ----------
  // Sinusoidaaliprojektio, keskimeridiaani 26°E. Tuottaa kilometrejä.
  const LON0 = 26, KM_PER_DEG = 111.2;
  function project(lat, lon) {
    return { x: (lon - LON0) * Math.cos((lat * Math.PI) / 180) * KM_PER_DEG, y: -(lat - 64) * KM_PER_DEG };
  }
  // Isoympyräetäisyys km
  function distanceKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // Pelin aika → päivämäärä Suomen aikaa
  const fmtDate = new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki", weekday: "short", day: "numeric", month: "numeric", year: "numeric" });
  const fmtTime = new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit" });
  function formatTime(t) {
    const d = new Date(EPOCH_MS + t * 1000);
    return { date: fmtDate.format(d), time: fmtTime.format(d), year: d.getUTCFullYear(), month: d.getUTCMonth() };
  }

  // Lataa kaiken datan. getBin(path) → ArrayBuffer, getJson(path) → objekti.
  async function loadData(getBin, getJson) {
    const world = await getJson("data/world.json");
    const loadBuffer = await getBin("data/load.bin");
    const weatherBuffers = {};
    await Promise.all(DATA_YEARS.map(async (y) => { weatherBuffers[y] = await getBin(`data/weather-${y}.bin`); }));
    return new GridData(world, loadBuffer, weatherBuffers);
  }

  G.GridData = GridData;
  G.loadData = loadData;
  G.project = project;
  G.distanceKm = distanceKm;
  G.formatTime = formatTime;
  G.EPOCH_MS = EPOCH_MS;
})(typeof window !== "undefined" ? window : globalThis);
