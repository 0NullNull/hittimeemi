// Käyttäjätili koko sivustolle: käyttäjätunnus, sähköposti ja salasana. Lisää sivun
// oikeaan yläkulmaan kirjautumisnapin ja sen ikkunan. Lataa shared/net.js ensin
// (palvelimen osoite). Pelit käyttävät:
//   Account.user                     { id, name } tai null
//   Account.onChange(fn)             fn(user) heti ja aina kun kirjautuminen muuttuu
//   Account.api(method, path, body)  pyyntö palvelimelle kirjautuneena, esim. tulostaulun haku
//   Account.open(mode)               avaa ikkunan: "login" (oletus) tai "signup"
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
    user = nextUser ? { id: nextUser.id, name: nextUser.name } : null;
    token = user ? nextToken : null;
    store.set(TOKEN_KEY, token);
    store.set(USER_KEY, user ? JSON.stringify(user) : null);
    renderButton();
    for (const fn of listeners) {
      try { fn(user); } catch (err) { console.error(err); }
    }
    dispatchEvent(new CustomEvent("fun-account")); // net.js ja "Kokeile myös" -kortit päivittyvät
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

  // Elementit tekstisolmuina: käyttäjätunnus voi sisältää mitä tahansa
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
    button.title = user ? "Käyttäjätilisi" : "Kirjaudu tai luo tili, niin tuloksesi tallentuvat tulostauluille";
  }

  function view(...children) {
    const close = h("button", { class: "acct-close", type: "button", "aria-label": "Sulje", onclick: () => dialog.close() }, "×");
    dialog.replaceChildren(close, ...children.filter((c) => c != null)); // null = ehdollinen osa puuttuu
  }

  let fieldId = 0;
  function field(label, input, note) {
    input.id = `acct-f${++fieldId}`;
    return h("div", { class: "acct-field" }, h("label", { for: input.id }, label), input, note ? h("p", { class: "acct-note" }, note) : null);
  }
  function fieldRow(label, input, submit) {
    input.id = `acct-f${++fieldId}`;
    return h("div", { class: "acct-field" }, h("label", { for: input.id }, label), h("div", { class: "acct-row" }, input, submit));
  }
  const input = (props) => h("input", { spellcheck: "false", autocapitalize: "off", ...props });

  // Lomake näyttää virheen tai onnistumisviestin (onsubmit voi palauttaa tekstin) ja estää tuplalähetyksen
  function form(onsubmit, ...children) {
    const error = h("p", { class: "acct-error", role: "alert" });
    const ok = h("p", { class: "acct-ok", role: "status" });
    const f = h("form", {}, ...children, error, ok);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const buttons = f.querySelectorAll("button");
      buttons.forEach((b) => (b.disabled = true));
      error.textContent = ok.textContent = "";
      try {
        const message = await onsubmit(f);
        if (typeof message === "string") ok.textContent = message;
      } catch (err) {
        error.textContent = err.message;
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    };
    return f;
  }

  function tabs(active) {
    const tab = (id, label, show) =>
      h("button", { type: "button", role: "tab", class: active === id ? "on" : "", "aria-selected": String(active === id), onclick: show }, label);
    return h("div", { class: "acct-tabs", role: "tablist" }, tab("login", "Kirjaudu", showLogin), tab("signup", "Luo tili", showSignup));
  }

  function showLogin() {
    const login = input({ name: "username", autocomplete: "username", required: "" });
    const password = h("input", { name: "password", type: "password", autocomplete: "current-password", required: "" });
    view(
      tabs("login"),
      form(async () => {
        const data = await api("POST", "/api/login", { login: login.value, password: password.value });
        setUser(data.user, data.token);
        dialog.close();
      },
        field("Käyttäjätunnus tai sähköposti", login),
        field("Salasana", password),
        h("button", { class: "acct-primary acct-wide" }, "Kirjaudu"),
      ),
      h("p", { class: "acct-note" }, "Unohtuiko salasana? Ylläpito voi asettaa sinulle uuden."),
    );
    setTimeout(() => login.focus());
  }

  function showSignup() {
    const name = input({ name: "username", autocomplete: "username", maxlength: "20", required: "" });
    const email = input({ name: "email", type: "email", autocomplete: "email", maxlength: "254", required: "" });
    const password = h("input", { name: "new-password", type: "password", autocomplete: "new-password", minlength: "8", required: "" });
    view(
      tabs("signup"),
      form(async () => {
        const data = await api("POST", "/api/account", { name: name.value, email: email.value, password: password.value });
        setUser(data.user, data.token);
        view(
          h("h2", {}, `Tervetuloa, ${data.user.name}!`),
          h("p", { class: "acct-lead" }, "Tuloksesi tallentuvat nyt tulostauluille. Kirjaudu muilla laitteilla samalla käyttäjätunnuksella ja salasanalla."),
          h("button", { class: "acct-primary acct-wide", type: "button", onclick: () => dialog.close() }, "Pelaamaan!"),
        );
      },
        field("Käyttäjätunnus", name, "Näkyy tulostauluilla. 2–20 merkkiä."),
        field("Sähköposti", email, "Ei näy muille. Siihen ei toistaiseksi lähetetä mitään."),
        field("Salasana", password, "Vähintään 8 merkkiä."),
        h("button", { class: "acct-primary acct-wide" }, "Luo tili"),
        h("p", { class: "acct-note" }, "Tiedot tallennetaan ", h("a", { href: "/tietosuoja/", target: "_blank" }, "tietosuojaselosteen"), " mukaisesti."),
      ),
    );
    setTimeout(() => name.focus());
  }

  async function showAccount() {
    view(h("h2", {}, user.name), h("p", { class: "acct-lead" }, "Ladataan…"));
    let me;
    try {
      me = (await api("GET", "/api/me")).user;
    } catch (err) {
      if (!user) return showLogin(); // token ei kelvannut
      return view(h("h2", {}, user.name), h("p", { class: "acct-lead" }, err.message));
    }

    const name = input({ name: "username", autocomplete: "username", maxlength: "20", required: "" });
    name.value = me.name;
    const email = input({ name: "email", type: "email", autocomplete: "email", maxlength: "254", required: "" });
    email.value = me.email ?? "";
    const current = h("input", { name: "current-password", type: "password", autocomplete: "current-password", required: "" });
    const next = h("input", { name: "new-password", type: "password", autocomplete: "new-password", minlength: "8", required: "" });
    const confirmPassword = h("input", { name: "password", type: "password", autocomplete: "current-password", required: "" });

    view(
      h("h2", {}, me.name),
      me.hasPassword
        ? null
        : h("p", { class: "acct-warn" }, "Tililläsi ei ole vielä salasanaa. Aseta se ja lisää sähköposti, jotta pääset tilillesi myös muilla laitteilla."),
      form(async () => {
        setUser((await api("POST", "/api/me/name", { name: name.value })).user);
        dialog.querySelector("h2").textContent = user.name;
        return "Tallennettu.";
      }, fieldRow("Käyttäjätunnus", name, h("button", {}, "Tallenna"))),
      form(async () => {
        await api("POST", "/api/me/email", { email: email.value });
        return "Tallennettu.";
      }, fieldRow("Sähköposti", email, h("button", {}, "Tallenna"))),
      h("details", { class: "acct-more", ...(me.hasPassword ? {} : { open: "" }) },
        h("summary", {}, me.hasPassword ? "Vaihda salasana" : "Aseta salasana"),
        form(async () => {
          await api("POST", "/api/me/password", { current: current.value, password: next.value });
          if (!me.hasPassword) return showAccount();
          current.value = next.value = "";
          return "Salasana vaihdettu. Muut laitteet kirjattiin ulos.";
        },
          me.hasPassword ? field("Nykyinen salasana", current) : null,
          field("Uusi salasana", next, "Vähintään 8 merkkiä."),
          h("button", {}, me.hasPassword ? "Vaihda salasana" : "Aseta salasana"),
        ),
      ),
      h("button", {
        type: "button",
        class: "acct-wide acct-logout",
        onclick: async () => {
          if (!me.hasPassword && !confirm("Tililläsi ei ole salasanaa, joten et pääse sille enää takaisin. Kirjaudutaanko silti ulos?")) return;
          await api("POST", "/api/logout").catch(() => {});
          setUser(null);
          dialog.close();
        },
      }, "Kirjaudu ulos"),
      h("details", { class: "acct-more" },
        h("summary", {}, "Poista tili"),
        form(async () => {
          if (!confirm(`Poistetaanko tili ${me.name} ja kaikki sen tulokset pysyvästi?`)) return;
          await api("POST", "/api/me/delete", { password: confirmPassword.value });
          setUser(null);
          dialog.close();
        },
          h("p", { class: "acct-note" }, "Tili ja kaikki sen tulokset kaikissa peleissä poistetaan pysyvästi."),
          me.hasPassword ? field("Salasana varmistukseksi", confirmPassword) : null,
          h("button", { class: "acct-danger" }, "Poista tili pysyvästi"),
        ),
      ),
    );
  }

  function open(mode) {
    if (user) showAccount();
    else if (mode === "signup") showSignup();
    else showLogin();
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
