/**
 * D110-WI-1 (R3): two update checks on ONE About instance — StrictMode re-runs
 * the mount effect, so check A starts, then check B. B answers first; A's late
 * answer is stale and must reach neither the screen nor the cache. This is the
 * only place a superseded check's `setState` is observable: across a real
 * unmount the stale instance is gone.
 *
 * Runs the real @tauri-apps/plugin-updater JS with only the IPC mocked
 * (`mockIPC`). A vi.mock'd plugin cannot be used here: under vitest two
 * concurrent first `import()`s of a mocked module resolve one of them to the
 * real module, which is exactly what StrictMode's double effect produces.
 */
import { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";

import { AboutSettings } from "../src/components/common/settings/AboutSettings";
import { useUpdaterStore } from "../src/stores/updaterStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const UP_TO_DATE_TEXT = /You're up to date/;
const AVAILABLE_TEXT = /Update available — v9\.9\.9/;
const UPDATE_METADATA = {
  rid: 7, currentVersion: "1.2.3", version: "9.9.9", date: null, body: null, rawJson: {},
};

type Answer = (value: unknown) => void;
let answers: Answer[] = [];

beforeEach(() => {
  answers = [];
  useUpdaterStore.setState({ cachedResult: null });
  useLoggingStore.setState({ enabled: false });
  mockIPC((cmd) => {
    if (cmd === "plugin:updater|check") return new Promise((resolve) => answers.push(resolve));
    if (cmd === "get_app_version") return "1.2.3";
    return undefined;
  });
});

afterEach(() => {
  clearMocks();
});

describe("AboutSettings — a superseded check on the same instance (D110)", () => {
  it("R3: under StrictMode the stale first check's late update neither shows nor clears the cache", async () => {
    render(<StrictMode><AboutSettings /></StrictMode>);
    await waitFor(() => expect(answers).toHaveLength(2));
    const [answerA, answerB] = answers;

    await act(async () => answerB(null));
    expect(await screen.findByText(UP_TO_DATE_TEXT)).toBeInTheDocument();
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "up-to-date" });

    await act(async () => answerA(UPDATE_METADATA));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(screen.queryByText(AVAILABLE_TEXT)).toBeNull();
    expect(screen.getByText(UP_TO_DATE_TEXT)).toBeInTheDocument();
    expect(useUpdaterStore.getState().cachedResult).toEqual({ phase: "up-to-date" });
  });
});
