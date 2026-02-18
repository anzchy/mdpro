# 10 - TDD Workflow

Test-Driven Development is the standard workflow for mdpro. Tests use Vitest with jsdom. Run with `pnpm test:run`.

## Core Discipline: RED → GREEN → REFACTOR

1. **RED** — Write a failing test that describes the expected behavior.
2. **GREEN** — Write the minimum code to make the test pass.
3. **REFACTOR** — Clean up without changing behavior. Tests must still pass.

Never skip RED. If you write code first, you don't know your test actually catches regressions.

## When Tests Are Required

| Category | Required? | Examples |
|----------|-----------|---------|
| Stores | **ALWAYS** | State transitions, selectors, persistence |
| Hooks | **ALWAYS** | Side effects, event handling, lifecycle |
| Utils / helpers | **ALWAYS** | Pure functions, parsers, formatters |
| Rust commands | **ALWAYS** | Input validation, error paths |
| Business logic | **ALWAYS** | Close decisions, save logic, merge rules |
| Bug fixes | **ALWAYS** | Regression test proving the fix |
| Edge cases | **ALWAYS** | Empty input, null, boundary values |
| CSS-only changes | No | Visual QA with reference doc instead |
| Docs / config | No | Markdown, JSON, TOML changes |
| Type-only changes | No | Interface/type additions with no runtime effect |
| Components | Case-by-case | Test behavior (clicks, ARIA), not rendering |
| Plugins (Milkdown/CM) | Case-by-case | Test logic (transforms, state), not editor integration |

## Pattern Catalog

Five patterns covering the most common test types in mdpro. Use these as templates.

### 1. Store Tests — `src/stores/**/*.test.ts`

```ts
import { useDocumentStore } from "../documentStore";

beforeEach(() => {
  // Reset store between tests — isolation is critical
  useDocumentStore.setState({ documents: [] });
});

it("adds a document to the store", () => {
  const { addDocument } = useDocumentStore.getState();
  addDocument({ id: "doc-1", content: "# Hello" });
  const docs = useDocumentStore.getState().documents;
  expect(docs).toHaveLength(1);
});
```

**Key patterns:**
- Use `getState()` to call actions — no React rendering needed.
- Reset state in `beforeEach` to isolate tests.
- Test state transitions, not implementation details.

### 2. Plugin Tests — `src/plugins/**/*.test.ts`

```ts
// For Milkdown/CodeMirror plugins, test the logic layer
// not the editor integration itself
import { myPluginLogic } from "./myPlugin";

it("transforms heading markup correctly", () => {
  const result = myPluginLogic("## Hello");
  expect(result.level).toBe(2);
  expect(result.text).toBe("Hello");
});
```

**Key patterns:**
- Extract testable logic from plugin wiring.
- Test transforms and state changes, not editor DOM.
- Mock editor APIs at boundaries.

### 3. Hook Tests — `src/hooks/**/*.test.tsx`

```tsx
import { renderHook } from "@testing-library/react";
import { useMenuEvents } from "./useMenuEvents";

const mockListen = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

it("registers menu event listeners", () => {
  renderHook(() => useMenuEvents());
  expect(mockListen).toHaveBeenCalledWith(
    expect.stringMatching(/^menu:/),
    expect.any(Function)
  );
});
```

**Key patterns:**
- Mock external dependencies (Tauri, DOM APIs).
- Use `renderHook` — no need for a full component.
- Test that effects register/cleanup correctly.

### 4. Component Tests — `src/components/**/*.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

it("toggles bold on button click", async () => {
  const user = userEvent.setup();
  render(<UniversalToolbar />);
  const boldBtn = screen.getByRole("button", { name: /bold/i });
  await user.click(boldBtn);
  expect(boldBtn).toHaveAttribute("aria-pressed", "true");
});
```

**Key patterns:**
- Query by ARIA role/name — not CSS class or test-id.
- Use `userEvent` (not `fireEvent`) for realistic interaction.
- Test behavior (click → state change), not rendering details.
- Use `vi.hoisted()` when mock setup needs to run before imports.

### 5. Utils / Service Tests — `src/services/**/*.test.ts`

```ts
import { parseHeadings } from "./tocService";

describe("parseHeadings", () => {
  it.each([
    { md: "# H1",       expected: [{ level: 1, text: "H1" }] },
    { md: "## H2\n### H3", expected: [{ level: 2, text: "H2" }, { level: 3, text: "H3" }] },
    { md: "",            expected: [] },
  ])("parses: $md", ({ md, expected }) => {
    expect(parseHeadings(md)).toEqual(expected);
  });
});
```

**Key patterns:**
- Table-driven tests with `it.each` — exhaustive, readable.
- Pure functions = no mocking needed.
- Cover all branches in one `describe` block.

## Anti-Patterns — What NOT to Do

| Anti-pattern | Why it's wrong | Do this instead |
|-------------|----------------|-----------------|
| Write code first, tests after | You can't verify your test catches regressions | RED first — always |
| `it("renders without crashing")` | Tests nothing meaningful | Test specific behavior or output |
| Testing implementation details | Breaks on refactor | Test observable behavior (state, output, DOM) |
| Mocking everything | Tests prove nothing | Mock boundaries (APIs, filesystem), not logic |
| Skipping edge cases | Bugs live at boundaries | Empty input, null, max values, concurrent access |
| Snapshot tests for logic | Brittle, auto-updated without review | Use explicit assertions |
| `any` in test types | Hides type errors | Use proper types even in tests |

## Running Tests

```bash
pnpm test:run          # Run all tests once
pnpm build             # Frontend build (tsc + vite)
cd src-tauri && cargo test  # Rust backend tests
cd src-tauri && cargo check # Rust compilation check
```

## File Placement

- Tests go next to the source: `foo.test.ts` beside `foo.ts`
- Larger test suites use `__tests__/` subdirectory
- Shared test helpers go in `src/test/`
