# Hittimeemi

A Heardle-style guessing game for Finnish memes. You hear 0.5 s of the clip, then 1 s, 2 s, 4 s, 8 s and 15 s. Each wrong guess or skip unlocks a longer clip. When the round is over, the YouTube video is revealed.

## Running it

Double-click `start.bat`. It starts a small local server (built into Windows, nothing to install) and opens the game at http://localhost:8000. Close the black window to stop the server.

YouTube clips need this server. Opening `index.html` directly only works with your own audio files.

## Adding memes

Edit `memes.js`. One line per meme:

```js
{ title: "Meemin nimi", aliases: ["muu nimi"], youtube: "https://youtu.be/XXXXXXXXXXX", start: "0:03.5" },
```

- `title` is the answer shown in the suggestion list.
- `aliases` are other spellings that also count as correct. Optional.
- `youtube` takes a normal link: `youtube.com/watch?v=…`, `youtu.be/…` or `/shorts/…`.
- `start` is where the clip begins: `12`, `12.5`, `"1:05"` or `"1:05.3"`. Use it to skip silence or an intro. If you leave it out, the game uses the link's `?t=` timestamp, so you can copy a link with YouTube's "Start at" option. Otherwise it starts at 0.
- Instead of `youtube` you can use `file: "audio/name.mp3"` for your own audio file in the `audio/` folder.

If a video fails, the game shows the reason and the video ID. Some videos don't allow embedding, and those won't work.

## Tweaking

The clip lengths are `STEPS` at the top of `game.js`.

The daily meme comes from the date and the length of the meme list. Adding memes changes which meme is "today's".

## Putting it online

The folder is a static site, so you can drop it on GitHub Pages, Netlify or Cloudflare Pages as is. YouTube works there without `start.bat`.
