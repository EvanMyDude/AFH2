---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, ui,data-integrity]
dependencies: []
---

# Collapsing discards in-progress edits and quick-add text; scope check is a tautology

## Problem Statement
clearTransient uses (subKey == null || true) — always true — so collapsing any subsection cancels an edit anywhere in the section; it calls setEditing(null)/closeNewItem() (discard) although tapping away is documented to commit. toggleCollapse/toggleSub also capture cur() BEFORE clearTransient, so a commit there would be overwritten.

## Proposed Solution
Commit instead of cancel (commitItemEdit/commitNewItem(false)/commitSubRename), scope the edit check by the item's sub, and read cur() after clearTransient.

## Acceptance Criteria
- [x] Fix applied in the named file(s)
- [x] `npm test` green; new test where the behavior is unit-testable
- [x] Browser smoke on the affected flow

## Work Log
- 2026-09-14 — created from PR #1 review (agents: race, security, bug, simplicity)

## Resources
- PR: https://github.com/EvanMyDude/AFH2/pull/1
- 2026-09-14 — resolved in commit "fix(review)" on feat/subsections-big-ticket; verified by npm test (26) and Playwright smoke (legacy import, Esc quick-add, collapse-commits-edit)
