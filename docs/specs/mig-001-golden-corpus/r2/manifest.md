# MIG-001 Golden Corpus spec snapshot r2 (2026-11-08)

A frozen copy of the issue bodies as edited for r2 (rule 12, ADR-0148). It supersedes r1
(`docs/specs/mig-001-golden-corpus/r1/`, unchanged). Any later normative edit to an issue below is `r3`, which needs
re-approval and a plan review of its diff against this revision.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#705](https://github.com/anzchy/mdpro/issues/705) | `527c8a07cb93f362ccbfc0a5f637e131beeb82227e1bf890a155efe1a258666d` |
| `tickets/MIG-001a.md` | [#706](https://github.com/anzchy/mdpro/issues/706) | `1705f538a955ab23f559de5183629e77b00abe008b286dcdcdb79c8a82363793` |
| `tickets/MIG-001b.md` | [#707](https://github.com/anzchy/mdpro/issues/707) | `958e5a1f4464bb31da0a72a1ba7f51dd7ab7845802072edc628cccf70f08c1d3` |
| `tickets/MIG-001c.md` | [#708](https://github.com/anzchy/mdpro/issues/708) | `c468d767a6a623b3c188e1ede4753af212a50e54f6e5de1392f4411e4fd47f5d` |
| `tickets/MIG-001d.md` | [#709](https://github.com/anzchy/mdpro/issues/709) | `5cf8f98c716d1ce07467e17e39103de3d64ecadaeb097cb260286be96e9b8a9b` |
| `tickets/MIG-001e.md` | [#710](https://github.com/anzchy/mdpro/issues/710) | `9f66fc5057ce4f9817175f9a7fd0d8ea779c2b03e0d719b3f735cda1fb89ba85` |
| `tickets/MIG-001f.md` | [#711](https://github.com/anzchy/mdpro/issues/711) | `2e89ef493ec2917780d6878c9353e2def2d47ebc3baf13721a787264ce7d2c67` |
| `tickets/MIG-001g.md` | [#712](https://github.com/anzchy/mdpro/issues/712) | `c077c09dfdb988a2c8795c78ca6579d465f06e975a3f76f8273b0c51136d83ef` |
| `tickets/MIG-001h.md` | [#713](https://github.com/anzchy/mdpro/issues/713) | `f7569a7d9a8d2a81268a4902947df0b12fce105579e51da9678acf84c119c28c` |
| `tickets/MIG-001i.md` | [#714](https://github.com/anzchy/mdpro/issues/714) | `8e84822c054d984200980f8dfdbed94e671acb36a5c285b138a86b0d45b9738f` |
| `tickets/MIG-001j.md` | [#715](https://github.com/anzchy/mdpro/issues/715) | `8e4b587f2632375d61e8eae01c610a496b9269fc8a07cc55023e43a498c5a92e` |
| `tickets/MIG-001k.md` | [#716](https://github.com/anzchy/mdpro/issues/716) | `9efefc5637270000aa9bd598f062bf49f449314804c10ee6ee2128d63cf1046d` |
| `tickets/MIG-001l.md` | [#717](https://github.com/anzchy/mdpro/issues/717) | `4b3230f95dc43f06127952f6063271f225646261b6afbc74a5e8bc947a4225e5` |
| `tickets/MIG-001m.md` | [#718](https://github.com/anzchy/mdpro/issues/718) | `e1771f5d36acf7c256f804d2eddd0b95226b64ba1734e72daacc26b540641a7d` |
| `tickets/MIG-001n.md` | [#719](https://github.com/anzchy/mdpro/issues/719) | `cfb45a39eae82f6ab3b2111a57c69b6f6635b5b5775c9c13e9483ddb00c47483` |

Each file is the issue body as `gh issue view <n> --json body --jq .body` returned it on 2026-11-08.

## Approval words (user, 2026-11-08)
- Rulings to the delegator (quoted in the revise brief): MH3 「Content-level + device card (Recommended)」; MH4
  「Add activate-link action (Recommended)」; MH1 (c) 「Either side passes (Recommended)」.
- Planner-pane questions Q1–Q6 (MM3 baseline, MM4 restored topics, MM10 placement, scroll-anchor card owner, CI
  ceilings, slow tier): 「全部 yes」.
- r2 re-approval: 「yes」.

## Blocking edges
- Native, unchanged from r1: MIG-001b…n (#707–#719) ← MIG-001a (#706) (e.g. #719 blocked_by [706]). Unblocked: #706.

## Related
- Parent: spec #705, a sub-issue of row #697. Merged plan review r1: C0 H4 M10 L8 (delegator `mig-001/r1-merged.md`).
- Findings map: `~/.mdpro-redesign/planner/mig-001-golden-corpus/r2/findings-map.md`.
- No ADR. Classification point for the delegator: the manifest-validation test in the existing shards.
- Title changes: #705 "(r1)" → "(r2)"; #719 "TOC, find/replace and scroll anchor" → "TOC and find/replace".
