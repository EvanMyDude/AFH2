---
status: complete
priority: p3
issue_id: "008"
tags: [code-review, security,quality]
dependencies: []
---

# Sanitizer admits Object.prototype property names as keys (constructor, toString…)

## Problem Statement
KEY_RE rejects __proto__ but not constructor/valueOf; collapsed[key] then reads an inherited function → truthy → section permanently collapsed and re-persisted.

## Proposed Solution
sanitizeKey: reject k in Object.prototype; add a test next to the __proto__ case.

## Acceptance Criteria
- [x] Fix applied in the named file(s)
- [x] `npm test` green; new test where the behavior is unit-testable
- [x] Browser smoke on the affected flow

## Work Log
- 2026-09-14 — created from PR #1 review (agents: race, security, bug, simplicity)

## Resources
- PR: https://github.com/EvanMyDude/AFH2/pull/1
- 2026-09-14 — resolved in commit "fix(review)" on feat/subsections-big-ticket; verified by npm test (26) and Playwright smoke (legacy import, Esc quick-add, collapse-commits-edit)
