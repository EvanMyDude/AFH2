# CLAUDE.md

Read `HANDOFF.md` first. Its code map (§3) and invariants (§5) are binding; §6 is the dev loop.

## The live data has to survive untouched

The owner's real items live in AFH2 and sync through a private gist. The data is not in this repo: it sits in each
device's localStorage (`afh2-v1`, `afh2-meta`) and in the gist. The risk is what a new build does to that data when it
loads on a device after a merge.

- **A new build loading over existing data must change nothing by itself:** `afh2-v1` stays byte-identical,
  `afh2-meta` is untouched, nothing is pushed. Prove it for every change with a browser test against a fixture
  (HANDOFF §6, "No-op upgrade test"). A scratch script outside the repo is fine.
- **No new synced fields.** The current build's `migrate()` strips fields it does not know, and the service worker
  serves the previous bundle on a device's first load after each deploy. A device that has not updated yet can erase
  a new field and sync that loss to every device.
- Preferences or UI state that do not need to sync live in their own `afh2-*` localStorage key, never inside
  `afh2-v1`, never in exports, never read by the sync engine.
- Changes to `src/model.js`, the storage keys, or the sync engine (`src/pages-main.jsx` push/pull/adopt/boot) need the
  owner's OK first, with a rollout that survives the mixed-version window.
- Never rename the storage or credential keys, the gist description (`afh2-data`) or file name (`afh2.json`), the
  manifest `id`/`scope`, or the site path (`/AFH2/`). They are how devices find the data and the installed app.
- Never use the owner's GitHub token or Anthropic key. When testing sync or Sort It, stub `api.github.com` and
  `api.anthropic.com`. A build under test that pushed fixture data to the real gist with a newer timestamp would be
  adopted by every device.
- GitHub Pages serves `main` directly, and `app.js` and `styles.css` are committed build outputs. Work on a branch,
  open a PR, never push to `main`; the owner merges. Rebuild with `npm run build` and commit the outputs with the
  source.
- Never publish a preview anywhere under `evanmydude.github.io`: every page on that origin shares the live app's
  localStorage and token.
- The repo is public. Keep any data export (`afh2-backup-*.json`) outside the working tree, and keep its contents out
  of commits, tests, PR text, and committed or posted screenshots. Fixtures come from
  `serialize(applySeed(seed()))`.
