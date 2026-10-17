# fun.kuirinlahti.dev

A collection of small browser games, in the style of neal.fun. Each game lives in its own folder and is served at `fun.kuirinlahti.dev/<folder>/`.

| Game | Folder |
|---|---|
| Hittimeemi: guess the Finnish meme from a 0.5 s clip | [`hittimeemi/`](hittimeemi/) |

## Running locally

Double-click `start.bat`. It starts a small local server (built into Windows, nothing to install) and opens the homepage at http://localhost:8000. Close the black window to stop it.

## Adding a new game

1. Make a folder, e.g. `my-game/`, with its own `index.html`. Use relative paths (`style.css`, not `/style.css`) so it works both locally and online.
2. Add a `← Kaikki pelit` link to `../` at the top, like Hittimeemi has.
3. Give it an `og-image.png` (1200×630) and `og:` meta tags so links look good on Discord.
4. Add a card for it on the homepage: copy the `<a class="game">` block in `index.html`.
5. If the game saves anything in `localStorage`, prefix the keys (Hittimeemi uses `hm-`). All games share one domain, so they share storage.

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

## Hosting

GitHub Pages serves the repo root. The custom domain is in `CNAME`, and Cloudflare DNS points `fun` at `<username>.github.io`.
