---
title: "feat: AFH2 — subsections, Big Ticket seed, section reordering, hardening, GitHub Pages launch"
type: feat
status: active
date: 2026-09-14
---

# feat: AFH2 — subsections, Big Ticket seed, section reordering, hardening, launch

## Context

**Act From Here** (`github.com/EvanMyDude/ActFromHere`, live at `evanmydude.github.io/ActFromHere/`) is a single-file React PWA: a paste-dump sorter plus sections of checklist items, persisted to `localStorage` (`afh-v1`) and optionally mirrored to a private GitHub gist. Source is two JSX files (`src/act-from-here.jsx` ~986 lines, `src/pages-main.jsx` ~400 lines) bundled with esbuild into a committed `app.js`; there is no package.json and no tests.

The user wants a **second app, AFH2** (`github.com/EvanMyDude/AFH2`, currently an empty repo; Pages not yet enabled) that:

1. Keeps every existing item, link, next step and section heading.
2. Adds **subsections** inside sections: named, collapsible groups with smooth open/close, and an "add subsection" control that appears on hover within each section.
3. Seeds the items from **`/Users/evanestes/Desktop/big ticket.pdf`** into the right subsections (CIRCLE BACK gets SYSTEMS / IDEAS WORTH A REAL LOOK / BODY / PEOPLE; the rest of the PDF is mapped below). The PDF's "EVERYTHING ELSE" block is ignored.
4. Makes **section order editable** from the existing "⚙ sections" manager at the bottom of the page.
5. Gets a **hardening pass** across the whole app.
6. Is **launched to GitHub Pages** from the AFH2 repo.

### Two facts that shape the design

- **The user's real data is not in the repo.** It lives in browser `localStorage` and the gist. "Preserve all data" therefore means: migrate the live data forward, don't just copy the seed.
- **Both apps share one origin** (`evanmydude.github.io`), so they share `localStorage`. AFH2 can read the old app's `afh-v1` key on first boot and adopt it. It must write to **its own keys**, otherwise the old app (whose `migrate` strips unknown fields) would destroy subsection data on its next save.

## Decisions made (override at approval if wrong)

| # | Decision | Why |
|---|---|---|
| D1 | PDF → app mapping (full table in "Seed dataset" below). THIS WEEK / DECISIONS / KEEPERS items land in a **"BIG TICKET"** subsection of the matching existing section; CIRCLE BACK gets the PDF's own four subsections; NORTH STAR becomes a subsection of KEEPERS (no checkboxes fits mantras); **THIS MONTH becomes a new top-level section** inserted after THIS WEEK. | Matches the PDF's own structure; keeps seeded content visually distinct from what's already there; demonstrates both new features. |
| D2 | Seeding is a **one-time content migration** applied on top of the user's live data, guarded by a flag and deduplicated by normalized text. | The user asked for the PDF content *added to* the current data. |
| D3 | Next steps come from the PDF's own trailing sentences; links only where a real URL exists (the YouTube Watch Later item gets `https://www.youtube.com/playlist?list=WL`). **No fabricated links.** | Honesty over decoration. |
| D4 | Reordering uses **▲/▼ buttons** per row in the section manager, not drag-and-drop. | Primary device is iPhone Safari; DnD on iOS is unreliable and heavy. |
| D5 | Sorter model bumped from `claude-sonnet-4-6` to `claude-sonnet-5` (same tier the app already targets, current generation). Raw `fetch` stays (browser BYO-key pattern). | Current-generation ID; no SDK in a static page. |
| D6 | Build outputs (`app.js`, `styles.css`) stay committed; Pages deploys from `main` root, same as ActFromHere. A `package.json` with pinned deps and `build`/`test` scripts is added so the build is reproducible. | Zero-infra deploy; matches the existing README workflow. |
| D7 | Git flow: initial commit on `main` = verbatim ActFromHere copy (the "duplicate"); all changes on branch `feat/subsections-big-ticket` → PR → merge → Pages. | Gives the downstream pipeline (review, browser test, feature video) a real PR diff. |
| D8 | Subsection collapse state is persisted and synced (same as sections), stored on the sub object. Subsection delete never blocks: items fall back to ungrouped. The old ActFromHere app is left **untouched** (no banner, no read-only mode). | Consistent with existing behavior; no data-loss paths; the user didn't ask to change the old app. |
| D9 | **Cut as over-engineering:** subsection ▲/▼ reordering, sorter routing into subsections, a subsection list inside the ⚙ manager (rename/delete live on the group header instead). | Not requested; each adds surface without serving the ask. Easy to add later. |

