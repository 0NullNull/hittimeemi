# fun.kuirinlahti.dev

A collection of small browser games, in the style of neal.fun. Each game lives in its own folder and is served at `fun.kuirinlahti.dev/<folder>/`.

| Game | Folder |
|---|---|
| Hittimeemi: guess the Finnish meme from a 0.5 s clip | [`hittimeemi/`](hittimeemi/) |
| Päivän rata: daily 3-hole minigolf with a physics modifier | [`golf/`](golf/) |
| 50 Hz: build Finland's power grid (incremental, hardcore physics) | [`grid/`](grid/) |

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

## Hittimeemi

Heardle-style: you hear 0.5 s of a clip, then 1 s, 2 s, 4 s, 8 s and 15 s. Each wrong guess or skip unlocks a longer clip.

### Adding memes

Edit `hittimeemi/memes.js`. One line per meme:

```js
{ title: "Meemin nimi", aliases: ["muu nimi"], youtube: "https://youtu.be/XXXXXXXXXXX", start: "0:03.5" },
```

- `title` is the answer shown in the suggestion list.
- `aliases` are other spellings that also count as correct. Don't reuse an alias across memes.
- `youtube` takes a normal link: `youtube.com/watch?v=…`, `youtu.be/…` or `/shorts/…`.
- `start` is where the clip begins: `12`, `12.5`, `"1:05"` or `"1:05.3"`. If you leave it out, the link's `?t=` timestamp is used (YouTube's Share → "Start at"), otherwise 0.
- Instead of `youtube` you can use `file: "audio/name.mp3"` for your own audio in `hittimeemi/audio/`.

Age-restricted videos and videos with embedding disabled won't play.

### Tweaking

- Clip lengths: `STEPS` at the top of `hittimeemi/game.js`.
- The daily meme comes from the date and the length of the meme list, so adding or removing memes changes which meme is "today's".
- Free play goes through every meme once before repeating, and the counter shows how many are left.

## Päivän rata

Every day has a 3-hole course and one modifier (ice, wind, bouncy walls, magnetic hole, heavy ball, tiny hole, or a normal day). Holes have sand, water, boost pads, portals, bumpers and moving walls.

- **Hand-made courses:** add a date to [`golf/holes.js`](golf/holes.js). The file explains the format, and an example sits under `2026-01-01`. A hand-made course always wins over a generated one for that date.
- **Generated courses:** otherwise the course is built from the date, so everyone gets the same one. A solver simulates thousands of shots to check each hole can be finished in 3 or fewer, and sets par to that number + 1.
- Physics is in `golf/physics.js` and shared by the game and the solver, so a hole that passes the check plays the same way for players.

## 50 Hz

An incremental grid-building game on a real map of Finland. Start with one gas turbine in a town of your choice, build lines and plants, connect towns as customers, and keep the frequency at 50 Hz.

- **Real data** in `grid/data/` (packed, ~2 MB): Finland's hourly electricity load 2015–2019 (ENTSO-E via Open Power System Data), hourly weather for 16 points (Open-Meteo, CC BY 4.0), Finland outline (Natural Earth). Later game years replay 2015–2019 with 1.2 %/yr demand growth.
- **Simulation** (`grid/js/sim.js`): unit commitment, merit-order dispatch with frequency reserves, DC power flow (`network.js`), congestion management (redispatch, then controlled load shedding), line overload protection, random faults (storms from real wind), second-by-second frequency transients with inertia, FCR and UFLS, and an N-1 security check.
- **Tuning**: `grid/js/tech.js` holds plant/line parameters and `ECON` (construction costs at 15 % of real, revenue at real prices).
- Saves go to `localStorage` (`grid-save-v1`), with export/import from the menu.

## Hosting

GitHub Pages serves the repo root. The custom domain is in `CNAME`, and Cloudflare DNS points `fun` at `<username>.github.io`.
