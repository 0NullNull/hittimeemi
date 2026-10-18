// Yhteys pelipalvelimeen (server/). Moninpelin sivu lataa tämän ja kutsuu:
//
//   const net = Net.connect("pelin-id", {
//     status(s) {},     // "connecting" | "online" | "offline" (palvelin pois päältä tai yhteys poikki)
//     room(r) {},       // { code, you, host, locked, max, players: [{ id, name, connected }] } tai null
//     message(data) {}, // pelin viestit palvelimelta (room.send / room.broadcast)
//     error(e) {},      // { code, message }, message on valmis suomenkielinen teksti
//     latency(ms) {},   // viive palvelimelle, päivittyy 10 s välein
//   });
//   net.create("Nimi"); net.join("ABCD", "Nimi"); net.send({ ... }); net.leave();
//   net.room, net.me, net.isHost, net.status, net.latency
//
// Katkos tai sivun uudelleenlataus vie takaisin samaan huoneeseen. Sivu yhdistää
// localhostilla tämän koneen palvelimeen, muuten wss://fun-api.kuirinlahti.dev.
// Osoitteen perään ?server=live tai ?server=local pakottaa jommankumman.
(() => {
  const LIVE = "wss://fun-api.kuirinlahti.dev/ws";
  const LOCAL = "ws://127.0.0.1:8787/ws";

  function serverUrl() {
    const pick = new URLSearchParams(location.search).get("server");
    if (pick === "live") return LIVE;
    if (pick === "local") return LOCAL;
    return ["localhost", "127.0.0.1"].includes(location.hostname) ? LOCAL : LIVE;
  }

  // sessionStorage on välilehtikohtainen: uusi välilehti on uusi pelaaja
  const store = {
    get(key) {
      try { return sessionStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try {
        if (value == null) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, value);
      } catch {}
    },
  };

  function connect(game, on = {}) {
    const key = "net-" + game;
    const url = serverUrl();
    let ws = null, status = "", room = null, latency = null;
    let retries = 0, retryTimer = null, pingTimer = null, stopped = false;
    let pending = null; // create/join, joka lähtee heti kun yhteys aukeaa

    const emit = (name, value) => {
      try { on[name]?.(value); } catch (err) { console.error(err); }
    };
    const setStatus = (s) => {
      if (s !== status) emit("status", (status = s));
    };
    const setRoom = (r) => emit("room", (room = r));
    const lobby = (m, you) => ({ code: m.code, you, host: m.host, locked: m.locked, max: m.max, players: m.players });
    const raw = (msg) => {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    };

    function ping() {
      raw({ t: "ping", at: performance.now() });
      pingTimer = setTimeout(ping, 10000);
    }

    function open() {
      if (status !== "offline") setStatus("connecting");
      ws = new WebSocket(url);
      ws.onopen = () => {
        retries = 0;
        setStatus("online");
        const token = store.get(key);
        if (token) raw({ t: "resume", token });
        if (pending) raw(pending);
        pending = null;
        ping();
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        handle(msg);
      };
      ws.onclose = (e) => {
        ws = null;
        clearTimeout(pingTimer);
        if (stopped) return;
        setStatus("offline");
        if (e.code === 4000) {
          // sama pelaaja avattiin toisessa välilehdessä, se jatkaa ja tämä lopettaa
          stopped = true;
          setRoom(null);
          return emit("error", { code: "replaced", message: "Peli avattiin toisessa välilehdessä." });
        }
        retryTimer = setTimeout(open, Math.min(15000, 1000 * 2 ** retries++));
      };
    }

    function handle(msg) {
      switch (msg.t) {
        case "joined":
          store.set(key, msg.token);
          return setRoom(lobby(msg, msg.you));
        case "players":
          if (room) setRoom(lobby(msg, room.you));
          return;
        case "game":
          return emit("message", msg.data);
        case "pong":
          latency = Math.round(performance.now() - msg.at);
          return emit("latency", latency);
        case "error":
          if (msg.code === "resume-failed") {
            store.set(key, null);
            if (room) setRoom(null);
          }
          return emit("error", { code: msg.code, message: msg.message });
      }
    }

    const command = (msg) => {
      if (!raw(msg)) pending = msg;
    };

    // avataan vasta, kun kutsuja on saanut net-olion talteen
    queueMicrotask(open);

    return {
      url,
      create: (name) => command({ t: "create", game, name }),
      join: (code, name) => command({ t: "join", game, code, name }),
      send: (data) => raw({ t: "game", data }),
      leave() {
        pending = null;
        raw({ t: "leave" });
        store.set(key, null);
        if (room) setRoom(null);
      },
      close() {
        stopped = true;
        clearTimeout(retryTimer);
        ws?.close();
      },
      get status() { return status; },
      get room() { return room; },
      get me() { return room?.players.find((p) => p.id === room.you) ?? null; },
      get isHost() { return !!room && room.host === room.you; },
      get latency() { return latency; },
    };
  }

  window.Net = { connect, serverUrl };
})();
