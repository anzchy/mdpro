## Fable research review — slicing best practice

Reviewer: Fable (independent research reviewer, not an audit). Date: 2026-10-31.
Question file: `~/.mdpro-redesign/herdr-spike/delegator/slicing-best-practice-question.md`.
Method: WebSearch + WebFetch on primary sources only (vendor docs and engineering blogs, Google's SWE book and
eng-practices, Kent Beck and martinfowler.com for the TDD and expand–contract definitions). I did not read the
other reviewer's report and did not edit the repo.

---

### 1. Sources

Each entry: URL, publisher, date if shown, the sentence(s) relied on. "Quoted" text is verbatim from the page as
fetched today; a paraphrase is marked.

**Anthropic / Claude Code**

- S1 — https://code.claude.com/docs/en/best-practices — Anthropic, "Best practices for Claude Code" (the old
  `anthropic.com/engineering/claude-code-best-practices` URL 308-redirects here; the April-2025 original with the
  "Write tests, commit; code, iterate, commit" section could **not be reopened**, web.archive.org is blocked from
  this tool). Relied on:
  - Prompt table: *"users report login fails after the session times out. look at token refresh in src/auth/,
    write a failing test that reproduces it, then fix it"*.
  - "Claude tends to read a request conservatively and build the smallest thing that satisfies it … When you want
    the fuller version, with the edge cases handled and the natural follow-on included, say so … That's telling
    Claude about scope, which only you know".
  - "Once `SPEC.md` exists, start a fresh session to build from it, so the build begins with a clean context and a
    written definition of done."
  - "Give Claude something it can run that comes back pass or fail. Once it has that, it can keep going on its own".
  - "ask Claude for *evidence*: the command it ran and its output, or the screenshot. 'All tests pass' on its own
    tells you very little".
  - "`/code-review` reviews the diff in a fresh subagent that never saw your conversation. It isn't swayed by the
    reasoning that produced the code."
  - "A reviewer that's asked to find problems will always find *something*. If you fix every finding, you end up
    with extra abstraction layers and tests for cases that can't happen."
  - "For one big mechanical change across many files, `/batch migrate every handler to the v2 response helpers`
    splits the work into 5 to 30 units and shows you the plan. Then it runs each unit in its own worktree and opens
    a PR for it."
  - Before leaving a task unattended: "1. Does it know what done looks like? A goal condition, a spec file, or a
    failing test it has to turn green. 2. Can it check its own work?"
  - Table "What you can stop doing": old advice *"The context window is your main constraint, manage it
    aggressively"* → "Most current models have a 1M-token window and compaction happens on its own, so running out
    is rare. `/clear` between tasks is still worth doing, because a focused context gets you better answers and
    costs less."
- S2 — https://code.claude.com/docs/en/common-workflows — Anthropic, "Common workflows". Refactor tips: "Do
  refactoring in small, testable increments"; "Request that changes maintain backward compatibility when needed".
- S3 — https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
  — Anthropic, "Prompting best practices", § Workflows across multiple context windows: "Use the first context
  window to set up a framework (write tests, create setup scripts), then use future context windows to iterate on
  a todo-list." "Ask Claude to create tests before starting work and keep track of them in a structured format (for
  example, `tests.json`)." "It is unacceptable to remove or edit tests because this could lead to missing or buggy
  functionality." § Avoid focusing on passing tests and hardcoding: "Claude can sometimes focus too heavily on
  making tests pass at the expense of more general solutions"; sample prompt: "Tests are there to verify
  correctness, not to define the solution."
- S4 — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents — Anthropic Engineering,
  2025-11-26. "the agent tended to try to do too much at once—essentially to attempt to one-shot the app";
  "These features were all initially marked as 'failing'"; "the next iteration of the coding agent was then asked
  to work on only one feature at a time"; "Every subsequent session asks the model to make incremental progress,
  then leave structured updates"; "By 'clean state' we mean the kind of code that would be appropriate for merging
  to a main branch"; "Claude tended to mark a feature as complete without proper testing"; "Self-verify all
  features. Only mark features as 'passing' after careful testing."
