---
description: Create or update the feature specification from a natural language feature description.
handoffs:
  - label: Build Technical Plan
    agent: speckit.plan
    prompt: Create a plan for the spec. I am building with...
  - label: Clarify Spec Requirements
    agent: speckit.clarify
    prompt: Clarify specification requirements
    send: true
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

The text the user typed after `/speckit.specify` in the triggering message **is** the feature description. Assume you always have it available in this conversation even if `$ARGUMENTS` appears literally below. Do not ask the user to repeat it unless they provided an empty command.

Given that feature description, do this:

1. **Generate a concise short name** (2-4 words) for the branch:
   - Analyze the feature description and extract the most meaningful keywords
   - Create a 2-4 word short name that captures the essence of the feature
   - Use action-noun format when possible (e.g., "add-user-auth", "fix-payment-bug")
   - Preserve technical terms and acronyms (OAuth2, API, JWT, etc.)
   - Keep it concise but descriptive enough to understand the feature at a glance
   - Examples:
     - "I want to add user authentication" → "user-auth"
     - "Implement OAuth2 integration for the API" → "oauth2-api-integration"
     - "Create a dashboard for analytics" → "analytics-dashboard"
     - "Fix payment processing timeout bug" → "fix-payment-timeout"

2. **Check for existing branches before creating new one**:

   a. First, fetch all remote branches to ensure we have the latest information:

      ```bash
      git fetch --all --prune
      ```

   b. Find the highest feature number across all sources for the short-name:
      - Remote branches: `git ls-remote --heads origin | grep -E 'refs/heads/[0-9]+-<short-name>$'`
      - Local branches: `git branch | grep -E '^[* ]*[0-9]+-<short-name>$'`
      - Specs directories: Check for directories matching `specs/[0-9]+-<short-name>`

   c. Determine the next available number:
      - Extract all numbers from all three sources
      - Find the highest number N
      - Use N+1 for the new branch number

   d. Run the script `.specify/scripts/bash/create-new-feature.sh --json "$ARGUMENTS"` with the calculated number and short-name:
      - Pass `--number N+1` and `--short-name "your-short-name"` along with the feature description
      - Bash example: `.specify/scripts/bash/create-new-feature.sh --json "$ARGUMENTS" --json --number 5 --short-name "user-auth" "Add user authentication"`
      - PowerShell example: `.specify/scripts/bash/create-new-feature.sh --json "$ARGUMENTS" -Json -Number 5 -ShortName "user-auth" "Add user authentication"`

   **IMPORTANT**:
   - Check all three sources (remote branches, local branches, specs directories) to find the highest number
   - Only match branches/directories with the exact short-name pattern
   - If no existing branches/directories found with this short-name, start with number 1
   - You must only ever run this script once per feature
   - The JSON is provided in the terminal as output - always refer to it to get the actual content you're looking for
   - The JSON output will contain BRANCH_NAME and SPEC_FILE paths
   - For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot")

3. Load `.specify/templates/spec-template.md` to understand required sections.

4. Follow this execution flow:

    1. Parse user description from Input
       If empty: ERROR "No feature description provided"
    2. Extract key concepts from description
       Identify: actors, actions, data, constraints
    3. For unclear aspects:
       - Make informed guesses based on context and industry standards
       - Only mark with [NEEDS CLARIFICATION: specific question] if:
         - The choice significantly impacts feature scope or user experience
         - Multiple reasonable interpretations exist with different implications
         - No reasonable default exists
       - **LIMIT: Maximum 3 [NEEDS CLARIFICATION] markers total**
       - Prioritize clarifications by impact: scope > security/privacy > user experience > technical details
    4. Fill User Scenarios & Testing section
       If no clear user flow: ERROR "Cannot determine user scenarios"
    5. Generate Functional Requirements
       Each requirement must be testable
       Use reasonable defaults for unspecified details (document assumptions in Assumptions section)
    6. Define Success Criteria
       Create measurable, technology-agnostic outcomes
       Include both quantitative metrics (time, performance, volume) and qualitative measures (user satisfaction, task completion)
       Each criterion must be verifiable without implementation details
    7. Identify Key Entities (if data involved)
    8. Return: SUCCESS (spec ready for planning)

