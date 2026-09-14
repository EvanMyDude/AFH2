# Act From Here — self-hosted

The claude.ai artifact, packaged for GitHub Pages. The app component is byte-identical
to the artifact; `app.js` bundles it with a storage adapter (localStorage), optional
GitHub-Gist sync, an Anthropic API shim for Sort It, and export/import backups.

## Deploy (one time, ~3 minutes)
1. Create a **public** repo named exactly `ActFromHere` at github.com/evanmydude.
2. Upload every file in this folder to the repo **root** (drag-and-drop on github.com works).
3. Repo → Settings → Pages → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → Save.
4. Wait ~1 minute → https://evanmydude.github.io/ActFromHere/

## Phone (do this — it matters for data durability)
Open the URL in Safari → Share → **Add to Home Screen**. You get a standalone app,
offline support, and — critically — installed web apps are exempt from Safari's
policy of purging a website's storage after 7 days of non-use.

## Sync + Sort It (the ⇄ button, bottom-right)
- **GitHub token** → cross-device sync + off-device backup. Create at
  github.com/settings/tokens → "Generate new token (classic)" → tick ONLY the
  `gist` scope. Paste it on each device once. The app finds/creates one private
  gist ("act-from-here-data") and every change lands there within seconds.
- **Anthropic API key** → powers the AI paste-dump sorter. Get one at
  console.anthropic.com. Without it, Sort It gracefully dumps lines into your
  last section unsorted — nothing is ever lost.
- Keys live only in that device's localStorage. Never commit them anywhere.

## How your data survives (three layers)
1. **localStorage** — instant, offline, per device.
2. **Private gist** — pushed ~2.5s after each change; a blank/wiped/new device
   with your token pulls the newest copy before first render.
3. **Export** — download a JSON backup anytime; Import restores it.

Honest caveats: sync is last-write-wins by timestamp (fine for one person using
one device at a time; simultaneous offline edits on two devices → newer wins).
Without a token, each device is its own island. Safari *browser tabs* (not the
installed app) can purge storage after 7 days unused — the gist makes that a
non-event.

## Rebuilding from source (only if the app changes)
Source in `src/`. Requires node:
```
npm i react react-dom
npx tailwindcss@3.4.14 -c tailwind.config.js -i tw-in.css -o styles.css --minify
npx esbuild src/pages-main.jsx --bundle --jsx=automatic \
  --define:process.env.NODE_ENV='"production"' --minify --format=iife --outfile=app.js
```
(`tailwind.config.js`: content = ["./src/*.jsx"]. `tw-in.css`: `@tailwind base; @tailwind utilities;`)
