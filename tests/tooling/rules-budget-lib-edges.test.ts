// @vitest-environment node
// D355 code-review fixes (S4–S6): the checker's edges, on fixture trees and pure inputs.
import { afterAll, expect, it } from "vitest";
import { githubSlug, readBlocks, resolveRel } from "./rules-budget-lib";
import { cleanupFixtures, fixture } from "./rules-budget-fixture";

afterAll(cleanupFixtures);

it("S4: GitHub's slug keeps intraword and code underscores and drops emphasis underscores", () => {
  expect(githubSlug("Step 1: Add HTTP endpoint (in `http_server.rs`)")).toBe("step-1-add-http-endpoint-in-http_serverrs");
  expect(githubSlug("snake_case word")).toBe("snake_case-word");
  expect(githubSlug("`__init__` hook")).toBe("__init__-hook");
  expect(githubSlug("_emph_ title")).toBe("emph-title");
});

it("S5: a malformed percent sequence resolves literally instead of throwing, so the scan names the file", async () => {
  let resolved: string | null = null;
  expect(() => { resolved = resolveRel("/r", "docs/a.md", "notes-100%.md#x"); }).not.toThrow();
  expect(resolved).toBe("docs/notes-100%.md");
  const root = await fixture({
    "docs/a.md": "<!-- read-every-session:begin -->\n- [n](notes-100%.md)\n<!-- read-every-session:end -->\n",
  });
  expect(readBlocks(root, "docs/a.md").errors).toEqual([
    "docs/a.md:2: read-block entry names no existing file: - [n](notes-100%.md)",
  ]);
});

it("S6: a read-block entry that is not Markdown is an error, so land-guard's Markdown trigger covers every counted file", async () => {
  const root = await fixture({
    "docs/a.md": "<!-- read-every-session:begin -->\n- [m](b.md)\n- [j](c.json)\n<!-- read-every-session:end -->\n",
    "docs/b.md": "b\n",
    "docs/c.json": "{}\n",
  });
  const block = readBlocks(root, "docs/a.md");
  expect(block.entries).toEqual(["docs/b.md"]);
  expect(block.errors).toEqual(["docs/a.md:3: read-block entry is not a Markdown file: - [j](c.json)"]);
});