- S5 — https://claude.com/blog/ai-code-migration — Anthropic, "How Anthropic runs large-scale code migrations with
  Claude Code", 2026-07-16. "Work can be executed across thousands of independent units such as files and crates";
  "You need to understand file dependencies to effectively break up workstreams for a parallel migration"; "have a
  strong judge in place, otherwise you won't have an exit condition or measure of success"; "Agents perform their
  best when verification is objective"; "Two adversarial reviewers evaluate the work of the implementers using
  separate contexts"; "Let scripts — a compiler, a diff, a test suite — be the referee."; "Make review adversarial
  and verification mechanical."; "Make the work queue mechanical and resumable."; "Your original codebase is the
  ground truth either way."

**OpenAI / Codex**

- S6 — https://learn.chatgpt.com/guides/best-practices (308 target of
  `developers.openai.com/codex/learn/best-practices`) — OpenAI, Codex "Best practices". "This helps Codex stay
  scoped, make fewer assumptions, and produce work that's easier to review."; § Plan first for difficult tasks: "If
  the task is complex, ambiguous, or hard to describe well, ask Codex to plan before it starts coding."; § Improve
  reliability with testing and review: "Don't stop at asking Codex to make a change. Ask it to create tests when
  needed, run the relevant checks, confirm the result, and review the work before you accept it." "Codex can do
  this loop for you, but only if it knows what 'good' looks like." Prompt element "Done when: What should be true
  before the task is complete". A good `AGENTS.md` covers "Build, test, and lint commands", "What done means and how
  to verify work". "Keep one chat per coherent unit of work." Common mistakes: "Skipping planning on multi-step and
  complex tasks"; "Not letting the agent see its work by not giving details on how to best run build and test
  commands". The page has **no** sentence on task size or on test-first vs test-with.
- S7 — https://learn.chatgpt.com/docs/prompting (308 target of `developers.openai.com/codex/prompting`) — OpenAI,
  "Prompting". Fix-a-bug workflow: "Start by reproducing the bug locally, then propose a patch and run checks.";
  "Keep the fix minimal and add a regression test if feasible."; "After the fix, run lint + the smallest relevant
  test suite. Report the commands and results."; "For a multi-step task, enter `/plan` … when you want Codex to
  investigate and propose an approach before editing."
- S8 — https://learn.chatgpt.com/docs/agent-configuration/agents-md — OpenAI, AGENTS.md guide. Samples only
  ("Always run `npm test` after modifying JavaScript files."); nothing on task size or done criteria.
- S9 — https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide — OpenAI Cookbook, "GPT-5
  prompting guide" (undated). "we observe peak performance when distinct, separable tasks are broken up across
  multiple agent turns"; SWE-bench instructions: "Always verify your changes extremely thoroughly."; "not all tests
  are visible to you in the repository"; Terminal-Bench `<exploration>`: "Decompose the request into explicit
  requirements, unclear areas, and hidden assumptions."; "Formulate an execution plan: research steps,
  implementation sequence, and testing strategy"; `<verification>`: "Routinely verify your code works as you work
  through the task".
- S10 — https://agents.md/ — AGENTS.md spec (originated by OpenAI, "now stewarded by the Agentic AI Foundation").
  Sample: "Add or update tests for the code you change, even if nobody asked."; "Fix any test or type errors until
  the whole suite is green."; "The commit should pass all tests before you merge."
- **Could not open:** https://openai.com/index/introducing-codex/ (HTTP 403).

**Google**

- S11 — https://google.github.io/eng-practices/review/developer/small-cls.html — Google eng-practices, "Small
  CLs". "the right size for a CL is **one self-contained change**"; "100 lines is usually a reasonable size for a
  CL, and 1000 lines is usually too large"; "reviewers have discretion to reject your change outright for the sole
  reason of it being too large"; § Separate Out Refactorings: "It's usually best to do refactorings in a separate
  CL from feature changes or bug fixes."; § Keep related test code in the same CL: "Tests are expected for all
  Google changes." (independent test-only CLs may come first); § Don't Break the Build: "you need to find a way to
  make sure the whole system keeps working after each CL is submitted. Otherwise you might break the build for all
  your fellow developers for a few minutes between your CL submissions."; § **Splitting Horizontally**: "Consider
  creating shared code or stubs that help isolate changes between layers of the tech stack."; § **Splitting
  Vertically**: "Each of these features can be independent parallel implementation tracks."; § Splitting by Files:
  "Another way to split up a CL is by groupings of files that will require different reviewers"; § Can't Make it
  Small Enough: "This is very rarely true. Authors who practice writing small CLs can almost always find a way to
  decompose functionality."; "consider whether preceding it with a refactoring-only CL could pave the way for a
  cleaner implementation".
