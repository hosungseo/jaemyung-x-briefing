# Jaemyung X Briefing

Static GitHub Pages prototype for analyzing posts from `@Jaemyung_Lee` since 2025-06-04.

Live page: https://hosungseo.github.io/jaemyung-x-briefing/

## Build

```bash
node scripts/build-data.js
```

Override the start date:

```bash
START_DATE=2025-06-04 node scripts/build-data.js
```

Open `index.html` directly, or serve the folder with any static server.

## X Watch Alerts

The Telegram watcher uses the X API response text as the source of truth and
requests `tweet.fields=lang` so alerts can show the original language returned
by X. To avoid Telegram/X app auto-translation previews, alert messages render
X links as `x[.]com/...` and include the API original text inline.

```bash
scripts/watch-jaemyung-lee-tweets.sh
```
