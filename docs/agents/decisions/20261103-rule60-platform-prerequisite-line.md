# 2026-11-03: Platform prerequisite in rule 60

- **Decided:** 2026-11-03, by the user: 「按建议做」, accepting recommendation 6 in `docs/audit/20261103-ci-failure-audit.md` for issue #613.
- **Decision:** A macOS-only test declares `prerequisite: macos` in the CI inventory, or uses Rust `cfg(target_os)`. A Linux-supported test must not carry that restriction. The current checklist text is [rule 60's platform line](../../../.claude/rules/60-review-checklist.md#test-coverage-gaps); the line has no link because of the always-on route byte budget.
- **changes:** `.claude/rules/60-review-checklist.md` (Test Coverage Gaps, platform line).
- **supersedes:** none.
- **gate-sensitive:** yes, doubt means review: this changes a review checklist used in the landing route (herdr-delegator's GH607 fix-1 brief, 2026-11-03).
