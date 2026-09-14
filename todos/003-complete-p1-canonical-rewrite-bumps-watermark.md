---
status: complete
priority: p1
issue_id: "003"
tags: [code-review, sync,data-loss]
dependencies: []
---

# First-load canonical rewrite stamps savedAt=now and pushes

## Problem Statement
act-from-here.jsx load effect: serialize(migrated) !== res.value → scheduleSave → storage.set stamps savedAt=now() and schedules a push. This branch adds subs:[] to every section so every device re-serializes on first boot and claims a fresh edit. If the startup gist gate times out, a stale blob gets a fresh stamp and later overwrites genuinely newer edits on another device.

## Proposed Solution
Add storage.set(key, value, { touch: false }) that writes without touching meta or scheduling a push; use it for the canonical rewrite.

## Acceptance Criteria
- [x] Fix applied in the named file(s)
- [x] `npm test` green; new test where the behavior is unit-testable
- [x] Browser smoke on the affected flow

## Work Log
- 2026-09-14 — created from PR #1 review (agents: race, security, bug, simplicity)

## Resources
- PR: https://github.com/EvanMyDude/AFH2/pull/1
- 2026-09-14 — resolved in commit "fix(review)" on feat/subsections-big-ticket; verified by npm test (26) and Playwright smoke (legacy import, Esc quick-add, collapse-commits-edit)
