// Käyttäjätili koko sivustolle: nimimerkki ja palautuskoodi, ei salasanoja eikä sähköpostia.
// Lisää sivun oikeaan yläkulmaan kirjautumisnapin ja sen ikkunan. Lataa shared/net.js ensin
// (palvelimen osoite). Pelit käyttävät:
//   Account.user                     { id, name } tai null
//   Account.onChange(fn)             fn(user) heti ja aina kun kirjautuminen muuttuu
//   Account.api(method, path, body)  pyyntö palvelimelle kirjautuneena, esim. tulostaulun haku
//   Account.open()                   avaa kirjautumisikkunan
// Token on localStoragessa (fun-session), joten kirjautuminen on yhteinen kaikille peleille.
(() => {
  const TOKEN_KEY = "fun-session";
  const USER_KEY = "fun-user"; // viimeksi tunnettu käyttäjä: nappi näyttää nimen heti latautuessa
  const base = Net.httpUrl();
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) {
      try {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {}
    },
  };

  let token = store.get(TOKEN_KEY);
  let user = null;
  try { user = token ? JSON.parse(store.get(USER_KEY)) : null; } catch {}
  let offline = false;
  const listeners = [];

  function setUser(nextUser, nextToken = token) {
    user = nextUser;
    token = nextUser ? nextToken : null;
    store.set(TOKEN_KEY, token);
    store.set(USER_KEY, user ? JSON.stringify(user) : null);
    renderButton();
    for (const fn of listeners) {
      try { fn(user); } catch (err) { console.error(err); }
    }
    dispatchEvent(new CustomEvent("fun-account")); // net.js kertoo muutoksen pelipalvelimelle
  }

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      offline = true;
      renderButton();
      throw Object.assign(new Error("Palvelin ei vastaa juuri nyt. Yritä myöhemmin uudelleen."), { offline: true });
    }
    offline = false;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token && path !== "/api/login") setUser(null); // token ei enää kelpaa
    if (!res.ok) throw Object.assign(new Error(data.message || "Jokin meni pieleen."), { code: data.error, status: res.status });
    return data;
  }

  // ---------- näkymä ----------

  // Elementit tekstisolmuina: nimimerkki voi sisältää mitä tahansa
  function h(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const c of children) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return e;
  }

  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c.8-3.8 3.9-6 7.5-6s6.7 2.2 7.5 6"/></svg>';

  const box = h("div", { class: "acct" });
  const button = h("button", { class: "acct-btn", type: "button" });
  const dialog = h("dialog", { class: "acct-dialog", "aria-label": "Käyttäjätili" });
  box.append(button);
  document.body.append(box, dialog);
  button.onclick = () => open();
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close(); // klikkaus ikkunan ulkopuolelle sulkee
  });

  function renderButton() {
    button.innerHTML = ICON;
    button.append(h("span", {}, user ? user.name : "Kirjaudu"));
    if (offline && user) button.append(h("span", { class: "acct-dot", title: "Palvelin ei vastaa juuri nyt" }));
    button.title = user ? "Käyttäjätilisi" : "Kirjaudu, niin tuloksesi tallentuvat tulostauluille";
  }

  function view(...children) {
    const close = h("button", { class: "acct-close", type: "button", "aria-label": "Sulje", onclick: () => dialog.close() }, "×");
    dialog.replaceChildren(close, ...children);
  }

  // Lomake, joka näyttää virheet ja estää tuplalähetyksen
  function form(onsubmit, ...children) {
    const error = h("p", { class: "acct-error", role: "alert" });
    const f = h("form", {}, ...children, error);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const buttons = f.querySelectorAll("button");
      buttons.forEach((b) => (b.disabled = true));
      error.textContent = "";
      try {
        await onsubmit(f);
      } catch (err) {
        error.textContent = err.message;
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    };
    return f;
  }

  function showStart() {
    const name = h("input", { name: "name", maxlength: "20", autocomplete: "nickname", spellcheck: "false", required: "" });
    const code = h("input", { name: "code", placeholder: "XXXX-XXXX-XXXX-XXXX", autocomplete: "off", spellcheck: "false", required: "" });
    view(
      h("h2", {}, "Kirjaudu peleihin"),
      h("p", { class: "acct-lead" }, "Nimimerkillä tuloksesi tallentuvat tulostauluille. Ei salasanoja eikä sähköpostia."),
      form(async () => {
        const data = await api("POST", "/api/account", { name: name.value });
        setUser(data.user, data.token);
        showCode(data.recovery, `Tervetuloa, ${data.user.name}!`);
      },
        h("label", { for: "acct-name" }, "Valitse nimimerkki"),
        h("div", { class: "acct-row" }, Object.assign(name, { id: "acct-name" }), h("button", { class: "acct-primary" }, "Luo tili")),
      ),
      h("div", { class: "acct-or" }, "tai"),
      form(async () => {
        const data = await api("POST", "/api/login", { recovery: code.value });
        setUser(data.user, data.token);
        dialog.close();
      },
        h("label", { for: "acct-code" }, "Onko sinulla jo tili? Kirjaudu palautuskoodilla"),
        h("div", { class: "acct-row" }, Object.assign(code, { id: "acct-code" }), h("button", {}, "Kirjaudu")),
      ),
    );
    setTimeout(() => name.focus());
  }

  function showCode(recovery, title) {
    const copy = h("button", { type: "button" }, "Kopioi koodi");
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(recovery);
        copy.textContent = "Kopioitu!";
      } catch {
        copy.textContent = "Kopioi käsin";
      }
    };
    view(
      h("h2", {}, title),
      h("p", { class: "acct-lead" }, "Tallenna tämä palautuskoodi. Sillä pääset tilillesi toisella laitteella tai jos selaimen tiedot katoavat. Koodia ei näytetä uudelleen."),
      h("div", { class: "acct-code" }, recovery),
      h("div", { class: "acct-row acct-end" }, copy, h("button", { class: "acct-primary", type: "button", onclick: () => dialog.close() }, "Tallensin sen")),
    );
  }

  function showAccount() {
    const name = h("input", { id: "acct-rename", maxlength: "20", autocomplete: "nickname", spellcheck: "false", required: "" });
    name.value = user.name;
    const actionError = h("p", { class: "acct-error", role: "alert" });
    const action = (fn) => async () => {
      actionError.textContent = "";
      try {
        await fn();
      } catch (err) {
        actionError.textContent = err.message;
      }
    };
    view(
      h("h2", {}, user.name),
      offline ? h("p", { class: "acct-lead" }, "Palvelin ei vastaa juuri nyt, joten tiliä ei voi muokata.") : null,
      form(async () => {
        const data = await api("POST", "/api/me/name", { name: name.value });
        setUser(data.user);
        showAccount();
      },
        h("label", { for: "acct-rename" }, "Nimimerkki"),
        h("div", { class: "acct-row" }, name, h("button", {}, "Tallenna")),
      ),
      h("div", { class: "acct-actions" },
        h("button", {
          type: "button",
          onclick: action(async () => {
            if (!confirm("Luodaanko uusi palautuskoodi? Vanha koodi lakkaa toimimasta.")) return;
            const data = await api("POST", "/api/me/recovery");
            showCode(data.recovery, "Uusi palautuskoodi");
          }),
        }, "Uusi palautuskoodi toista laitetta varten"),
        h("button", {
          type: "button",
          onclick: action(async () => {
            if (!confirm("Kirjaudutaanko ulos? Pääset tilillesi takaisin vain palautuskoodilla.")) return;
            await api("POST", "/api/logout").catch(() => {});
            setUser(null);
            dialog.close();
          }),
        }, "Kirjaudu ulos"),
        h("button", {
          type: "button",
          class: "acct-danger",
          onclick: action(async () => {
            if (!confirm(`Poistetaanko tili ${user.name} ja kaikki sen tulokset pysyvästi?`)) return;
            await api("DELETE", "/api/me");
            setUser(null);
            dialog.close();
          }),
        }, "Poista tili"),
      ),
      actionError,
    );
  }

  function open() {
    if (user) showAccount();
    else showStart();
    if (!dialog.open) dialog.showModal();
  }

  // ---------- käynnistys ----------

  renderButton();
  if (token) {
    api("GET", "/api/me")
      .then((data) => setUser(data.user))
      .catch(() => {}); // 401 kirjaa ulos (api), palvelimen katkos jättää viimeksi tunnetun nimen
  }

  window.Account = {
    get user() { return user; },
    onChange(fn) {
      listeners.push(fn);
      try { fn(user); } catch (err) { console.error(err); }
    },
    api,
    open,
  };
})();