5. Write the specification to SPEC_FILE using the template structure, replacing placeholders with concrete details derived from the feature description (arguments) while preserving section order and headings.

6. **Generate Visual Diagrams (Hybrid Approach) - MANDATORY**:

   **CRITICAL: You MUST complete BOTH living diagram updates AND feature diagram creation. Do not skip either.**

   This project uses a **hybrid diagram strategy**:

   | Diagram Type | Location | Purpose | Updates |
   |--------------|----------|---------|---------|
   | **Living Diagrams** | `docs/architecture/` | Show CURRENT STATE of entire system | **MUST update with EVERY new feature** |
   | **Feature Diagrams** | `specs/<feature>/diagrams/` | Show DELTA/CHANGES only | **MUST create for EVERY new feature** |

   ### Step 6a: Initialize Living Diagrams (First Feature Only)

   Check if `docs/architecture/` exists. If NOT, create it and initialize from templates:

   ```bash
   mkdir -p docs/architecture
   ```

   Copy templates if living diagrams don't exist:
   - `docs/architecture/system-overview.html` ← from `.specify/templates/architecture/system-overview.html`
   - `docs/architecture/data-flow.html` ← from `.specify/templates/architecture/data-flow.html`
   - `docs/architecture/user-journeys.html` ← from `.specify/templates/architecture/user-journeys.html`

   **IMPORTANT**: Only create these files if they don't already exist. Do NOT overwrite existing living diagrams.

   ### Step 6b: Update Living Diagrams - MANDATORY FOR EVERY FEATURE

   **You MUST update living diagrams for EVERY new feature, not just the first one.**

   For each living diagram file, do the following:

   1. **Read** the existing file (e.g., `docs/architecture/system-overview.html`)
   2. **Identify** what this feature adds:
      - New frontend components
      - New backend services/commands
      - New data flows or IPC
      - New user journeys
   3. **Add** new components to the appropriate diagram:
      - Mark additions with comment: `<!-- Added by [FEATURE_NUM]-[name] -->`
      - Place new components in the correct layer/section
   4. **Update metadata**:
      - Change "Last Updated" date to today
      - Change "Feature" reference to current feature name
   5. **Save** the updated file

   **Files to update:**
   - `docs/architecture/system-overview.html` - Add new components to Frontend/Backend/Storage layers
   - `docs/architecture/data-flow.html` - Add new IPC commands/events to the table
   - `docs/architecture/user-journeys.html` - Add new user flows or extend existing ones

   **Example of adding a component:**
   ```html
   <!-- Added by 006-toc-tab-and-new-features -->
   <div class="component new">
       <div class="component-name">TabBar</div>
       <div class="component-desc">Multi-document tabs</div>
   </div>
   ```

   ### Step 6c: Create Feature-Specific Diagrams (Delta Only) - MANDATORY

   Create the feature diagrams directory:

   ```bash
   mkdir -p FEATURE_DIR/diagrams
   ```

   Generate the following **delta-focused** diagram files:

   | File | Purpose | Content |
   |------|---------|---------|
   | `diagrams/wireframe.html` | UI changes this feature introduces | ONLY new/modified screens and components |
   | `diagrams/diff-diagram.html` | Architecture delta | ONLY new/modified components, data flows, IPC |

   **Feature Diagram Content Guidelines**:

   a. **wireframe.html** - Show ONLY changes:
      - New screens/pages being added (mark as 🟢 NEW)
      - Modified components with before/after (mark as 🟠 MODIFIED)
      - New navigation paths
      - DO NOT redraw unchanged parts of the UI
      - Reference living diagrams for full context

   b. **diff-diagram.html** - Show ONLY changes:
      - New components (green border/background, marked NEW)
      - Modified components (orange border/background, marked MODIFIED)
      - New data flows (dashed arrows)
      - New IPC commands/events
      - DO NOT include unchanged architecture
      - Include a "Reference" link to living diagrams

   **Visual Markers for Feature Diagrams**:
   ```css
   /* NEW component */
   .new { background: #e8f5e9; border: 2px solid #4caf50; }

   /* MODIFIED component */
   .modified { background: #fff3e0; border: 2px solid #ff9800; }

   /* NEW data flow */
   .new-flow { stroke-dasharray: 5,5; stroke: #4caf50; }
   ```