## Proposed solution

### Architecture

```
AFH2/
  index.html, manifest.webmanifest, sw.js, icons   (copied; titles/cache names updated)
  src/
    model.js          NEW — pure state logic, no React. Tested with node:test.
    seed-big-ticket.js NEW — the PDF dataset + applySeed() (idempotent)
    act-from-here.jsx  MODIFIED — UI; imports model.js; subsection rendering
    pages-main.jsx     MODIFIED — new storage keys, legacy import, gist desc
  test/model.test.js   NEW
  package.json         NEW (react, react-dom, esbuild, tailwindcss pinned; scripts: build, test)
  app.js, styles.css   REBUILT
  README.md            UPDATED for AFH2
```

### Data model v4 (`src/model.js`)

```js
// v4 = v3 + version field + subsections + seed marker
{
  v: 4,                                                     // migrate branches on this; absent = ≤3
  sections: [{ key, glyph, subs: [{ key, name, collapsed?: true }] }],  // array order = display order
  items:    { [secKey]: [{ id, text, done, url?, next?, sub? }] },       // sub = subs[].key (flat, never nested)
  labels:   { [secKey]: name },
  collapsed:{ [secKey]: bool },                             // sections only; sub collapse lives on the sub object (self-cleaning)
  seeded:   ["bigTicket"]
}
```

