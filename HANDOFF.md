# AFH2 — Handoff

Read this first in a fresh session. It says what exists, how it fits together, what must not be broken, and what is still open. Written 2026-09-19 after the initial build (2026-09-14); status refreshed 2026-10-03. `CLAUDE.md` holds the rules for touching the live data.

## 1. Status at a glance

| | |
|---|---|
| Live | https://evanmydude.github.io/AFH2/ (GitHub Pages, deploy-from-branch, `main`, folder `/`) |
| Repo | https://github.com/EvanMyDude/AFH2 — local checkout `~/Desktop/AFH2`, branch `main` |
| Predecessor | https://github.com/EvanMyDude/ActFromHere → https://evanmydude.github.io/ActFromHere/ (untouched, still live) |
| Shipped | PR #1 (feature + review fixes, with walkthrough GIF), PR #2 (legacy-import self-heal). Both merged. |
| Tests | `npm test` → 26 passing (`node:test`, no browser) |
| Build | `app.js` and `styles.css` are **committed build outputs**; the live bundle hash was verified equal to the local build |
| Verified | Migration from the old app's data, all subsection flows, reordering, corrupt-data guard, Esc/collapse form semantics — in headless Chromium against fixtures. Live site loads clean with CSP. |
| Data | **Migrated and live.** Per the owner (2026-10-03), the real items live in AFH2 on desktop and iPhone and sync through the private `afh2-data` gist. See §8. Every change must load over that data as a no-op (§6, `CLAUDE.md`). |
| Not verified by an assistant | Two-device gist adoption against the real gist (needs the owner's token; exercised only against a stubbed gist); iPhone hover/touch behavior on a real device. |

## 2. What was built

Act From Here 2 is the original single-page React PWA (paste-dump sorter + sections of checklist items, localStorage + optional private-gist sync) plus:

- **Subsections** inside every section. `＋ subsection` on the section header (revealed on hover with a fine pointer, always visible at 70% on touch). Each group: chevron header with open count, smooth grid-rows collapse (never unmounts, `inert` when closed), its own `＋ add item`, `✎` rename, `🗑` delete (items fall back to the section). Items move between sections *and* subsections from the item menu's select (`section/subKey` values).
- **Section ordering** via ▲ ▼ in the existing ⚙ sections manager.
- **Big Ticket seed**: 74 items from `big ticket.pdf` with stable ids (`bt-001…`) into subsections BIG TICKET (THIS WEEK, DECISIONS, KEEPERS), SYSTEMS / IDEAS WORTH A REAL LOOK / BODY / PEOPLE (CIRCLE BACK), NORTH STAR (KEEPERS), and a new top-level **THIS MONTH** section. Applied once on top of existing data; deletions stick. "EVERYTHING ELSE" intentionally omitted. No invented links.
- **Hardening**: separate storage keys and gist from the old app, lossless sanitizing migration, single writer for the persisted form, corrupt-data guard, timestamp clamp, validated remote adoption, freeze flag around reload-after-adopt, synchronous flush before hide/adoption, serialized push/adopt, gist reconciliation and pagination, URL allow-list, CSP, scope-limited service worker.

Depth: `docs/plans/2026-09-14-feat-afh2-subsections-big-ticket-plan.md` (design + every decision and its reason), `todos/` (ten review findings, all resolved, each with the reasoning), PR #1 description.

## 3. Code map

```
AFH2/
  index.html              shell; CSP meta; no inline scripts (SW is registered from app.js)
  manifest.webmanifest    id "/AFH2/", name "Act From Here 2", short_name "AFH2"
  sw.js                   stale-while-revalidate shell cache "afh2-shell-v1"; purges only afh2-shell-* keys;
                          handles only GETs inside its own scope (/AFH2/)
  tailwind.config.js      content ./src/*.{jsx,js}; future.hoverOnlyWhenSupported = true
  tw-in.css               @tailwind base/utilities
  styles.css, app.js      BUILD OUTPUTS — regenerate with `npm run build`, commit them
  package.json            "type": "module"; pinned react 19.3, react-dom 19.3, esbuild 0.28, tailwindcss 3.4.19
  src/
    model.js              PURE STATE MODEL, no React. The only place that knows the persisted shape.
    seed-big-ticket.js    Big Ticket manifest (BIG_TICKET) + applySeed(state) (idempotent)
    act-from-here.jsx     the UI component (≈1200 lines)
    pages-main.jsx        storage adapter, gist sync, import/export, first boot, SyncPanel, boot()
  test/
    model.test.js         migrate/serialize/seed/catchAllKey/safeHref/clampSavedAt/looksLikeState
    seed.test.js          manifest sanity + applySeed idempotency / deletions / missing section / round-trip
  docs/plans/             the design plan (living document; checkboxes reflect verified ACs)
  docs/screenshots/       full-page + viewport shots, walkthrough frames, afh2-walkthrough.gif
  todos/                  review findings 001–010, all `complete`
  README.md               user-facing: features, migration runbook (historical), sync/keys, rebuild
  CLAUDE.md               rules for changes that load over the live data (points here)
```

### `src/model.js` — exports and roles
- `migrate(raw)` → v4 state. Accepts v1 (flat buckets), v2 (`items` only), v3 (`sections` array), v4. **Lossless and strict**: orphan item buckets become sections (capped at `MAX_SECTIONS + 1`, overflow folds into the catch-all), blank glyph → `•`, keys must match `KEY_RE` and not be `Object.prototype` names (else remapped, items kept), fields coerced to strings and length-capped, ids regenerated if missing/duplicate, `sub` dropped if it references no live subsection, stale `collapsed` keys pruned.
- `serialize(state)` → the persisted string. **The only writer.** Strips the cosmetic `fresh` flag, fixes field order, omits falsy `collapsed`.
- `seed()` → default first-load content (the original ACT-FROM-HERE.md items), already v4.
- `catchAllKey(sections)` → `"note"` if present, else the last key (sorter fallback; independent of ordering).
- `safeHref(url)` → the url only for `http:`/`https:`/`mailto:` (parsed with `new URL`, so `java\tscript:` etc. fail), else `null` → rendered as "link blocked".
- `clampSavedAt(x)` → safe non-negative integer ≤ now + 24 h, else `null`.
- `looksLikeState(x)` → shape gate for anything from the network or a file (migrate would otherwise turn `{}` into a valid empty state and wipe real data).
- `DEFAULT_SECTIONS`, `SECTION_META` (labels/hints incl. `month`), `SORT_HINTS`, `MAX_SECTIONS = 10`, `uid`, `has`, `firstGrapheme`, `STORE_KEY = "afh2-v1"`, `CORRUPT_KEY`.

### `src/seed-big-ticket.js`
`BIG_TICKET.items[]` (`id, sec, sub, text, next?, url?`) and `BIG_TICKET.subs[]` (stable sub keys `bt-week`, `bt-decision`, `cb-systems`, `cb-ideas`, `cb-body`, `cb-people`, `ns-note`, `bt-note`). `applySeed(st)`: no-op if `st.seeded` includes `"bigTicket"`; else ensures target sections (inserts `month` after `week`), creates missing subs, appends items whose id is absent, sets the flag. Pure; returns a new state.

### `src/act-from-here.jsx` — how the component is organized
- **State discipline (unchanged from the original):** `latest` ref is the source of truth; every mutation reads `cur()` and calls `persist(next)` (sets ref + React state + debounced save). `setLocal` is for cosmetic-only changes (no write).
- **Save path:** `scheduleSave` (400 ms debounce) → `flush()` → `window.storage.set(STORE_KEY, serialize(latest))` with 3 retries. Load: `storage.get` → `JSON.parse` → `migrate`; if the canonical string differs from what was stored, it is re-written with `{ touch: false }` (no timestamp bump).
- **Transient form state** (`editing`, `editingCat`, `editingGlyph`, `editingSub`, `addingItem`, `addingSub`) is mirrored in refs (`editingRef`, … `addingSubRef`) that are cleared synchronously in every close path. Commit functions bail when the ref is null. This exists because Chrome fires `blur` on an input removed while focused and React dispatches that stale handler; without the guards Esc could still commit and Enter could double-add. **Keep the pattern when adding any new inline form.**
- **Collapsing = tapping away:** `clearTransient(secKey, subKey)` commits (never discards) forms inside the collapsing scope, then the toggle reads `cur()` *after* those commits.
- **`afh:flush` listener** (registered once, calls `onFlushRef`): commits every open form, cancels the debounce, and writes directly through `storage.set` if the serialized state differs from what is stored. The sync layer dispatches this event synchronously before reading meta on hide/pagehide and before any adoption.
- **`<Collapsible open>`**: `grid` + `grid-template-rows 0fr↔1fr` transition, inner `min-h-0 overflow-clip [contain:layout]` with `inert={!open}`. Used for sections and subsections.
- **Rendering per section:** ungrouped items (no `sub`, or a dangling `sub`) render first, exactly like the original app, then each subsection group in `subs` order. `renderItem` and `renderQuickAdd` are shared by both.
- Subsection header uses one delegated `onClick` with `data-act` (`rename`/`delete`/`noop`), so inner buttons need no `stopPropagation`. No dblclick on group headers (deliberate).
- Hover reveal classes: `REVEAL_SEC` (section-level `group`) and `REVEAL_SUB` (`group/sub` named group). The hide rule uses `[@media(hover:hover)_and_(pointer:fine)]` to match what Tailwind's `hoverOnlyWhenSupported` emits.
- Sorter: raw `fetch` to the Anthropic Messages API, model `claude-sonnet-5`, bucket labels JSON-quoted, response capped at 500 items, fallback dumps lines into `catchAllKey`.
- **PASTE DUMP draft:** every change to the box goes through `changeDump`, which mirrors it to the local-only key `afh2-dump-draft` (removed when the box is empty); `dump` state is initialized from it, so pasted text survives the app being killed in the background or an adoption reload. Nothing writes the key on load. A finished sort (success or fallback) calls `consumeDump(sent)`, which clears only the text it sorted: anything typed into the box during "Sorting…" stays (`dumpRef` holds the live value).

### `src/pages-main.jsx` — storage, sync, boot
- **Keys:** `afh2-v1` (data), `afh2-meta` (`{savedAt, pushedAt}`), `afh2-gist-id`, `afh2-conflict-backup`, `afh2-corrupt-backup`. Gist description `afh2-data`, file `afh2.json`. Credentials are **shared with the old app on purpose**: `afh-gh-token`, `afh-anthropic-key`. The old app's `afh-v1`/`afh-meta` are read once, never written. The component separately owns the local-only `afh2-dump-draft` (never synced; invariant 12).
- **`window.storage` adapter:** async get/set over localStorage. `set(key, value, opts)`: the write that *creates* `afh2-v1` gets watermark 1 (never pushed, always loses); later writes stamp `now()` and schedule a push; `opts.touch === false` writes bytes only. `storage.frozen = true` turns `set` into a no-op — set right before `location.reload()` after an adoption or import so nothing can write the pre-adoption state over the adopted blob.
- **Sync engine:** `serial(fn)` chains every gist operation on `sync.op`, so pushes and adoptions never interleave. `pushToGist` skips when nothing is stranded (`savedAt <= pushedAt`), refuses bodies > 900 KB, retries once after clearing a cached gist id on 404. `pullFromGist` (4 s timeout) clamps `savedAt`, detects truncated gist content. `adoptRemoteIfNewer`: pull → **`flushApp()` after the pull** → compare meta → `looksLikeState` → `migrate`+`serialize` → if identical only align meta; else stash local (when it had unpushed edits and differs) → write → return true. Callers that reload use `adoptAndReload` (sets `frozen`). `findOrCreateGist` paginates (10 pages), throws on any non-OK list (never creates a duplicate on 403/5xx), and reconciles after create (keeps the oldest gist with that description, deletes only the one it just made).
- **`firstBoot(mount)`** runs when `afh2-v1` is missing **or** when AFH2 still holds the untouched default seed (`isUntouchedDefault()`: meta 1/1) and `afh-v1` exists. Order: with a token, check the AFH2 gist first (adopt if real; stash local legacy copy as `source: "legacy"`); on a network failure show a retry/continue screen; then if `afh-v1` exists → `migrate` → `applySeed` → write with `savedAt = max(legacyMeta.savedAt, 1), pushedAt = 0` (carried-forward timestamp; the boot stranded-check pushes it once); else default seed with watermark 1.
- **`boot()`**: adapter, Anthropic shim (matches only `https://api.anthropic.com/v1/messages`, raises `max_tokens` to 4000), SW registration, `firstBoot`, startup adoption, stranded push, `visibilitychange`/`pagehide` handlers (each dispatches `afh:flush` first), render.
- **`importBackup(text)`**: accepts a full backup `{data}` from either app or a raw state, `looksLikeState` → `migrate` → `applySeed` → write → freeze → meta `{now, 0}`; caller reloads. `exportBackup` → `afh2-backup-YYYYMMDD.json` (data only, never keys).
- **`SyncPanel`**: keys, export/import/pull, status dot, conflict banner (labels `legacy` / `legacy-unreadable` / `afh2-local`), "had Act From Here data?" hint when the state is the untouched default and no `afh-v1` exists.

## 4. Data model v4 (persisted string, produced only by `serialize`)

```js
{ v: 4,
  sections: [{ key, glyph, subs: [{ key, name, collapsed?: true }] }],   // array order = display order
  items:    { [secKey]: [{ id, text, done, url?, next?, sub? }] },        // flat; sub → subs[].key
  labels:   { [secKey]: name },                                           // only overrides of SECTION_META labels
  collapsed:{ [secKey]: true },                                           // sections only
  seeded:   ["bigTicket"] }
```
Watermark rules (`afh2-meta`): `savedAt = 1` means "untouched default seed" (never outranks anything, never pushed); a legacy import carries the old app's timestamp forward with `pushedAt = 0`; only a real user edit stamps `now()`. Last-write-wins by `savedAt` across devices; the loser of an adoption is stashed under `afh2-conflict-backup` when it held unpushed edits.

## 5. Invariants — do not break

1. `serialize()` is the only producer of the persisted string. Never hand-build the object elsewhere (the original app's allowlist in `flush` is what silently dropped fields).
2. `migrate()` never drops an item. New fields → add to both `migrate` and `serialize`, and to the round-trip tests.
3. Seed only when the adapter says "key not found". A parse failure stashes to `afh2-corrupt-backup`, renders the error screen, and **does not write**.
4. Never stamp a fresh timestamp unless the user edited: canonical rewrites use `{ touch: false }`.
5. Any code path that writes `afh2-v1` behind the component's back and then reloads must set `window.storage.frozen = true` **after** the write landed and before `location.reload()`.
6. Dispatch `afh:flush` before reading meta on hide/pagehide and before any adoption; keep the component's flush path synchronous up to `localStorage.setItem`.
7. Every gist read/write goes through `serial()`.
8. Never write `afh-*` data keys (old app). Sharing the two credential keys is intentional.
9. `href` only via `safeHref`. CSP is `script-src 'self'`: no inline `<script>`, no inline event handler attributes, no `eval`. React `style={}` props are fine (`style-src 'unsafe-inline'`).
10. Every inline form gets a ref mirror cleared synchronously on close; commit functions check the ref first.
11. Subsection/section keys come from `uid()` prefixed (`s…`, `u…`, or the stable seed keys); keys must satisfy `KEY_RE` and never be `Object.prototype` names.
12. Local-only UI keys (`afh2-dump-draft`) live outside `afh2-v1`: written only on user input, never on load, never synced, never exported, never read by the sync engine. Anything that must sync goes through `migrate`/`serialize` and needs the owner's OK (`CLAUDE.md`).

## 6. Dev loop

```bash
cd ~/Desktop/AFH2
npm ci                 # exact versions from package-lock.json
npm test               # node:test, ~50 ms
npm run build          # tailwind → styles.css, esbuild → app.js  (COMMIT BOTH)
npm run serve          # python http.server on http://127.0.0.1:8787
```
- Adding a Tailwind class in JSX requires `npm run build` — `styles.css` is purged to what `src/*.{jsx,js}` uses.
- The service worker is stale-while-revalidate: a change lands on the **second** load. When testing, unregister it (DevTools → Application, or `navigator.serviceWorker.getRegistrations()` → `unregister()`) and add a cache-busting query.
- **Legacy-import fixture trick (browser):** on the loaded page run `window.storage.frozen = true` (so the page-hide flush can't recreate `afh2-v1` on navigation), remove the `afh2-*` keys, set `afh-v1` to a v3 payload and `afh-meta` to `{savedAt, pushedAt}`, reload. Check `afh2-v1`, `afh2-meta`, and that `afh-v1` is byte-identical.
- Playwright MCP works well for this (attribute selectors like `button[aria-label="add subsection to THIS MONTH"]`, `[role="button"][aria-label="collapse WEEK 1"]`, `select[aria-label="move to"]`, `button[aria-label="move THIS MONTH down"]`). Screenshots resolve relative to Playwright's own cwd. `agent-browser` (via `npx -y agent-browser`) was unreliable here: its `eval` and `screenshot` targeted different tabs and it lacks `:has-text()`.
- ffmpeg on this machine is broken (missing Homebrew libvpx); the walkthrough GIF was made with Pillow (`python3`, `PIL` 12).
- **No-op upgrade test (required for every change, see `CLAUDE.md`).** A scratch Playwright script outside the repo: serve the `main` build at a `/AFH2/` path with the service worker enabled, seed `afh2-v1` with a canonical fixture (`serialize(applySeed(seed()))`, plus a variant with done items, a collapsed section and subsection, a label override, a link and a next step) and `afh2-meta` `{savedAt: T, pushedAt: T}`; with and without a fake token whose stubbed gist holds the same `savedAt`. Load once, then swap the served files to the branch build and load twice (the first load is the SW-cached old bundle), idling past the 2.5 s push debounce and firing `visibilitychange`→hidden and `pagehide` each time, at 390×844 touch and 1280×900 mouse. Pass = `afh2-v1` and `afh2-meta` byte-identical, no new localStorage keys, no POST/PATCH to `api.github.com`, no `api.anthropic.com` call, no page errors, and a check that the new bundle actually ran. Route `https://api.github.com/**` and `https://api.anthropic.com/**` in every browser test; never use a real token.
- Git identity for this repo's commits: `EvanMyDude <evaneskimo@gmail.com>` (passed with `-c`; the global config is a different identity).

## 7. Deploy

Merge to `main` → GitHub Pages builds automatically (legacy build, `.nojekyll` present).
```bash
gh api repos/EvanMyDude/AFH2/pages/builds/latest --jq '{status, error: .error.message}'
shasum -a 256 app.js; curl -s "https://evanmydude.github.io/AFH2/app.js?x=$(date +%s)" | shasum -a 256   # must match
```
Nothing else to configure. Rollback = revert on `main`.

## 8. Migration of the user's real data: done

The owner moved their real items into AFH2 after 2026-09-19 (reported 2026-10-03; an assistant did not observe the steps). They now live in each device's `afh2-v1`/`afh2-meta` and in the private `afh2-data` gist, which keeps every device in sync. The owner also holds a recent export as a last resort; it is not in this repo and must never be committed (`CLAUDE.md`).

What this changes for future work: the legacy-import paths in `firstBoot` (§3) still exist but only fire on a device whose AFH2 storage is missing or holds the untouched default seed, which no longer describes the owner's devices. The README's "Migrating from the original app" runbook is historical. The risk that matters now is a new build changing existing data when it loads; see the no-op upgrade test in §6.

## 9. Known limits and deferred ideas

- Sync is last-write-wins on wall-clock timestamps; a device with a clock > 24 h fast is refused by others (`clampSavedAt`).
- **Last-write-wins can drop an edit with no backup (confirmed 2026-10-03, headless Chromium, two contexts, stubbed gist).** `pushNow` PATCHes without reading the remote first. Repro: a desktop tab stays visible (no `visibilitychange`, so no pull); the phone adds item X and pushes; the desktop then makes any edit (checking an item off; by the code, collapsing a section also counts) and pushes its older state; the phone reopens and adopts it. X is gone on both devices and from the gist head, and neither device stashes anything (the phone had already pushed). Other routes to the same result: edits on both devices between syncs (e.g. phone offline), and the return-to-visible path pushing local edits blind (`pages-main.jsx` visibilitychange handler). GitHub keeps gist revisions, so the gist history is the only remaining copy. A proposed fix (pull-before-push plus a three-way merge against a local-only base snapshot) needs the owner's OK because it changes the sync engine.
- Open findings, not fixed (2026-10-03): the conflict backup is a single slot (`afh2-conflict-backup`), so a second conflict silently replaces an unrecovered first one; Sort It's `fetch` has no timeout; `SyncPanel`'s `msgTimer` is recreated every render so old message timers cannot be cancelled; `storage.set` returns success while `frozen`; gist reads do not set `cache: "no-store"` (whether GitHub's API responses are browser-cacheable for 60 s was not verified); `tmp/screenshots/` holds 10 committed PNGs that are only 2 distinct images; `npm audit` reports 5 high findings in Tailwind's build-time dependency chain (`braces`/`micromatch`), not in the shipped bundle.
- Gist content > 1 MB is refused (push) / detected (pull) — export a backup and clear done items.
- Every Pages site on this GitHub account shares the origin and can read the two stored keys (documented in README). Not fixable in-app.
- Deferred by design (see plan D9): subsection ▲/▼ reordering, sorter routing into subsections, a subsection list inside the ⚙ manager, dblclick rename on group headers, multi-slot conflict backup.
- Cheap cleanups noted by the simplicity review and not done: duplicated palette objects (`C` in the component, `P` in pages-main), repeated `Enter/Escape` onKeyDown handlers, the 3-attempt retry around a synchronous `localStorage.setItem`, `window.storage.delete/list` unused.
- Old app's own service worker, if it ever updates, still purges every cache except its own (including `afh2-shell-v1`); AFH2 refills on its next online load. Harmless.

## 10. Pointers

- Plan (design + rationale): `docs/plans/2026-09-14-feat-afh2-subsections-big-ticket-plan.md`
- Review findings and how each was fixed: `todos/001…010-complete-*.md`
- PRs: https://github.com/EvanMyDude/AFH2/pull/1 (feature, review fixes, walkthrough GIF), https://github.com/EvanMyDude/AFH2/pull/2 (self-heal)
- Walkthrough: `docs/screenshots/afh2-walkthrough.gif` (frames in `docs/screenshots/walkthrough/`)
- Source PDF for the seed: was `~/Desktop/big ticket.pdf` on 2026-09-14 (no longer at that path on 2026-09-19); its content is fully transcribed in `src/seed-big-ticket.js`
- Claude memory note for this project: `afh2-project` (in the user's Claude memory directory)