7. **Specification Quality Validation**: After writing the initial spec, validate it against quality criteria:

   a. **Create Spec Quality Checklist**: Generate a checklist file at `FEATURE_DIR/checklists/requirements.md` using the checklist template structure with these validation items:

      ```markdown
      # Specification Quality Checklist: [FEATURE NAME]

      **Purpose**: Validate specification completeness and quality before proceeding to planning
      **Created**: [DATE]
      **Feature**: [Link to spec.md]

      ## Content Quality

      - [ ] No implementation details (languages, frameworks, APIs)
      - [ ] Focused on user value and business needs
      - [ ] Written for non-technical stakeholders
      - [ ] All mandatory sections completed

      ## Requirement Completeness

      - [ ] No [NEEDS CLARIFICATION] markers remain
      - [ ] Requirements are testable and unambiguous
      - [ ] Success criteria are measurable
      - [ ] Success criteria are technology-agnostic (no implementation details)
      - [ ] All acceptance scenarios are defined
      - [ ] Edge cases are identified
      - [ ] Scope is clearly bounded
      - [ ] Dependencies and assumptions identified

      ## Feature Readiness

      - [ ] All functional requirements have clear acceptance criteria
      - [ ] User scenarios cover primary flows
      - [ ] Feature meets measurable outcomes defined in Success Criteria
      - [ ] No implementation details leak into specification

      ## Visual Design Completeness (Hybrid Approach) - MANDATORY

      - [ ] Living diagrams UPDATED in docs/architecture/:
        - [ ] system-overview.html updated with new components
        - [ ] data-flow.html updated with new IPC/data flows
        - [ ] user-journeys.html updated with new user flows
        - [ ] "Last Updated" date and feature reference updated
      - [ ] Feature diagrams CREATED in specs/<feature>/diagrams/:
        - [ ] wireframe.html created (shows ONLY new/modified UI)
        - [ ] diff-diagram.html created (shows ONLY architecture changes)
      - [ ] Feature diagrams include reference link to living diagrams

      ## Notes

      - Items marked incomplete require spec updates before `/speckit.clarify` or `/speckit.plan`
      ```

   b. **Run Validation Check**: Review the spec against each checklist item:
      - For each item, determine if it passes or fails
      - Document specific issues found (quote relevant spec sections)

   c. **Handle Validation Results**:

      - **If all items pass**: Mark checklist complete and proceed to step 8

      - **If items fail (excluding [NEEDS CLARIFICATION])**:
        1. List the failing items and specific issues
        2. Update the spec to address each issue
        3. Re-run validation until all items pass (max 3 iterations)
        4. If still failing after 3 iterations, document remaining issues in checklist notes and warn user

      - **If [NEEDS CLARIFICATION] markers remain**:
        1. Extract all [NEEDS CLARIFICATION: ...] markers from the spec
        2. **LIMIT CHECK**: If more than 3 markers exist, keep only the 3 most critical (by scope/security/UX impact) and make informed guesses for the rest
        3. For each clarification needed (max 3), present options to user in this format:

           ```markdown
           ## Question [N]: [Topic]

           **Context**: [Quote relevant spec section]

           **What we need to know**: [Specific question from NEEDS CLARIFICATION marker]

           **Suggested Answers**:

           | Option | Answer | Implications |
           |--------|--------|--------------|
           | A      | [First suggested answer] | [What this means for the feature] |
           | B      | [Second suggested answer] | [What this means for the feature] |
           | C      | [Third suggested answer] | [What this means for the feature] |
           | Custom | Provide your own answer | [Explain how to provide custom input] |

           **Your choice**: _[Wait for user response]_
           ```

        4. **CRITICAL - Table Formatting**: Ensure markdown tables are properly formatted:
           - Use consistent spacing with pipes aligned
           - Each cell should have spaces around content: `| Content |` not `|Content|`
           - Header separator must have at least 3 dashes: `|--------|`
           - Test that the table renders correctly in markdown preview
        5. Number questions sequentially (Q1, Q2, Q3 - max 3 total)
        6. Present all questions together before waiting for responses
        7. Wait for user to respond with their choices for all questions (e.g., "Q1: A, Q2: Custom - [details], Q3: B")
        8. Update the spec by replacing each [NEEDS CLARIFICATION] marker with the user's selected or provided answer
        9. Re-run validation after all clarifications are resolved

   d. **Update Checklist**: After each validation iteration, update the checklist file with current pass/fail status

