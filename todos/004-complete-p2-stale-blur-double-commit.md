---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, ui,data-integrity]
dependencies: []
---

# Stale onBlur after Esc/Enter re-commits or duplicates form input (Chrome)

## Problem Statement
Chrome fires blur on a focused input that is removed from the DOM; React dispatches the stale onBlur whose closure still has editing/addingItem set. Esc in quick-add can still add the item; Esc in rename/label/glyph can commit the discarded value; Enter then blur can double-add.

## Proposed Solution
Mirror editing/editingCat/editingGlyph/editingSub/addingItem in refs cleared synchronously in every close path; commit functions bail when the ref is null.

## Acceptance Criteria
- [x] Fix applied in the named file(s)
- [x] `npm test` green; new test where the behavior is unit-testable
- [x] Browser smoke on the affected flow

## Work Log
- 2026-09-14 — created from PR #1 review (agents: race, security, bug, simplicity)

## Resources
- PR: https://github.com/EvanMyDude/AFH2/pull/1
- 2026-09-14 — resolved in commit "fix(review)" on feat/subsections-big-ticket; verified by npm test (26) and Playwright smoke (legacy import, Esc quick-add, collapse-commits-edit)
