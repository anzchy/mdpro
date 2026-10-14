/** Types for change-scope.mjs (ADR-0095), so tests can import it under strict tsc. */
export declare const PROSE_PREFIXES: readonly string[];
export declare const PROSE_ROOT_FILES: readonly string[];
export declare function classifyPaths(paths: readonly string[]): "prose" | "code";