- S12 — https://abseil.io/resources/swe-book/html/ch09.html — *Software Engineering at Google*, ch. 9 Code Review.
  "Probably the most important practice to keep the code review process nimble is to keep changes small."; "'Small'
  changes should generally be limited to about 200 lines of code."; "Any behavioral modifications should
  necessarily include revisions to appropriate tests for any new API behavior."
- S13 — https://abseil.io/resources/swe-book/html/ch22.html — SWE at Google, ch. 22 Large-Scale Changes. LSC = "any
  set of changes that are logically related but cannot practically be submitted as a single atomic unit"; "the
  largest atomic change possible counterintuitively decreases" as the codebase grows; "Splitting the large change
  into smaller, independent chunks gets around these limitations"; "For any LSC process, individual shards should
  be committable independently."; Rosie "shards it based upon project boundaries and ownership rules into changes
  that can be submitted atomically"; the `scoped_ptr` migration: "first making it a type alias of std::unique_ptr",
  then "performing the textual substitution between the old alias and the new", "before eventually just removing
  the old scoped_ptr alias"; "When software is thoroughly tested, we can make arbitrary changes to it".
- S14 — https://abseil.io/resources/swe-book/html/ch11.html — ch. 11 Testing Overview. "every change is expected to
  include both the feature code and tests."; "test everything that you don't want to break" (the Beyoncé Rule);
  "around 80% of our tests being narrow-scoped unit tests". **The chapter does not mention test-first or TDD.**
- S15 — https://abseil.io/resources/swe-book/html/ch12.html — ch. 12 Unit Testing. "rather than writing a test for
  each method, write a test for each behavior."; "write tests that invoke the system being tested in the same way
  its users would"; "the ideal test is unchanging"; "interaction tests check how a system arrived at its result,
  whereas usually you should care only what the result is."; tests should be "easy to write at the same time as
  the code they're testing". No test-first statement.
- S16 — https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html — Google Testing Blog,
  "Change-Detector Tests Considered Harmful", 2015-01-27, Alex Eagle. **Body not retrievable through this tool**
  (only title, date and comments came back); title and thesis relied on from the comments quoting it.
- S17 — https://testing.googleblog.com/2013/08/testing-on-toilet-test-behavior-not.html — "Test Behavior, Not
  Implementation", 2013-08-05, Andrew Trenk. Body not retrievable; a comment quotes it: "the actual test itself
  typically shouldn't need to change if the code's user-facing behavior doesn't change".

**Meta**

- S18 — https://engineering.fb.com/2022/11/15/open-source/sapling-source-control-scalable/ — Engineering at Meta,
  "Sapling: Source control that's user-friendly and scalable", 2022-11-15. "an engineer building a feature will
  send out the small first step of that feature as a commit for code review"; "they will start on the next step as
  a second commit that will later be sent for code review as well"; "A full feature will consist of many of these
  small, incremental, individually reviewed commits on top of one another."; "Commits become smaller, easier to
  reason about, and easier to review."; amending a mid-stack commit "automatically moves, or rebases, the top of
  your stack onto the newly amended commit".
- S19 — https://developers.facebook.com/blog/post/2022/11/15/meta-developers-workflow-exploring-tools-used-to-code/
  — Meta for Developers, "A Meta developer's workflow", 2022-11-15, Neil Mitchell. "often we submit stacks of
  diffs—a series of changes, each standing alone but also building on the previous changes."; Phabricator "allows
  developers to navigate through the stack of diffs and lets you comment on and approve a diff"; "Phab also takes
  care of running all the tests".
- S20 — https://engineering.fb.com/2017/08/31/web/rapid-release-at-massive-scale/ — Engineering at Meta, Chuck
  Rossi, 2017-08-31. "The changes that get made in this quasi-continuous delivery mode are generally small and
  incremental"; "Many of the changes are initially kept behind our Gatekeeper system"; Gatekeeper "allows us to roll
  out mobile and web code releases independently from new features"; "we can simply switch the gatekeeper off
  rather than revert back to a previous version"; "pushes tens to hundreds of diffs every few hours".
- S21 — https://engineering.fb.com/2023/06/27/developer-tools/meta-developer-tools-open-source/ — "Meta developer
  tools: Working at scale", 2023-06-27. Only: Phabricator "helps our developers review and submit stacks of diffs."

