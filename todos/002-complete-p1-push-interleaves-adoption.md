---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, sync,data-loss]
dependencies: []
---

# A push landing between pull and meta-read defeats the conflict stash

## Problem Statement
pushToGist is not under the adoption mutex. Sequence: unpushed local edit X → pull reads newer remote Y → debounce push completes (pushedAt = X) → stash guard (savedAt > pushedAt) is false → local overwritten with Y → boot pushes Y over X. X gone from device and gist.

## Proposed Solution
Serialize pushToGist and adoptRemoteIfNewer on one promise chain (sync.op) so they never interleave; callers await the real result (replaces the opInFlight 'return false' mutex, which also made saveKeys push into an unexamined gist).

## Acceptance Criteria
- [x] Fix applied in the named file(s)
- [x] `npm test` green; new test where the behavior is unit-testable
- [x] Browser smoke on the affected flow

## Work Log
- 2026-09-14 — created from PR #1 review (agents: race, security, bug, simplicity)

## Resources
- PR: https://github.com/EvanMyDude/AFH2/pull/1
- 2026-09-14 — resolved in commit "fix(review)" on feat/subsections-big-ticket; verified by npm test (26) and Playwright smoke (legacy import, Esc quick-add, collapse-commits-edit)