- Items with no `sub`, or a `sub` that no longer exists, render **ungrouped at the top** of the section (exactly today's look). Subsections render below, in `subs` order.
- `migrate(raw)` handles v1 → v4 and is **lossless**: item buckets whose section key is missing from `sections` get a section re-created (current `migrate` at `act-from-here.jsx:62-72` silently drops them); sections with an empty/non-string glyph get `"•"` instead of being filtered out with their items (`:64`); stale `collapsed` keys are pruned.
- `serialize(state)` is the single place that strips `fresh` and emits the persisted shape. **`flush()` is rewritten to call it** (the hand-rolled `clean` allowlist at `act-from-here.jsx:203-209` would silently drop `v`, `subs`, `seeded` on every write).
- Pure ops exported and unit-tested: `addSubsection`, `renameSubsection`, `deleteSubsection` (strips `sub` from its items → ungrouped), `moveItem(fromSec, id, toSec, toSub|null)`, `moveSection(key, ±1)`, `toggleSection`, `toggleSub`, `deleteSection`, `catchAllKey` (`note` if present, else last), `isBlockedUrl`, `normalizeUrl`.
- `model.js` and `seed-big-ticket.js` are ES modules (`package.json` gets `"type": "module"`); esbuild bundles them unchanged.

### Storage & legacy import (`src/pages-main.jsx`)

| Key | Old app | AFH2 |
|---|---|---|
| data | `afh-v1` | `afh2-v1` |
| meta | `afh-meta` | `afh2-meta` |
| gist id / conflict | `afh-gist-id`, `afh-conflict-backup` | `afh2-gist-id`, `afh2-conflict-backup` |
| gist description / file | `act-from-here-data` / `actfromhere.json` | `afh2-data` / `afh2.json` |
| legacy-import marker | — | `afh2-legacy` (`"done"` once a legacy source was adopted) |
| Anthropic key, GitHub token | `afh-anthropic-key`, `afh-gh-token` | **same keys, read as bootstrap default** (present on desktop Chrome, same origin); AFH2 also writes them under the same names |

**Caveat that shapes this (from flow analysis): iOS gives every home-screen web app its own storage partition.** The installed AFH2 PWA on the iPhone will very likely see *no* `afh-v1` and *no* token. So legacy import cannot be a one-shot at first boot; it must be re-attemptable whenever a token appears.

`importLegacy()` — runs (a) in `boot()` **before** `adoptRemoteIfNewer` (so the carried-forward timestamp takes part in the adoption comparison), and (b) inside `saveKeys()` right after a GitHub token is first saved. Guarded only by `afh2-v1 === null` in (a); in (b) also by `afh2-legacy !== "done"` and the AFH2 gist holding no real data.
1. Candidates: local `afh-v1` (with `afh-meta.savedAt`) and, **whenever a token exists**, the legacy gist `act-from-here-data` (4 s timeout; failure → local only). Local may be stale relative to the gist (phone edited Monday, desktop last opened Sunday), so both are always considered. Pick the newer by `savedAt`; stash the other under the conflict key with a `source` label. Nothing is ever deleted from the old app's keys or gist.
2. `migrate` → `applySeed` → write the **final v4** via `serialize` (so the component's load finds nothing to re-save) → `afh2-meta = { savedAt: max(legacy.savedAt, 1), pushedAt: 0 }` → mark `afh2-legacy = done`. The existing "stranded edits" check in `boot()` (`pages-main.jsx:368-369`) then pushes it on that same boot. **The timestamp is carried forward, not stamped `now()`**: stamping `now()` would let a stale Sunday snapshot outrank a phone's Monday edits during adoption.
3. In path (b), if the current AFH2 state was already edited (`savedAt > 1`), stash it to the conflict key before replacing; if it's the untouched default seed (`savedAt === 1`), replace silently.
4. No candidate → `seed()` defaults + `applySeed` (watermark 1, not pushed) and the SyncPanel shows: "had ActFromHere data? enter your GitHub token or import a backup to bring it over".

`pullFromGist`/`findOrCreateGist` get parameterized by `{ desc, file, idKey }` so the same code reads the legacy gist and the AFH2 gist.

Watermark rule summary: default-seed write = 1 (never outranks real data); legacy-import write = legacy timestamp with `pushedAt: 0` (pushes, never outranks newer legacy data on another device).

### Subsection UI (`src/act-from-here.jsx`)

- **Add control:** a "＋ subsection" button in the section header row. Section wrapper is a Tailwind `group`; button is `opacity-70 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`, with `future: { hoverOnlyWhenSupported: true }` in `tailwind.config.js` so iOS's sticky `:hover` never applies. Visible at 70% on touch, revealed on hover on desktop. Inline name input, Enter creates, Esc cancels (no buttons inside blur-governed forms: on iOS `relatedTarget` is null on button taps, which would double-commit). Cap 12 subsections per section (constant, button disabled at cap).
- **Group header:** chevron + name + open-count; tapping the row toggles. A small `✎` (rename → inline input, Enter/Esc) and `🗑` (inline confirm, same pattern as `pendingDelete`) sit at the row's end with the same hover/touch visibility rule as the add control. Double-click on the name also renames. `aria-expanded` set; hit targets ≥ 36 px.
- **Smooth toggle (sections and subsections, same pattern):** the body is **never unmounted**. Wrapper `grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none` with `gridTemplateRows: collapsed ? "0fr" : "1fr"`; inner `min-h-0 overflow-hidden` with `inert={collapsed}` (React 19 boolean prop) so collapsed content leaves the tab order and can't be tapped. Works with unknown heights and nested groups without JS. Because unmount no longer resets it, `toggleSection`/`toggleSub` clear `addingItem`/`editing` belonging to what just collapsed.
- **Quick add inside a subsection:** each group gets its own "＋ add item" row; `addingItem` becomes `{ sec, sub }` (one open form at a time), Enter keeps the form in the same group, the item lands at the top of that group with the `fresh` flash. Deleting the subsection while its form is open closes the form (extend the guard in `commitNewItem`).
- **Rename without double-click:** the `✎` button on the group header is the touch-friendly path (iOS double-tap-zoom can eat dblclick); dblclick is a convenience on desktop only.
- **Counts:** section "N open" includes items inside its subsections; each group header shows its own open count; KEEPERS keeps showing totals.
- **Move item:** the existing `<select>` in the item menu (`act-from-here.jsx:740-749`) becomes `<optgroup>` per section: "(ungrouped)" plus each subsection (`value="secKey/subKey"`); the item's current position is a real option so the select stays controlled. `move()`'s early return (`:270`) becomes "same section *and* same sub".
- **Delete subsection:** items fall back to ungrouped (their `sub` stripped), nothing is lost. Empty subsections delete on tap; non-empty ones confirm inline.
- **Section delete** (`doDelete`) is still blocked while the section has items (including items inside subsections); empty subsections don't block it.
- **Sorter:** unchanged routing (sections only — subsection targets deferred as over-engineering); catch-all pinned to `note`.

### Section reordering (section manager)

▲ / ▼ buttons per row (≥ 36 px hit targets, `aria-label="move X up"`, disabled at the ends). Reorder only permutes the `sections` array; everything else is keyed by `key`, so no data moves. Subsection reordering is **deferred** (creation order is enough; not requested).

### Hardening list

- `migrate` never drops item buckets (above).
- URL safety (`act-from-here.jsx:728`): **deny-list** script-capable schemes (`javascript:`, `data:`, `vbscript:`, `blob:`) — those render as plain text with a "link disabled" hint, never deleted. Everything else (including `shortcuts://`, `notes://`, `x-apple-*`) stays a link; scheme-less `a.co/x` is normalized to `https://`. Edit/quick-add forms reject a blocked scheme on commit with a toast and keep the text.
- Sorter catch-all (`act-from-here.jsx:475,496`) is positional (`sections[last]`); once sections are reorderable that would dump failed sorts into whatever is last. New rule: catch-all = `note` (KEEPERS) if present, else last.
- `move()` (`act-from-here.jsx:269-286`) early-returns on same section; moving between subsections within one section must work.
- `importBackup` (`pages-main.jsx:229-240`) accepts v1–v4, runs `migrate` before writing, stashes the current state to the conflict key before overwriting, rejects if the result has zero sections and zero items. Export filename becomes `afh2-backup-YYYYMMDD.json`.
- `MAX_SECTIONS` stays a UI cap on "add new section" only; seeding may legitimately produce 11 and the UI must still render (add button disabled).
- **Load-error path (`act-from-here.jsx:173-188`) — highest priority.** Today *any* throw (bad JSON, malformed state) falls into `catch` → `seed()` → save → and because the key already exists the adapter stamps `now()` and pushes the seed over the gist. New rule: only the adapter's explicit "key not found" seeds; a parse/migrate failure stashes the raw string to `afh2-corrupt-backup`, renders an error state with export/import, and **does not write**.
- Load re-save condition (`:181`) becomes `serialize(migrated) !== res.value` instead of shape-sniffing, so a freshly written v4 blob is never re-stamped.
- Service worker (`sw.js:11`): Cache Storage is per-origin, so `keys.filter(k => k !== CACHE)` would wipe the *other* app's shell cache. AFH2's activate handler only deletes keys that start with `afh2-shell-` (the old app's SW is untouched and only runs its own purge if it ever updates).
- `findOrCreateGist` (`pages-main.jsx:47-53`): any non-OK list response (403/5xx), not just 401, must throw; today it falls through and creates a duplicate gist, orphaning the real one.
- `adoptRemoteIfNewer` (`pages-main.jsx:124-130`) validates `remote.data` (parses, has `items`) before writing it to localStorage.
- Debounced write lost on background (`act-from-here.jsx:227-231` + `pages-main.jsx:386-393`): the component flushes on `pagehide` and `visibilitychange → hidden` (the `localStorage.setItem` inside `storage.set` is synchronous before its first `await`, so it lands).
- Conflict backup keeps the last 3 (timestamp-suffixed keys) instead of one slot.
- `index.html`: `100dvh` with `100vh` fallback; toast and sync panel offset by `env(safe-area-inset-bottom)`.
- Separate storage keys / gist description (above) so the two PWAs cannot clobber each other.
- `sw.js` cache name `afh2-shell-v1`; `manifest.webmanifest` + `apple-mobile-web-app-title` become "AFH2" so two home-screen icons are distinguishable.
- Sorter model → `claude-sonnet-5`; keep the `max_tokens` raise in the shim.
- `node:test` coverage for every pure op, migration from v1/v2/v3 fixtures, seed idempotency, dedupe, orphan-bucket recovery, `isSafeUrl`.
- No behavior change to gist sync's last-write-wins model (documented caveat stays).

## Seed dataset (`src/seed-big-ticket.js`)

`applySeed` is called from `importLegacy()` / first boot only — **not** from `migrate` — so importing an old v3 backup later does not re-seed unless the flag is absent.

Idempotency rule (per flow analysis): every seed item has a **stable id** in the checked-in manifest (`bt-001` … `bt-0NN`; two devices migrating independently produce byte-identical blobs), and the payload carries `seeded: ["bigTicket"]`.
- Flag present → `applySeed` is a no-op, regardless of which items still exist (honors deletions, survives a second device adopting an already-seeded gist).
- Flag absent → add only items whose stable id is absent **and** whose normalized text (trim, casefold, collapse whitespace, strip emoji/punctuation) is not already in the target section; then set the flag. Subsections are created by stable key (`bt-week`, `bt-decision`, `cb-systems`, `cb-ideas`, `cb-body`, `cb-people`, `ns-note`, `bt-note`) so the three "BIG TICKET" groups never collide.
- Targets are routed by section **key** (`week`, `decision`, `circleback`, `note`), never by label. If a target key was deleted by the user, the section is recreated with its default label/glyph before seeding.
- Tests: apply twice = once; apply after deleting 3 seeded items = still 3 fewer; apply to an old-app export where 5 texts already match = 5 fewer added.

**THIS WEEK → `week` › subsection "BIG TICKET"**

| text | next |
|---|---|
| Start the 10-minute body timer — every other day, in front of the mirror, no self-hate | Neal's program or the Notion body-journey page. Intent over intensity. |
| Five-minute timed prayer — no reflection back on self | "Lord I give myself to you completely." |
| Testimony × Mission: "either way, let's pray." | You flagged this THIS WEEK yourself. |
| Pick one person to reach out to and go first | Say happy birthday, check in. |
| Set the bedtime — one fixed time, phone out of the bed | "2 a.m.?" — that's the decision; see DECISIONS TO CLOSE. |
| Top 3 priorities each morning — block the day, one task at a time | |
| Nightly #zzz: what went well, what did not, what would I change | |
| Hinge: sniper mode — the roster exists | Transition fast, commit, meet in person before the shot is missed. |
| Core circuit, week 1 of 4 | Hanging leg raises · alternating side knee raises · hill climbers (3×10). Exhale hard on the crunch. |
| Send the work email after lunch | Monday, from the whiteboard. |
| Daily tongue drill: tip behind the front teeth at 1:00 | Release the mid-back tongue without jaw jutting. 60 seconds, a few times a day. |

**DECISIONS TO CLOSE → `decision` › "BIG TICKET"**

| text | next |
|---|---|
| Bedtime: what time, exactly? | |
| Cover up the tat, or not. | |
| Take Gw out of the IG bio? | With Holy Spirit as guide. |
| Accountability scoreboard: am I actually doing it? | If yes, when does it start? |
| Sorted and Gemini 2: done with them? | And is one month of Claude next quarter worth a hundo? |
| Notion PDF reading: in Notion, or CircleBack? | |
| Two jobs: keep crawling, or pivot? | Set the tripwire that tells you it's too much. |
| Hyenas: offer to work free on weekends, or not? | The real question is what you're doing with that time otherwise. (Escape room job also on the table.) |
| Which program is "THIS" (Week 1 Day 2)? | Name it and schedule day 3, or drop it. |
| Shrooms: when, and with whom? | Mr. Mendoza? |

**CIRCLE BACK → `circleback` › four subsections**

SYSTEMS

| text | next | url |
|---|---|---|
| Brave Notion migration | See Raycast notes. | |
| Clean up note tags into proper smart folders | Use collapsible headers more. | |
| Build the "notes to self / reminders / best wisdom" Notion page | Put a quarterly re-read on the calendar. | |
| Add "what cognitive bias am I unaware of right now?" to the self-check PDF prompt | Improve the prompt-engineer workflow. | |
| Sort YouTube Watch Later into playlist buckets | Split body / PRI / mobility. You marked this "not urgent." | https://www.youtube.com/playlist?list=WL |
| Cornerstone Landmark Alarms for the bedtime cut-off | | |

IDEAS WORTH A REAL LOOK

| text | next |
|---|---|
| Yelp for oil and gas title brokers | Reviews and ratings so companies know who does good work. Seed the database by scraping — Directory Bro's workflow. |
| Automated print-and-mail for mineral interest offers | Burner number tied to an AI voice-answering service. |
| Coach women a skill | Pickleball, dancing, what else? |

BODY

| text | next |
|---|---|
| Finish the body-lab rotation hypothesis: upper body wants to turn left, lower body right | Test it, don't just note it. |
| Actually learn anatomy (levator scap, supraspinatus, upper trap) | Instead of collecting cues. |
| Why were the arms so far forward at TSA? | Find the cue. |

PEOPLE

| text | next |
|---|---|
| Find mentors to actually look up to and rub elbows with | |
| Practice social stories out loud | Level up storytelling. |

**NORTH STAR → `note` (KEEPERS) › "NORTH STAR"**

| text | next |
|---|---|
| Love God. Love people. Do what's right. | Going through all of this to serve the Kingdom fruitfully, for God and his people, not only for me. Fruits, not notes. |
| Relationships are all that matters. | Be the person who makes everyone around him feel valued. Attention curved outward, not inward. |
| Identity: bold adventurer with nothing to lose. | Someone who keeps promises to himself. Not damaged goods. Every right to be here. |
| Fix the signal. | Correct the sensory input from feet, eyes, and jaw. The surgery opened the door; walk through it: better sleep, less tension, more consistency, a better speaking voice. |
| Two non-negotiables: movement every day, relationships every day. | |
| Simple = sustainable. | Small wins, small steps, start small and build to the vision. Do less; when you do something, all in. |
| Get out of the 7th and Tom Thumb routine. | Be the man it takes. Channel the rage into power. Wife fuel. |
| Less screen than sleep. | Flip the 284-vs-217 hours. |
| Long term: yoga or tai chi for clarity, climbing for adventure, small-group missions. | |

**KEEPERS → `note` › "BIG TICKET"** (22 lines from the PDF, verbatim; "Notes don't matter. Fruits do." is deduped against the existing "Notes don't matter. Fruits do 🍓")

Keep the promises you make to yourself. Failure is feedback. · Nothing great happens by accident. You have to commit. · Do less. Most things don't work. When you do something, go all in. · Lessons are not lessons if you do not use them. · If everything is important, nothing is. Knowing is not enough. Skill stack. · Open loops cost more than wrong answers. · Anxiety = lack of reps. · Learning = repeated recall, not repeated exposure. No recall, no ball. · You can't monitor yourself and be present for someone else at the same time. · Pride = attention habitually curved inwards. Ask instead: did I give one person real attention today? · The real you shows up not when the fear goes away, but when you love someone enough to forget about yourself. · People's walls come down fast when they feel seen and respected. · A lot of success is simply knowing how to ask the right way. · Stuff swells to however much time we have for it. Sleep > supplements. · Stop trying to one-shot everything. Embrace the process. This is the way. · The goal is not to fix yourself. Understand your trade-offs and put yourself in the environment that maximizes them. · Suffering is a choice. Choose your experience. · Just because I have it does not mean I have to use it. I won't have it if I abuse it. · How would someone with nothing to lose act in this very moment? · What does the world need from me right now? · What voice am I following right now?

**THIS MONTH → new section `month`** (glyph `◑`, label "THIS MONTH", hint "habits and programs that need a few weeks to mean anything", sort hint "a habit, program or monthly target that needs a few weeks", inserted right after `week`; skipped if `MAX_SECTIONS` already reached — items then go to `circleback` › "THIS MONTH")

| text | next |
|---|---|
| Complete the four-week core cycle — one circuit per week | Then start the TVA / oblique progression from 90/90 breathing forward. Stop any set when the low back arches, ribs flare, or hips twist. |
| LLF Movement #1 daily: two minutes of breathing at a 5/10 stretch, hips back over the second toe | Plus tromboning (10 reps) and left-side sleeping. |
| Make the body timer a habit | 15 sessions by month end. |
| Re-run the 30-day screen audit | Target: laptop hours down by a third. Compare to 284. |
| Join a yoga or tai chi class | Get to climbing at least once, maybe with Vic after PB. |
| Write the 5 things for each important goal | Outcome, target inputs, output measures, minimum floor, review point. Set the floor, then walk backwards from the equation. |
| Clear the reading queue, items 6 through 10 | Nov, Dec, Jan PDFs, the PRI page, the dating and style playbook. |
| Self-test everything you're learning away from the source material | No recall, no ball. |
| Four weeks of reaching out first: one person a week, minimum | Check in, say happy birthday, ask a question instead of picking a fight. |

## Implementation phases

### Phase 0 — Duplicate & scaffold
1. `mkdir ~/Desktop/AFH2`, copy every tracked file from the ActFromHere clone (scratchpad `src/`), `git init`, commit "Duplicate ActFromHere as AFH2", `git remote add origin https://github.com/EvanMyDude/AFH2.git`, push `main`.
2. Add `package.json` (`"type": "module"`; react 19, react-dom 19, esbuild, tailwindcss 3.4.14 pinned; scripts `build:css`, `build:js`, `build`, `test`), `.gitignore` (`node_modules`). `tailwind.config.js` gains `future: { hoverOnlyWhenSupported: true }` and `content: ["./src/*.{jsx,js}"]`. Verify a rebuild of the untouched source reproduces a working `app.js`.
3. Branch `feat/subsections-big-ticket`.

### Phase 1 — Model + tests (TDD)
4. `src/model.js`: extract `migrate`, `seed`, `firstGrapheme`, `uid`, constants; add v4 fields, `serialize`, subsection/reorder/move ops, `isSafeUrl`, orphan-bucket recovery.
5. `src/seed-big-ticket.js`: dataset above + `applySeed(state)`.
6. `test/model.test.js`: fixtures for v1/v2/v3 payloads (including one with an orphan item bucket and one with 10 sections), seed idempotency (apply twice = apply once), dedupe, every op. `npm test` green.

### Phase 2 — UI
7. `act-from-here.jsx`: import from model; `flush` → `serialize`; load-error split (seed only on key-not-found); render ungrouped + subsection groups with the never-unmount grid pattern (sections too); hover/touch add control; header rename/delete; quick-add per subsection; optgroup move select; ▲/▼ in section manager; blocked-scheme href handling; catch-all via `catchAllKey`; flush on pagehide/hidden; sorter model id.
8. CSS: all new classes are Tailwind utilities (grid rows, `group-hover`, arbitrary media variant, `motion-reduce`), so `styles.css` must be rebuilt; `tw-in.css` gets the `dvh`/safe-area rules.

### Phase 3 — Storage, boot, shell
9. `pages-main.jsx`: new keys, parameterized gist helpers, `importLegacy()` before adoption in `boot()` and after token save, `findOrCreateGist` strict error, `adoptRemoteIfNewer` validation, `importBackup` via `migrate` + stash, 3-slot conflict backup, export filename.
10. `sw.js` cache name + prefix-scoped purge, `manifest.webmanifest`, `index.html` (title, `apple-mobile-web-app-title`, dvh, safe-area), README rewrite for AFH2 (deploy URL, storage/PWA-isolation note, rebuild commands).

### Phase 4 — Build, verify, ship
11. `npm run build`; commit `app.js`/`styles.css`; push branch; open PR with summary.
12. Local verification (see below); merge PR; enable Pages: `gh api -X POST repos/EvanMyDude/AFH2/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/'`; poll until `status: built`; open `https://evanmydude.github.io/AFH2/` in the browser and confirm the legacy data + seeded subsections appear.

## Acceptance criteria

- [ ] `npm test` passes; migration fixtures v1/v2/v3 → v4 lose zero items, labels, urls, next steps, glyphs, collapse states — including a fixture with an orphan item bucket and one with a blank glyph.
- [ ] A corrupt `afh2-v1` blob renders an error state, is stashed, and is never overwritten or pushed.
- [ ] Two devices migrating the same legacy data independently converge with no conflict backup; a device whose legacy data is newer wins adoption.
- [ ] AFH2 first boot on a device with `afh-v1` shows every pre-existing item in its section, plus the seeded subsections; `afh-v1` untouched.
- [ ] Reloading AFH2 does not re-seed; deleting a seeded item and reloading does not resurrect it.
- [ ] Each section shows "＋ subsection" on hover (desktop) and always on touch; creating one animates open; toggling animates both ways; collapse state survives reload.
- [ ] Items can be moved into/out of subsections; deleting a subsection keeps its items (ungrouped).
- [ ] ▲/▼ in ⚙ sections reorders sections (and subsections); order survives reload and gist round-trip.
- [ ] Export → Import round-trips v4 data exactly; importing an old ActFromHere backup works.
- [ ] `javascript:` urls never render as links.
- [ ] Old app at `/ActFromHere/` still works unchanged after AFH2 has run on the same browser; its `afh-v1` key and its gist are byte-identical to before.
- [ ] Entering a GitHub token later (e.g. on the iPhone PWA, which starts with empty storage) pulls the legacy gist, migrates, seeds once, and pushes to the AFH2 gist; a second device then adopts that push with no conflict backup.
- [ ] After reordering so KEEPERS is not last, a failed sort still lands in KEEPERS.
- [ ] Moving an item between two subsections of the same section works.
- [ ] `https://evanmydude.github.io/AFH2/` serves the app; PWA installable with the title "AFH2".

## Verification

1. `npm test` (node:test, no browser).
2. `npm run build && npx serve .` (or `python3 -m http.server`) → open in Chrome via the browser tools: seed `localStorage["afh-v1"]` with a v3 fixture containing custom sections + items, load AFH2, assert items + subsections in DOM; exercise add/rename/delete/move/reorder/collapse; export JSON and diff against expected.
3. iPhone-width viewport (`hover: none` emulation) → add-subsection control visible without hover.
4. After Pages deploy: load the live URL, check console clean, service worker registered, manifest title AFH2.

## Sources

- Source repo clone: `/private/tmp/claude-501/-Users-evanestes-Desktop/1585dd10-cba6-4380-9ec9-4d6c10b9ab12/scratchpad/src`
- Existing patterns to reuse: `persist`/`setLocal`/`cur()` state discipline (`act-from-here.jsx:233-249`), double-click rename (`:615-630`), inline delete confirm (`:891-909`), quick-add form (`:774-816`), `firstGrapheme`, `migrate`.
- PDF: `/Users/evanestes/Desktop/big ticket.pdf` (pages 1–4; "EVERYTHING ELSE" ignored).
- Target repo: `https://github.com/EvanMyDude/AFH2` (empty, `gh` authenticated as EvanMyDude).
