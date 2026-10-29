/** Per-case budget for tests that launch real subprocesses under shared-host load. */
export const SPAWN_TEST_TIMEOUT_MS = 45_000;

/** Child process budget stays below the case budget so child failures surface first. */
export const SPAWN_CHILD_TIMEOUT_MS = 30_000;
