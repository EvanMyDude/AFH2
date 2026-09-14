---
status: complete
priority: p3
issue_id: "009"
tags: [code-review, sync]
dependencies: []
---

# Gist sync robustness: truncated >1MB content, no pagination, stale cached gist id (404), 5-min clock-skew window

## Problem Statement
Truncated gist content fails to parse forever while the origin device keeps pushing; per_page=100 without pagination can miss the gist on accounts with >100 gists (defeating reconciliation); a cached id pointing at a deleted gist 404s forever; a device >5 min fast is refused by every other device.

## Proposed Solution
Check files[].truncated and refuse pushes >900k with a clear status; paginate up to 10 pages; on 404 clear afh2-gist-id and retry once; widen clampSavedAt to 24h; await pushToGist in saveKeys for the status message; skip pushes when nothing is stranded; defer revokeObjectURL.

## Acceptance Criteria
- [x] Fix applied in the named file(s)
- [x] `npm test` green; new test where the behavior is unit-testable
- [x] Browser smoke on the affected flow

## Work Log
- 2026-09-14 — created from PR #1 review (agents: race, security, bug, simplicity)

## Resources
- PR: https://github.com/EvanMyDude/AFH2/pull/1
- 2026-09-14 — resolved in commit "fix(review)" on feat/subsections-big-ticket; verified by npm test (26) and Playwright smoke (legacy import, Esc quick-add, collapse-commits-edit)
