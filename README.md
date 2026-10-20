# fun.kuirinlahti.dev

A collection of small browser games, in the style of neal.fun. Each game lives in its own folder and is served at `fun.kuirinlahti.dev/<folder>/`.

| Game | Folder |
|---|---|
| Hittimeemi: guess the Finnish meme from a 0.5 s clip | [`hittimeemi/`](hittimeemi/) |
| Reaktio: multiplayer reaction duel (test game for the game server) | [`reaktio/`](reaktio/) |

## Running locally

Double-click `start.bat`. It starts a small local server (built into Windows, nothing to install) and opens the homepage at http://localhost:8000. Close the black window to stop it.

## Adding a new game

1. Make a folder, e.g. `my-game/`, with its own `index.html`. Use relative paths (`style.css`, not `/style.css`) so it works both locally and online.
2. Add a `← Kaikki pelit` link to `../` at the top, like Hittimeemi has.
3. Give it an `og-image.png` (1200×630) and `og:` meta tags so links look good on Discord.
4. Register it in [`shared/games.js`](shared/games.js) and put its image (1200×630) in `shared/thumbs/`. That one entry adds its card to the homepage and a "Kokeile myös" card for it on every other game.
5. Let the new game promote the others: put `data-game="my-game"` on its `<body>`, and include `/shared/more-games.css`, `/shared/games.js` and `/shared/more-games.js`. The cards appear outside the game: in the empty side margins on wide screens (right first, left once there are enough games), or at the bottom of the page on narrower ones. A game never promotes itself.
   - Don't name files or classes with "ad"/"ads". Ad blockers hide them automatically (EasyList hides `.ad-label` and `.ad-cta` on every site).
6. If the game saves anything in `localStorage`, prefix the keys (Hittimeemi uses `hm-`). All games share one domain, so they share storage.

## Multiplayer

Multiplayer games connect to a game server at `wss://fun-api.kuirinlahti.dev` through [`shared/net.js`](shared/net.js): rooms with 4-letter codes, a host, and rejoining after a page reload. The comment at the top of that file shows how a game page uses it.

The same server keeps **accounts** (username, email, password) and leaderboards.
- **Sign-in button:** [`shared/account.js`](shared/account.js) adds it to the top-right corner of a page. Load it after `net.js`, and include `/shared/account.css`.
- **In games:** use `Account.user`, `Account.onChange()`, `Account.api()` and `Account.open("signup" | "login")`. Reaktio's leaderboard is an example.
- **"Kokeile myös" cards:** when nobody is signed in, one of them is a "Luo oma tili" card that opens sign-up.
- **Privacy notice:** what's stored and why is in [`tietosuoja/`](tietosuoja/). Update it if accounts start storing or sending anything new.

The server itself lives in a separate private repo, cloned into `server/` here (this repo's `.gitignore` keeps it out). [`dev/lobby-test/`](dev/lobby-test/) is a test page for the connection: open it in two windows, create a room in one and join from the other. Opened from localhost, it uses a server running on this PC.

## Hittimeemi

Heardle-style: you hear 0.5 s of a clip, then 1 s, 2 s, 4 s, 8 s and 15 s. Each wrong guess or skip unlocks a longer clip.

### Memes

The memes live in the game server's database. You manage them in the admin panel's **Hittimeemi** tab, at http://192.168.100.4:8790/#hittimeemi from home or over the VPN:
- **Add and edit:** set the name, other accepted names (aliases), the YouTube link and an optional start time. There's a preview, and you can hide or delete memes.
- **Checks on saving:** two memes can't share a name, and the same clip can't be added twice.
- **Suggestions:** players suggest memes with the **Ehdota meemiä** button in the game, which needs an account. Suggestions wait in the tab's queue: *Lisää peliin…* fills the editor, *Hylkää* rejects.
- **Import:** paste a JSON list or `memes.js`-style text, and it becomes suggestions to review.

Field details:
- **Name and aliases:** the name is the answer shown in the suggestion list. Aliases are other spellings that also count as correct.
- **YouTube link:** a normal `youtube.com/watch?v=…`, `youtu.be/…` or `/shorts/…` link.
- **Start time:** `12`, `12.5`, `1:05` or `1:05.3`. If empty, the link's `?t=` timestamp is used (YouTube's Share → "Start at"), otherwise 0.
- **Videos that won't play:** age-restricted videos and videos with embedding disabled.

**`hittimeemi/memes.js` is now only a fallback.** The game loads the list from the server. If the server doesn't answer, it uses the list this browser saved last time, and failing that, `memes.js`. Editing the file doesn't change the game. Refresh it now and then with the admin panel's *Lataa memes.js (varalista)* and commit it.

### Tweaking

- Clip lengths: `STEPS` at the top of `hittimeemi/game.js`.
- **Daily meme:** the server picks one once per day (Finnish time) and saves it, so it's the same for everyone and editing the list doesn't change it. It picks memes that haven't been the daily meme yet, then the ones that waited longest. Only when the server is unreachable does the game fall back to working it out from the date.
- Free play goes through every meme once before repeating, and the counter shows how many are left.

## Hosting

GitHub Pages serves the repo root. The custom domain is in `CNAME`, and Cloudflare DNS points `fun` at `<username>.github.io`.
