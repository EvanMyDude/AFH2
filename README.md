# Act From Here 2 — self-hosted

The second edition of Act From Here, packaged for GitHub Pages. Same small surface,
plus **subsections** inside every section, **section ordering** from the ⚙ manager,
and a hardened storage/sync layer. `app.js` bundles the React component with a
localStorage adapter, optional GitHub-Gist sync, an Anthropic API shim for Sort It,
and export/import backups.

Live: https://evanmydude.github.io/AFH2/

## What's new in 2

- **Subsections.** Hover a section header (always visible on touch) → **＋ subsection**.
  Each subsection collapses smoothly, has its own **＋ add item**, and can be renamed (✎)
  or deleted (🗑 — its items move back to the section, nothing is lost). Move items
  between sections *and* subsections from an item's menu.
- **Order the page.** ⚙ sections → ▲ ▼ per row.
- **Big Ticket seeded once.** The items from *DROP ZONE — Big Ticket* land in
  BIG TICKET / SYSTEMS / IDEAS WORTH A REAL LOOK / BODY / PEOPLE / NORTH STAR
  subsections and a new THIS MONTH section, on top of whatever you already had.
  Delete any of them and they stay deleted.

## Migrating from the original app (read this once)

AFH2 stores its data under its own keys (`afh2-*`) and its own private gist
(`afh2-data`). It never writes to the old app's data or gist.

**Where is your data right now?** Almost certainly on the iPhone (the installed
Act From Here app has its own isolated storage) and, if you ever pasted a GitHub
token there, in the old app's gist. A desktop browser that never ran the old app
has nothing to migrate and AFH2 will simply start with its defaults there.

Pick the path that matches:

- **Old app has a GitHub token (phone syncs to a gist):** on the desktop, open
  https://evanmydude.github.io/ActFromHere/ once, paste the same token into its ⇄
  panel → it pulls your data. Then open https://evanmydude.github.io/AFH2/ on the
  same desktop → AFH2 imports it, seeds Big Ticket, and (with the token) pushes to
  the new gist. It does this even if you already visited AFH2 there, as long as
  you haven't edited anything in it yet. On the iPhone, add AFH2 to the Home
  Screen, open ⇄, paste the token → it adopts what the desktop pushed.
- **No token (phone only):** in the old app on the phone, ⇄ → **export** (saves a
  JSON file to Files). Add AFH2 to the Home Screen, open ⇄ → **import** that file.
  Done — Big Ticket is seeded on import. Optionally paste a token afterwards for
  cross-device sync.
- **Desktop browser that already has the old app's data:** just open AFH2 there.

The original app keeps working untouched. Just stop using it once you've moved.

## Deploy (one time)

Repo → Settings → Pages → Source: **Deploy from a branch** → Branch **main**, folder **/ (root)**.
Or: `gh api -X POST repos/EvanMyDude/AFH2/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/'`

## Phone

Open the URL in Safari → Share → **Add to Home Screen**. Standalone app, offline
support, and installed web apps are exempt from Safari's 7-day storage purge.

## Sync + Sort It (the ⇄ button, bottom-right)

- **GitHub token** → cross-device sync + off-device backup. Create at
  github.com/settings/tokens → "Generate new token (classic)" → tick ONLY the
  `gist` scope. Paste it on each device once. AFH2 finds/creates one private
  gist ("afh2-data") and every change lands there within seconds.
- **Anthropic API key** → powers the AI paste-dump sorter. Without it, Sort It
  gracefully dumps lines into KEEPERS unsorted — nothing is ever lost.
- Keys live only in that device's localStorage. Never commit them anywhere.

**Blast radius, honestly:** every GitHub Pages site under this account shares one
origin, so any page you publish here could read these keys. Don't host untrusted
pages on this account. A classic `gist`-scope token can read/write every gist on
the account. Put a spend limit on the Anthropic key.

## How your data survives (three layers)

1. **localStorage** — instant, offline, per device.
2. **Private gist** — pushed ~2.5s after each change (and immediately when the app
   is backgrounded); a blank/new device with your token pulls the newest copy
   before first render.
3. **Export** — download a JSON backup anytime; Import restores it.

Sync is last-write-wins by timestamp. When a device's unsynced edits lose, they
are stashed (⇄ shows "download backup") — never silently dropped. Corrupt saved
data is stashed and shown, never overwritten. Remote data is validated before it
is adopted. Timestamps from the network are sanity-clamped.

## Rebuilding from source

```
npm ci
npm test          # node:test — model, migration, seed idempotency
npm run build     # tailwind → styles.css, esbuild → app.js (both committed)
npm run serve     # http://127.0.0.1:8787
```

`src/model.js` is the pure state model (migrate/serialize/seed, no React).
`src/seed-big-ticket.js` is the one-time content. `src/act-from-here.jsx` is the UI.
`src/pages-main.jsx` is storage, sync, import/export and boot.