**Practitioner primaries behind the recommendation's TDD claims**

- S22 — https://newsletter.kentbeck.com/p/canon-tdd (301 from tidyfirst.substack.com) — Kent Beck, "Canon TDD",
  2023-12-11. Steps: "Write a list of the test scenarios you want to cover"; "Turn exactly one item on the list into
  an actual, concrete, runnable test"; "Change the code to make the test (& all previous tests) pass (adding items
  to the list as you discover them)"; "Optionally refactor to improve the implementation design"; "Until the list is
  empty, go back to #2". Mistakes: "mixing in implementation design decisions" (into the list); "**convert all the
  items on the Test List into concrete tests, then make them pass one at a time**"; "write tests without assertions
  just to get code coverage"; "copying actual, computed values & pasting them into the expected values of the
  test"; "mixing refactoring into making the test pass"; "refactoring further than necessary for this session";
  "abstracting too soon".
- S23 — https://martinfowler.com/bliki/ParallelChange.html — Danilo Sato on martinfowler.com, 2014-05-13. "Parallel
  change, also known as expand and contract, is a pattern to implement backward-incompatible changes to an
  interface in a safe manner, by breaking the change into three distinct phases: expand, migrate, and contract."
  "In the expand phase you augment the interface to support both the old and the new versions." "During the
  migrate phase you update all clients using the old version to the new version." "Once all usages have been
  migrated to the new version, you perform the contract phase to remove the old version".

**Not consulted (noting the gap):** Matt Pocock's `tdd` / `to-tickets` skill sources themselves (the
recommendation's own citation); SWE at Google ch. 24 (continuous delivery, flags). Third-party write-ups
(Pragmatic Engineer on stacked diffs, Maxim, DataCamp) surfaced in search and were **not** relied on.

---

### 2. Per-claim verdicts

#### Claim 1.1 — Ticket level: vertical slicing is the default; each ticket is a narrow complete path through every layer, demoable and landable alone, sized to one context window, with explicit blocking edges; prefactoring first.

**Verdict: QUALIFY** (the direction is right; three of the qualifiers are not what the sources say).

- *Vertical as default.* Google names both as ordinary techniques under separate headings, "Splitting
  Horizontally" (stubs between layers) and "Splitting Vertically" (features as "independent parallel implementation
  tracks"), plus "Splitting by Files" by reviewer ownership (S11). It states **no default**; the governing rule is
  "one self-contained change" of ~100 lines (S11) / ~200 (S12). Meta's stack is a feature cut into "small,
  incremental, individually reviewed commits on top of one another" (S18), which is vertical-in-spirit but each
  step need not cross every layer. Anthropic's long-running-agent harness is explicitly one feature at a time with
  each feature in a mergeable "clean state" (S4). Vertical-by-default is defensible for a product repo like mdpro,
  but it is a choice, not something the four companies prescribe. The source that decides: S11.
- *"Demoable" alone.* Not required by any source. Meta lands increments "behind our Gatekeeper system" and ships
  releases "independently from new features" (S20); Google lands API additions with "a usage of them" but behind
  stubs (S11). The real requirements are **landable alone, green alone, and verifiable alone** ("Give Claude
  something it can run that comes back pass or fail", S1; "what done means and how to verify work", S6). Replace
  "demoable" with "verifiable by a check that returns pass/fail", and allow a flag or stub to make a slice landable
  before it is user-visible.
- *"Sized to one context window."* Anthropic's current best-practices page lists "The context window is your main
  constraint, manage it aggressively" under **"What you can stop doing"**: running out "is rare", though `/clear`
  between tasks still helps because "a focused context gets you better answers" (S1). OpenAI says "Keep one chat
  per coherent unit of work" (S6) and "peak performance when distinct, separable tasks are broken up across
  multiple agent turns" (S9). So the size driver is **one coherent, reviewable, verifiable unit** (Google: ~100–200
  lines by reviewer discretion), with the fresh context as a hygiene benefit, not the sizing unit. Source: S1, S11.
- *Explicit blocking edges.* AGREE. Meta's stack is exactly this ("each standing alone but also building on the
  previous changes", S19); Google's "Don't Break the Build" demands the order be chosen so the system works after
  each submission (S11); Anthropic's migration post: "You need to understand file dependencies to effectively break
  up workstreams" (S5).
