---
status: complete
priority: p2
issue_id: "006"
tags: [code-review, security,data-loss]
dependencies: []
---

# Remote adoption accepts degenerate payloads ("null", "{}", "[]") and wipes local data

## Problem Statement
migrate() is lossless and defaults anything unrecognizable to an empty five-section state, so a gist whose data is "{}" passes validation, differs from local, and replaces it (no stash when already pushed). importBackup already guards this shape; adoption does not.

## Proposed Solution
Add looksLikeState() to model.js and use it in both adoptRemoteIfNewer and importBackup; refuse adoption otherwise.

## Acceptance Criteria
- [x] Fix applied in the named file(s)
- [x] `npm test` green; new test where the behavior is unit-testable
- [x] Browser smoke on the affected flow

## Work Log
- 2026-09-14 — created from PR #1 review (agents: race, security, bug, simplicity)

## Resources
- PR: https://github.com/EvanMyDude/AFH2/pull/1
- 2026-09-14 — resolved in commit "fix(review)" on feat/subsections-big-ticket; verified by npm test (26) and Playwright smoke (legacy import, Esc quick-add, collapse-commits-edit)
