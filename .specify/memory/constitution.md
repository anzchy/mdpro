# [PROJECT_NAME] Constitution

## Core Principles

### I. [PRINCIPLE_1_NAME]
<!-- Example: Local-First, Cloud-Native, Mobile-First, etc. -->
[PRINCIPLE_1_DESCRIPTION]
<!-- Example: All features must work offline with local filesystem only. -->

### II. [PRINCIPLE_2_NAME]
<!-- Example: Simplicity, Modularity, Security-First, etc. -->
[PRINCIPLE_2_DESCRIPTION]
<!-- Example: No new frameworks unless necessary; reuse existing stack; avoid over-engineering. -->

### III. [PRINCIPLE_3_NAME]
<!-- Example: Performance, Scalability, Reliability, etc. -->
[PRINCIPLE_3_DESCRIPTION]
<!-- Example: Define measurable success criteria for each feature with specific metrics. -->

### IV. [PRINCIPLE_4_NAME]
<!-- Example: Platform Conventions, API Standards, Accessibility, etc. -->
[PRINCIPLE_4_DESCRIPTION]
<!-- Example: Follow platform HIG patterns; consistent UI conventions; native integrations. -->

### V. Changelog Tracking (MANDATORY)

**Every feature added, error fixed, or git commit MUST be documented in `CHANGELOG.md` at the project root.**

Rules:
1. Maintain a `CHANGELOG.md` file in the project root directory
2. For every feature added: Add entry under appropriate version section with description
3. For every bug/error fixed: Add entry with brief description of the fix
4. For every git commit: Reference the relevant commit hash in the changelog entry
5. Follow [Keep a Changelog](https://keepachangelog.com/) format:
   - `Added` for new features
   - `Changed` for changes in existing functionality
   - `Deprecated` for soon-to-be removed features
   - `Removed` for now removed features
   - `Fixed` for any bug fixes
   - `Security` for vulnerability fixes

Example entry:
```markdown
## [1.2.0] - 2026-02-03

### Added
- User authentication system (a1b2c3d)
- Dashboard analytics widget (e4f5g6h)

### Fixed
- Login timeout issue on slow networks (i7j8k9l)
```

### VI. Atomic Commits (MANDATORY)

**All git commits MUST follow atomic commit principles for maintainable version history.**

#### Definition
An **atomic commit** contains exactly one logical change that is:
- **Self-contained**: Complete and functional on its own
- **Reversible**: Can be reverted without breaking other features
- **Testable**: Project builds and runs after the commit
- **Reviewable**: Easy to understand in code review

#### Commit Message Format
```
<type>(<scope>): <short summary>

<body: explain WHY, not WHAT>

<footer: references, breaking changes, testing notes>
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`

**Rules**:
- Subject line: ≤50 chars, imperative mood, lowercase after colon
- Body: ≤72 chars/line, explain motivation and context
- Footer: `Closes #123`, `BREAKING CHANGE:`, `Tested:`

#### Splitting Strategies

| Strategy | When to Use | Example |
|----------|-------------|---------|
| By Feature | New functionality | TOC, Tabs, Image service as separate commits |
| By Layer | Full-stack changes | Backend → Frontend → Styles |
| By Type | Mixed changes | Code separate from docs/tests |

#### Anti-Patterns to Avoid
- ❌ "WIP", "fix stuff", "updates" (vague messages)
- ❌ Mixing unrelated changes in one commit
- ❌ Commits that break the build
- ❌ Giant commits with 50+ files
- ❌ Splitting too granularly (1 file = 1 commit)

#### Workflow
```bash
# 1. Stage related files only
git add src/components/Feature/

# 2. Verify staged content
git diff --cached --stat

# 3. Commit with descriptive message
git commit -m "feat(feature): add X for Y reason"

# 4. Repeat for next logical change
```

### VII. [ADDITIONAL_PRINCIPLES]
<!-- Add more principles as needed for your project -->
[ADDITIONAL_PRINCIPLE_DESCRIPTION]

## Development Workflow

### Code Quality
<!-- Example: TypeScript strict mode, linting rules, code review requirements -->
- [CODE_QUALITY_RULE_1]
- [CODE_QUALITY_RULE_2]
- [CODE_QUALITY_RULE_3]

### Testing Strategy
<!-- Example: Unit tests, integration tests, E2E tests -->
- [TESTING_TOOL_1] for [TEST_TYPE_1]
- [TESTING_TOOL_2] for [TEST_TYPE_2]
- [TESTING_TOOL_3] for [TEST_TYPE_3]

## Constraints

<!-- Project-specific limitations and boundaries -->
- [CONSTRAINT_1]
<!-- Example: Platform requirements (macOS 13+, iOS 15+, etc.) -->
- [CONSTRAINT_2]
<!-- Example: Size limits (max file size, bundle size, etc.) -->
- [CONSTRAINT_3]
<!-- Example: Feature exclusions (no PDF export, no plugin system, etc.) -->
- [CONSTRAINT_4]
<!-- Example: Dependencies (no external APIs, offline-only, etc.) -->

## Governance

- Constitution supersedes default practices
- Amendments require documentation and rationale
- All implementations must verify compliance with these principles
- [ADDITIONAL_GOVERNANCE_RULES]

**Version**: [VERSION] | **Ratified**: [DATE] | **Last Amended**: [DATE]
<!-- Example: Version: 1.0.0 | Ratified: 2026-02-03 | Last Amended: 2026-02-03 -->
