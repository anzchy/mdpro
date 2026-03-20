---
max_pure_loc: 300
---

# loc-guardian Extraction Rules

## TypeScript / React (src/)

- **Types/interfaces** → `types.ts` in same directory
- **Constants & config objects** → `constants.ts`
- **Pure utility functions** → `utils.ts` or `<name>Utils.ts`
- **Sub-components** → new `<ComponentName>.tsx` file
- **Custom hooks** → `use<Name>.ts` in same directory
- **Store actions/selectors** → keep in store file; split by feature if >300 LOC
- **Service functions** → `src/services/<name>Service.ts` (one file per domain)

## Rust (src-tauri/src/)

- **Tauri commands** → `commands.rs` within the feature module
- **Data types/structs** → add to `src-tauri/src/models/` (see existing pattern)
- **Helper/utility functions** → `utils.rs` within the feature module
- **Tests** → keep in `#[cfg(test)]` block at bottom of each file
- **New services** → `src-tauri/src/services/<name>.rs`