- *Prefactoring first.* AGREE. "It's usually best to do refactorings in a separate CL from feature changes or bug
  fixes" and "preceding it with a refactoring-only CL could pave the way for a cleaner implementation" (S11); "Do
  refactoring in small, testable increments" (S2).

**What this claim misses:** (a) Google's split-by-reviewer-ownership axis (S11), which for mdpro maps onto the
audit-tier split: a `src-tauri` change and its frontend consumer can be two tickets so the High-tier audit stays
narrow; (b) feature flags as the standard way to land a non-demoable vertical slice (S20); (c) a scope note from
Anthropic that cuts the other way: Claude "build[s] the smallest thing that satisfies" a request, so a ticket must
spell out the edge cases it wants, or a "narrow" slice comes back narrower than intended (S1).

#### Claim 1.2 — Horizontal slicing is the exception, only for a wide refactor; expand–contract; batches sized by blast radius, each its own ticket, CI green throughout; contract when no caller remains; if batches cannot stay green alone they share an integration branch closed by a verify ticket (user ruling needed because rule 12 forbids it).

**Verdict: QUALIFY on "only"; AGREE on expand–contract; DISAGREE on the integration-branch fallback.**

- *"Only for a wide refactor."* Google uses horizontal splitting (stubs isolating "layers of the tech stack") as a
  normal way to get independent parallel tracks, not an emergency measure (S11). Google's own distinction is not
  "refactor vs feature" but whether the change "cannot practically be submitted as a single atomic unit" (S13);
  that is what makes it an LSC. The recommendation should say: horizontal is the normal cut when the natural unit is
  a layer contract (an IPC command, a persisted format, a store shape) and a stub lets the layers proceed in
  parallel; and it is the **required** cut for an LSC. Source: S11, S13.
- *Expand–contract.* AGREE, and the recommendation should cite it by its primary name: Parallel Change (S23), with
  Google's `scoped_ptr` alias → substitute → remove as the worked LSC instance (S13). Anthropic concurs for agents:
  "Request that changes maintain backward compatibility when needed" (S2).
