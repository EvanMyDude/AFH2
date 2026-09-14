---
status: complete
priority: p3
issue_id: "010"
tags: [code-review, quality]
dependencies: []
---

# Dead code and duplicated helpers after the rewrite

## Problem Statement
Unused DEFAULT_SECTIONS import and leftover re-export in act-from-here.jsx; trailing else after the retry loop; has() defined twice; sync.lastPushedAt written never read; afh:flush effect re-subscribes every render.

## Proposed Solution
Remove dead code; import has from model.js; register the flush listener once and call a ref; direct synchronous write in onFlush (bypass the busy gate).

## Acceptance Criteria
- [x] Fix applied in the named file(s)
- [x] `npm test` green; new test where the behavior is unit-testable
- [x] Browser smoke on the affected flow

## Work Log
- 2026-09-14 — created from PR #1 review (agents: race, security, bug, simplicity)

## Resources
- PR: https://github.com/EvanMyDude/AFH2/pull/1
- 2026-09-14 — resolved in commit "fix(review)" on feat/subsections-big-ticket; verified by npm test (26) and Playwright smoke (legacy import, Esc quick-add, collapse-commits-edit)