8. **Report completion** with the following format:

   ```markdown
   ## Specification Complete

   **Branch**: `[BRANCH_NAME]`
   **Spec File**: `[SPEC_FILE_PATH]`

   ### Diagrams Updated (Hybrid Approach)

   **Living Diagrams** (`docs/architecture/`):
   - [ ] system-overview.html - [CREATED/UPDATED] - Added: [list new components]
   - [ ] data-flow.html - [CREATED/UPDATED] - Added: [list new IPC/flows]
   - [ ] user-journeys.html - [CREATED/UPDATED] - Added: [list new journeys]

   **Feature Diagrams** (`specs/[FEATURE]/diagrams/`):
   - [ ] wireframe.html - Created (shows [N] new/modified UI components)
   - [ ] diff-diagram.html - Created (shows [N] architecture changes)

   ### Checklist Results
   - [X] All items passed / [ ] Items requiring attention: [list]

   ### Next Steps
   Ready for `/speckit.clarify` or `/speckit.plan`
   ```

   **IMPORTANT**: You MUST confirm that BOTH living diagrams AND feature diagrams were handled before reporting completion.

**NOTE:** The script creates and checks out the new branch and initializes the spec file before writing.

## General Guidelines

## Quick Guidelines

- Focus on **WHAT** users need and **WHY**.
- Avoid HOW to implement (no tech stack, APIs, code structure).
- Written for business stakeholders, not developers.
- DO NOT create any checklists that are embedded in the spec. That will be a separate command.

### Hybrid Diagram Approach

This workflow uses a **hybrid diagram strategy**:

| Type | Location | Shows | Best For |
|------|----------|-------|----------|
| Living Diagrams | `docs/architecture/` | Current system state | Onboarding, architecture decisions |
| Feature Diagrams | `specs/<feature>/diagrams/` | Delta/changes only | PR reviews, feature scope |

**Key Principles**:
1. **Living diagrams** = Single source of truth for current state
2. **Feature diagrams** = Frozen snapshot of what each feature changed
3. Feature diagrams should REFERENCE living diagrams, not duplicate them
4. Use visual markers (green=NEW, orange=MODIFIED) in feature diagrams

### Section Requirements

- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation

When creating this spec from a user prompt:

1. **Make informed guesses**: Use context, industry standards, and common patterns to fill gaps
2. **Document assumptions**: Record reasonable defaults in the Assumptions section
3. **Limit clarifications**: Maximum 3 [NEEDS CLARIFICATION] markers - use only for critical decisions that:
   - Significantly impact feature scope or user experience
   - Have multiple reasonable interpretations with different implications
   - Lack any reasonable default
4. **Prioritize clarifications**: scope > security/privacy > user experience > technical details
5. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist item
6. **Common areas needing clarification** (only if no reasonable default exists):
   - Feature scope and boundaries (include/exclude specific use cases)
   - User types and permissions (if multiple conflicting interpretations possible)
   - Security/compliance requirements (when legally/financially significant)

**Examples of reasonable defaults** (don't ask about these):

- Data retention: Industry-standard practices for the domain
- Performance targets: Standard web/mobile app expectations unless specified
- Error handling: User-friendly messages with appropriate fallbacks
- Authentication method: Standard session-based or OAuth2 for web apps
- Integration patterns: RESTful APIs unless specified otherwise

### Success Criteria Guidelines

Success criteria must be:

1. **Measurable**: Include specific metrics (time, percentage, count, rate)
2. **Technology-agnostic**: No mention of frameworks, languages, databases, or tools
3. **User-focused**: Describe outcomes from user/business perspective, not system internals
4. **Verifiable**: Can be tested/validated without knowing implementation details

**Good examples**:

- "Users can complete checkout in under 3 minutes"
- "System supports 10,000 concurrent users"
- "95% of searches return results in under 1 second"
- "Task completion rate improves by 40%"

**Bad examples** (implementation-focused):

- "API response time is under 200ms" (too technical, use "Users see results instantly")
- "Database can handle 1000 TPS" (implementation detail, use user-facing metric)
- "React components render efficiently" (framework-specific)
- "Redis cache hit rate above 80%" (technology-specific)