- *Batches sized by blast radius, each its own ticket.* AGREE in substance; the sources size shards by **ownership
  and reviewability** ("shards it based upon project boundaries and ownership rules into changes that can be
  submitted atomically", S13; "groupings of files that will require different reviewers", S11) and Anthropic's
  `/batch` by independent unit ("5 to 30 units … each unit in its own worktree and opens a PR for it", S1). Blast
  radius is a reasonable proxy but ownership/reviewer boundary is the stated criterion. "CI green throughout" is
  exactly Google's "individual shards should be committable independently" (S13) and Meta's per-diff test run
  (S19).
- *Integration branch when batches cannot stay green.* DISAGREE. None of the four uses one. Google's answer when
  a change "can't be made small enough" is: "This is very rarely true"; pave with a refactoring-only CL, use stubs,
  or get reviewers' agreement in advance for a large CL (S11), and "find a way to make sure the whole system keeps
  working after each CL is submitted" (S11). Meta's stack *is* the integration structure, but every diff in it
  still lands onto main individually after its own tests (S18, S19), and non-ready behaviour is hidden by
  Gatekeeper (S20). Anthropic's migration ran a mechanical queue with "a compiler, a diff, a test suite" as referee
  per unit (S5). The correct fallback is therefore: a wider **expand** step (alias, adapter, flag, stub) that makes
  each batch green on its own; failing that, one larger pre-agreed PR. mdpro's rule 12 prohibition is consistent
  with all four, so the "goes to the user" clause is right only as a last resort, and the request to the user should
  offer the flag/adapter option first.

**What this claim misses:** Rosie-style mechanical sharding and Anthropic's `/batch` (S1, S13) — an LSC's batches
should be generated by a script from a dependency scan, not hand-sized; and the LSC-specific test strategy: for a
mechanical change most affected tests pass, so the gate is the union of directly affected tests per shard (S13),
which argues for mdpro's "re-run only the decisive test files" by tree identity rather than full lanes per batch.

#### Claim 2.1 — Implementation level: vertical = one case → one RED → minimal change → green → next; horizontal = all tests and all REDs first, then implement, named an anti-pattern.

**Verdict: AGREE for unit-level TDD; QUALIFY for the agent-era test scaffold.**

- The anti-pattern is primary-sourced almost word for word: Beck lists as a Canon-TDD mistake "convert all the
  items on the Test List into concrete tests, then make them pass one at a time" (S22). The reasons the
  recommendation gives line up with Beck's "mixing in implementation design decisions" and with Google's
  behaviour-not-method and "unchanging tests" guidance (S15) and change-detector warning (S16): tests written in
  bulk before the shape is known tend to assert the imagined structure.
- But the agent vendors **do** ask for an executable test scaffold up front. Anthropic: "Use the first context
  window to set up a framework (write tests, create setup scripts)"; "Ask Claude to create tests before starting
  work and keep track of them in a structured format (for example, `tests.json`)" (S3); the harness post starts
  with every feature "marked as 'failing'" and works one at a time (S4); the bug recipe is "write a failing test
  that reproduces it, then fix it" (S1). The way to reconcile this with Beck is the level of the test: the up-front
  set is the **acceptance judge** (end-to-end features, the reproduction test, `tests.json`), which Anthropic also
  guards against being gamed ("Tests are there to verify correctness, not to define the solution", S3); the
  per-cycle tests are the unit tests. The recommendation names the anti-pattern correctly but should say which
  tests it applies to. OpenAI is neutral: "create tests when needed" (S6), "add a regression test if feasible"
  (S7). Google requires tests *with* the change and never states an order (S11, S14, S15).
- The RED receipt itself has no counterpart in any source; the nearest is Anthropic's "ask Claude for *evidence*:
  the command it ran and its output" (S1) and OpenAI's "Report the commands and results" (S7). The receipt is an
  mdpro-local strengthening, consistent with both, not a vendor practice.

#### Claim 2.2 — Best practice: design all at once (test matrix as a list of cases, not code), independent attacker hunts for wrong implementations that pass every case, then implement strictly in cycles each with its own RED receipt, refactor only when green in the review stage, matrix amendable.

**Verdict: AGREE on list-first, attack and amendability; QUALIFY on refactor timing.**

- *Matrix as a list, not code, written first.* AGREE — this is Beck's step 1, and his first mistake is putting
  implementation decisions into that list (S22). Anthropic's `tests.json` and failing-feature list are the same
  artefact in agent form (S3, S4). OpenAI's "Done when: What should be true before the task is complete" (S6) is the
  prose equivalent.
- *Independent attack of the matrix.* AGREE. Anthropic: "Two adversarial reviewers evaluate the work of the
  implementers using separate contexts"; "Make review adversarial and verification mechanical" (S5); `/code-review`
  "in a fresh subagent that never saw your conversation. It isn't swayed by the reasoning that produced the code"
  (S1). The failure mode the attack targets is documented by Anthropic ("focus too heavily on making tests pass at
  the expense of more general solutions", S3) and OpenAI ("not all tests are visible to you in the repository",
  S9). Google's test guidance explains *what* a wrong-but-passing implementation exploits: method-shaped and
  interaction-shaped tests (S15). One caution from S1 that the recommendation should carry: an attacker "asked to
  find problems will always find *something*", so amendments need the counter-proof discipline the brief already
  has, or the matrix fills with "tests for cases that can't happen".
- *Cycles, each with a RED.* AGREE per S22 steps 2–3 and 5 (with the receipt as mdpro's evidence layer, see 2.1).
- *Refactor only when green, in the review stage.* QUALIFY. Beck's refactor is step 4 of **every** cycle,
  optional and bounded ("refactoring further than necessary for this session" and "abstracting too soon" are
  mistakes; so is "mixing refactoring into making the test pass", S22). Google separates refactorings into their
  **own CL**, usually preceding the feature (S11), and Anthropic says "small, testable increments" (S2). None of
  them defers all refactoring to a review stage at the end. Deferring to review has a concrete cost in mdpro: the
  review-stage refactor lands in the same PR as the behaviour, which Google's "Separate Out Refactorings" argues
  against for reviewability, and it is the moment an agent is most likely to over-abstract on reviewer findings
  (S1). Better: refactor per cycle while green, bounded to that cycle, and anything larger becomes a
  prefactoring ticket.
- *Matrix amendable during cycles.* AGREE — Beck: "adding items to the list as you discover them" (S22).

#### Claim 2.3 — Sources: Matt Pocock's `tdd` and `to-tickets` skills (mattpocock/skills 1.3.x).

**Verdict: QUALIFY.** These are secondary operationalisations. The primaries the recommendation actually rests
on are Beck's Canon TDD (S22) for the implementation level, Google's Small CLs (S11) and LSC chapter (S13) for the
ticket level, and Sato/Fowler's Parallel Change (S23) for expand–contract. Citing them makes the recommendation
auditable and removes the dependency on a skill version.

---

### 3. Where the four companies disagree with each other

1. **Test-first vs test-with.** Anthropic is the only one that tells the agent to write tests *before* starting
   (S1, S3, S4). Google requires tests in the same change and is silent on order (S11, S14); its unit-testing
   chapter says tests are "easy to write at the same time as the code" (S15). OpenAI says "create tests when
   needed" and "regression test if feasible" (S6, S7). Meta says only that Phabricator runs the tests (S19).
2. **Change size.** Google puts numbers on it: ~100 lines (S11), ~200 (S12), with reviewer veto. Meta: "small and
   incremental", no number (S20). Anthropic sizes by unit of work (`/batch` 5–30 units) and warns the model
   under-scopes unless told to "be ambitious" (S1), a pull in the opposite direction from Google's "smallest
   self-contained change". OpenAI: "one chat per coherent unit of work" (S6).
3. **The context window as a sizing unit.** Anthropic has retired it (S1). OpenAI still talks about separable tasks
   across turns and reasoning effort per task (S6, S9). Neither Google nor Meta speaks to it.
4. **Horizontal splitting.** Google treats it as a normal technique with stubs (S11). The three agent vendors never
   name it; Anthropic's harness and `/batch` are feature-wise or unit-wise (S1, S4).
5. **How non-ready work reaches trunk.** Meta: feature flags (Gatekeeper, S20). Google: stubs/aliases and
   independently committable shards (S11, S13). Anthropic: each unit its own PR, "clean state" per feature (S1,
   S4). Nobody uses an integration branch.
6. **Refactor timing.** Google: separate CL, usually before (S11). Beck (the TDD primary): inside each cycle,
   optional, bounded (S22). The agent vendors: "small, testable increments" (S2), no stage named.
7. **Verification evidence.** Anthropic and OpenAI both want commands and outputs reported (S1, S7); Google and Meta
   rely on the review tool running tests (S11, S19). Only Anthropic adds a second, context-isolated reviewer as a
   standing practice (S1, S5).

---

### 4. Revised best practice for mdpro (one paragraph)

Cut tickets by **one self-contained, independently landable and independently verifiable change**, not by context
window: default to a vertical slice when the unit is a behaviour, to a horizontal slice behind a stub, alias or
flag when the unit is a layer contract (IPC command, persisted format, store shape) or when the change is an LSC
(cannot land atomically); size each by reviewability (~100–200 lines, Google) and by audit-tier boundary (a
`src-tauri`/`src/services` change and its UI consumer are two tickets so the High-tier audit stays narrow); make
refactoring its own prefactoring ticket; for an LSC use Parallel Change (expand → migrate in script-sharded batches
each green and landed alone → contract), and when a batch cannot stay green widen the expand step (adapter, alias,
flag) rather than open an integration branch, taking only the residual case to the user with that alternative
offered first. At the implementation level keep Canon TDD: write the matrix as a list of behaviours (no
implementation shape), have a context-isolated attacker hunt for passing-but-wrong implementations and accept its
additions only with a counter-proof discipline so the matrix does not fill with impossible cases, then run one
case → one RED receipt → minimal change → green → **bounded refactor while green in that cycle**, amending the
matrix as cases surface, with the acceptance judge (device cards, `tests.json`-style end-to-end checks, the
reproduction test for a bug) allowed to exist first because it is the exit condition, not the design. Every cycle
reports its evidence (command and decisive output, which the receipt already pins), the committed candidate gets a
review from a context that did not write it, and fast-forward-only landing stays the integration mechanism, with a
stack of dependent tickets (Meta-style blocking edges) as the only multi-PR structure.

---

### Limits of this review

Pages I could not open or only partially: `openai.com/index/introducing-codex` (403); the April-2025 Anthropic
best-practices original (archive blocked; its TDD section is known to me but not re-verified today); the two Google
TotT bodies (S16, S17: title/date/comments only); SWE at Google ch. 24 (not fetched). Meta's engineering blog has
no dedicated stacked-diffs post; the stack workflow is sourced from the Sapling post (S18) and Meta for Developers
(S19). The recommendation's own cited source (Matt Pocock's skills) was not re-read; I compared it to the primaries
it derives from.
