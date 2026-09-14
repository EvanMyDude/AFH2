---
status: complete
priority: p1
issue_id: "001"
tags: [code-review, sync,data-loss]
dependencies: []
---

# Edits typed during a gist pull are dropped without a stash

## Problem Statement
pages-main.jsx adoptAndReload flushes BEFORE the network pull; an edit made during the up-to-4s pull sits in latest.current with a 400ms debounce, the adoption compares stale meta, writes the remote blob, freezes and reloads → the edit evaporates and the header says saved ✓.

## Proposed Solution
Call flushApp() AFTER pullFromGist() returns and before getMeta() inside adoptRemoteIfNewer, so meta reflects the in-flight edit (savedAt > remote → not adopted → pushed).

## Acceptance Criteria
- [x] Fix applied in the named file(s)
- [x] `npm test` green; new test where the behavior is unit-testable
- [x] Browser smoke on the affected flow

## Work Log
- 2026-09-14 — created from PR #1 review (agents: race, security, bug, simplicity)

## Resources
- PR: https://github.com/EvanMyDude/AFH2/pull/1
- 2026-09-14 — resolved in commit "fix(review)" on feat/subsections-big-ticket; verified by npm test (26) and Playwright smoke (legacy import, Esc quick-add, collapse-commits-edit)
