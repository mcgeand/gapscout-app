/**
 * The `isLoading` concurrency contract on gapsStore.
 *
 * The contract itself is written out above `useGapsStore` in
 * `state/gapsStore.ts`. This file pins the parts of it that only a race can
 * show: overlapping writes, a rejected write, a mid-flight project switch, and
 * the two actions that deliberately sit outside the flag.
 *
 * Ticket: #98
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockedListGaps,
  mockedGetGap,
  mockedCreateGap,
  mockedUpdateGap,
  mockedDeleteGap,
  mockedCloseGap,
} = vi.hoisted(() => ({
  mockedListGaps: vi.fn(),
  mockedGetGap: vi.fn(),
  mockedCreateGap: vi.fn(),
  mockedUpdateGap: vi.fn(),
  mockedDeleteGap: vi.fn(),
  mockedCloseGap: vi.fn(),
}));

vi.mock("../services/db", () => ({
  listGaps: mockedListGaps,
  listGapsByStep: vi.fn(),
  getGap: mockedGetGap,
  createGap: mockedCreateGap,
  updateGap: mockedUpdateGap,
  deleteGap: mockedDeleteGap,
  closeGap: mockedCloseGap,
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { useGapsStore } from "../state/gapsStore";
import { beginProjectScope, clearProjectScope } from "../state/workspaceScope";
import type { Gap } from "../data/types";

/**
 * A promise the test resolves by hand, so two in-flight actions can be landed
 * in a chosen order rather than whatever the microtask queue picks.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeGap(id: string, projectId = "project-1"): Gap {
  return {
    id,
    projectId,
    observed: `${id} observed`,
    expected: `${id} expected`,
    severity: "M",
    status: "Open",
    links: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

const isLoading = () => useGapsStore.getState().isLoading;

beforeEach(() => {
  vi.clearAllMocks();
  mockedListGaps.mockResolvedValue([]);
  mockedGetGap.mockResolvedValue(null);
  useGapsStore.setState({
    gaps: [],
    currentProjectId: "project-1",
    currentGap: null,
    isLoading: false,
  });
});

afterEach(() => {
  // `clearGaps` drops the request guards, and `clearProjectScope` resets the
  // module-level generation. Without both, a scope captured here stays stale
  // for every later test in the file.
  useGapsStore.getState().clearGaps();
  clearProjectScope();
});

describe("gapsStore isLoading contract", () => {
  it("stays true until the last of two overlapping writes lands", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    mockedCreateGap
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    mockedGetGap.mockImplementation(async (id: string) => makeGap(id));

    const addFirst = useGapsStore.getState().addGap({ ...makeGap("gap-1") });
    const addSecond = useGapsStore.getState().addGap({ ...makeGap("gap-2") });
    expect(isLoading()).toBe(true);

    first.resolve("gap-1");
    await addFirst;
    expect(isLoading()).toBe(true);

    second.resolve("gap-2");
    await addSecond;
    expect(isLoading()).toBe(false);
  });

  it.each([
    [
      "updateGap",
      () => useGapsStore.getState().updateGap("gap-1", { observed: "x" }, "project-1"),
      mockedUpdateGap,
    ],
    [
      "deleteGap",
      () => useGapsStore.getState().deleteGap("gap-1", "project-1"),
      mockedDeleteGap,
    ],
    [
      "closeGap",
      () => useGapsStore.getState().closeGap("gap-1", "project-1"),
      mockedCloseGap,
    ],
  ])("clears isLoading when %s rejects", async (_name, run, mocked) => {
    mocked.mockRejectedValue(new Error("write failed"));

    await expect(run()).rejects.toThrow("write failed");

    expect(isLoading()).toBe(false);
  });

  it("clears isLoading when addGap rejects, which reports by returning null", async () => {
    mockedCreateGap.mockRejectedValue(new Error("write failed"));

    await expect(useGapsStore.getState().addGap({ ...makeGap("gap-1") })).resolves.toBeNull();

    expect(isLoading()).toBe(false);
  });

  it("clears isLoading when a load fails", async () => {
    mockedListGaps.mockRejectedValue(new Error("read failed"));

    await useGapsStore.getState().loadGaps("project-1");

    expect(isLoading()).toBe(false);
  });

  it("does not leave isLoading stuck when clearGaps abandons an in-flight write", async () => {
    const write = deferred<void>();
    mockedCloseGap.mockReturnValue(write.promise);

    const closing = useGapsStore.getState().closeGap("gap-1", "project-1");
    expect(isLoading()).toBe(true);

    // `clearGaps` invalidates the guard, so the write's own `finally` can no
    // longer clear the flag — `clearGaps` has to do it.
    useGapsStore.getState().clearGaps();
    expect(isLoading()).toBe(false);

    write.resolve();
    await closing;
    expect(isLoading()).toBe(false);
  });

  it("clears isLoading when the project scope changes mid-write, and keeps the stale write out of gaps", async () => {
    beginProjectScope("project-1");
    useGapsStore.setState({ gaps: [makeGap("gap-1")], currentProjectId: "project-1" });

    const write = deferred<Gap>();
    mockedUpdateGap.mockReturnValue(write.promise);

    const updating = useGapsStore
      .getState()
      .updateGap("gap-1", { observed: "written against project-1" }, "project-1");
    expect(isLoading()).toBe(true);

    // The user leaves the board. The write is still in flight.
    clearProjectScope();

    write.resolve({ ...makeGap("gap-1"), observed: "written against project-1" });
    await updating;

    expect(isLoading()).toBe(false);
    // Scope still guards the data: the stale result never lands.
    expect(useGapsStore.getState().gaps[0].observed).toBe("gap-1 observed");
  });

  it("clears isLoading when a load is abandoned by a project switch", async () => {
    beginProjectScope("project-1");
    const read = deferred<Gap[]>();
    mockedListGaps.mockReturnValueOnce(read.promise);

    const loading = useGapsStore.getState().loadGaps("project-1");
    expect(isLoading()).toBe(true);

    clearProjectScope();

    read.resolve([makeGap("gap-1")]);
    await loading;

    expect(isLoading()).toBe(false);
    expect(useGapsStore.getState().gaps).toEqual([]);
  });

  it("leaves isLoading alone through selectGap, which owns currentGap only", async () => {
    const read = deferred<Gap | null>();
    mockedGetGap.mockReturnValue(read.promise);

    const selecting = useGapsStore.getState().selectGap("gap-1");
    expect(isLoading()).toBe(false);

    read.resolve(makeGap("gap-1"));
    await selecting;

    expect(isLoading()).toBe(false);
    expect(useGapsStore.getState().currentGap?.id).toBe("gap-1");
  });

  it("leaves isLoading alone when selectGap fails", async () => {
    mockedGetGap.mockRejectedValue(new Error("read failed"));

    await useGapsStore.getState().selectGap("gap-1");

    expect(isLoading()).toBe(false);
    expect(useGapsStore.getState().currentGap).toBeNull();
  });

  it("holds isLoading up across a mixed load and write, clearing on the later one", async () => {
    const read = deferred<Gap[]>();
    const write = deferred<void>();
    mockedListGaps.mockReturnValueOnce(read.promise);
    mockedDeleteGap.mockReturnValue(write.promise);

    const loading = useGapsStore.getState().loadGaps("project-1");
    const deleting = useGapsStore.getState().deleteGap("gap-1", "project-1");
    expect(isLoading()).toBe(true);

    read.resolve([]);
    await loading;
    expect(isLoading()).toBe(true);

    write.resolve();
    await deleting;
    expect(isLoading()).toBe(false);
  });
});
