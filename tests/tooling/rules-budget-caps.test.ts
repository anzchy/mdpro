// @vitest-environment node
// D355 ruling 3 (S10): which cap a route is held to. An ordinary auditor route is held to 50,000 B and a policy-routed
// one (its start names docs/agents/audit-policy-set.md) to 56,000 B; the live gate decides "over" only through overCaps.
import { afterAll, expect, it } from "vitest";
import { capOf, overCaps, POLICY_SET, route, ROUTES, type RouteCaps, type RouteDef } from "./rules-budget-lib";
import { cleanupFixtures, fixture } from "./rules-budget-fixture";

afterAll(cleanupFixtures);

const CAPS: RouteCaps = {
  role: { implementor: 48_000, auditor: 50_000, device: 42_000, delegator: 50_000 },
  policyAuditor: 56_000,
};
const A = ["docs/agents/auditor.md", "t/audit.md"];
const R: Record<string, RouteDef> = {
  "auditor-audit": { role: "auditor", start: A },
  "auditor-audit-policy": { role: "auditor", start: [...A, POLICY_SET] },
  "implementor-brief": { role: "implementor", start: ["docs/agents/implementor.md"] },
};

it("P3': capOf is the policy cap exactly when the route's start names the policy set, else its role's cap", () => {
  expect(capOf("auditor-audit", CAPS, R)).toBe(50_000);
  expect(capOf("auditor-audit-policy", CAPS, R)).toBe(56_000);
  expect(capOf("implementor-brief", CAPS, R)).toBe(48_000);
});

it("P3': an ordinary auditor route at 52,000 B is over; a policy-routed one is over only past 56,000 B", () => {
  expect(overCaps([["auditor-audit", "claude", 52_000]], CAPS, R)).toEqual(["auditor-audit (claude)"]);
  expect(overCaps([["auditor-audit-policy", "claude", 52_000]], CAPS, R)).toEqual([]);
  expect(overCaps([["auditor-audit-policy", "claude", 56_000]], CAPS, R)).toEqual([]);
  expect(overCaps([["auditor-audit-policy", "codex", 56_001]], CAPS, R)).toEqual(["auditor-audit-policy (codex)"]);
  expect(overCaps([["implementor-brief", "codex", 48_001], ["auditor-audit", "codex", 50_000]], CAPS, R))
    .toEqual(["implementor-brief (codex)"]);
});

it("P3'/P7: every live route's cap follows from its definition, and each policy route is its ordinary route plus the policy set", () => {
  for (const kind of ["audit", "confirm", "challenge", "plan"]) {
    const p = ROUTES[`auditor-${kind}-policy`];
    expect(p, `auditor-${kind}-policy is a route`).toBeDefined();
    expect(p.role).toBe("auditor");
    expect(p.start).toEqual([...ROUTES[`auditor-${kind}`].start, POLICY_SET]);
  }
  for (const [name, def] of Object.entries(ROUTES)) {
    expect(capOf(name, CAPS), name).toBe(def.start.includes(POLICY_SET) ? 56_000 : CAPS.role[def.role]);
  }
});

it("P6: a policy route whose policy set is missing names it as a route error", () => {
  const root = fixture({
    "CLAUDE.md": "c", "AGENTS.md": "<!-- read-every-session:begin -->\n- [c](CLAUDE.md)\n<!-- read-every-session:end -->\n",
    "docs/agents/auditor.md": "a", ".agents/skills/mdpro-delegator/references/templates/audit-request-template.md": "t",
  });
  expect(route(root, "auditor-audit-policy", "claude").errors)
    .toContain(`route auditor-audit-policy: ${POLICY_SET} missing`);
});
