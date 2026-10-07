/**
 * The `isLoading` contract on the stores that sit beside gapsStore.
 *
 * teams, systems, policies, glossary and steps (with its milestones) follow the
 * contract written above `useGapsStore` in `state/gapsStore.ts`. This file pins
 * the two parts #405 fixed in them, in the shape of `gapsStore.loading.test.ts`:
 * a project switch that abandons a request must still let the flag clear, and a
 * `clearX()` that invalidates the guard must reset the flag itself.
 *
 * Ticket: #405
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  listTeams: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  getTeamUsageCount: vi.fn(),
  getTeamReferenceCount: vi.fn(),
  listSystems: vi.fn(),
  createSystem: vi.fn(),
  updateSystem: vi.fn(),
  deleteSystem: vi.fn(),
  getSystemUsageCount: vi.fn(),
  listPolicies: vi.fn(),
  createPolicy: vi.fn(),
  updatePolicy: vi.fn(),
  deletePolicy: vi.fn(),
  listGlossaryEntries: vi.fn(),
  createGlossaryEntry: vi.fn(),
  updateGlossaryEntry: vi.fn(),
  deleteGlossaryEntry: vi.fn(),
  listSteps: vi.fn(),
  getStep: vi.fn(),
  createStep: vi.fn(),
  updateStep: vi.fn(),
  deleteStep: vi.fn(),
  listMilestones: vi.fn(),
  getMilestone: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  reorderMilestones: vi.fn(),
  getMilestoneUsageCount: vi.fn(),
  setStepOrders: vi.fn(),
  setGapOrders: vi.fn(),
  listGaps: vi.fn(),
  listGapsByStep: vi.fn(),
  getGap: vi.fn(),
  createGap: vi.fn(),
  updateGap: vi.fn(),
  deleteGap: vi.fn(),
  closeGap: vi.fn(),
}));

vi.mock("../services/db", () => db);

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { useTeamsStore } from "../state/teamsStore";
import { useSystemsStore } from "../state/systemsStore";
import { usePoliciesStore } from "../state/policiesStore";
import { useGlossaryStore } from "../state/glossaryStore";
import { useStepsStore } from "../state/stepsStore";
import { beginProjectScope, clearProjectScope } from "../state/workspaceScope";

/**
 * A promise the test resolves by hand, so a request can be held in flight
 * while the project scope or the store is torn down underneath it.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type Row = { id: string; projectId: string };

/**
 * One row per collection. `load` reads through `list`; `write` is a delete
 * whose first await is `held`, so holding `held` open holds the write open
 * with `isLoading` already raised.
 */
interface Case {
  name: string;
  isLoading: () => boolean;
  items: () => Row[];
  seed: (items: Row[]) => void;
  list: ReturnType<typeof vi.fn>;
  load: (projectId: string) => Promise<void>;
  held: ReturnType<typeof vi.fn>;
  write: (id: string, projectId: string) => Promise<void>;
  clear: () => void;
}

const row = (id: string): Row => ({ id, projectId: "project-1" });

const cases: Case[] = [
  {
    name: "teams",
    isLoading: () => useTeamsStore.getState().isLoading,
    items: () => useTeamsStore.getState().teams,
    seed: (items) => useTeamsStore.setState({ teams: items as never }),
    list: db.listTeams,
    load: (projectId) => useTeamsStore.getState().loadTeams(projectId),
    held: db.getTeamUsageCount,
    write: (id, projectId) => useTeamsStore.getState().deleteTeam(id, projectId),
    clear: () => useTeamsStore.getState().clearTeams(),
  },
  {
    name: "systems",
    isLoading: () => useSystemsStore.getState().isLoading,
    items: () => useSystemsStore.getState().systems,
    seed: (items) => useSystemsStore.setState({ systems: items as never }),
    list: db.listSystems,
    load: (projectId) => useSystemsStore.getState().loadSystems(projectId),
    held: db.getSystemUsageCount,
    write: (id, projectId) => useSystemsStore.getState().deleteSystem(id, projectId),
    clear: () => useSystemsStore.getState().clearSystems(),
  },
  {
    name: "policies",
    isLoading: () => usePoliciesStore.getState().isLoading,
    items: () => usePoliciesStore.getState().policies,
    seed: (items) => usePoliciesStore.setState({ policies: items as never }),
    list: db.listPolicies,
    load: (projectId) => usePoliciesStore.getState().loadPolicies(projectId),
    held: db.deletePolicy,
    write: (id, projectId) => usePoliciesStore.getState().deletePolicy(id, projectId),
    clear: () => usePoliciesStore.getState().clearPolicies(),
  },
  {
    name: "glossary",
    isLoading: () => useGlossaryStore.getState().isLoading,
    items: () => useGlossaryStore.getState().entries,
    seed: (items) => useGlossaryStore.setState({ entries: items as never }),
    list: db.listGlossaryEntries,
    load: (projectId) => useGlossaryStore.getState().loadGlossary(projectId),
    held: db.deleteGlossaryEntry,
    write: (id, projectId) => useGlossaryStore.getState().deleteGlossaryEntry(id, projectId),
    clear: () => useGlossaryStore.getState().clearGlossary(),
  },
  {
    name: "steps",
    isLoading: () => useStepsStore.getState().isLoading,
    items: () => useStepsStore.getState().steps,
    seed: (items) => useStepsStore.setState({ steps: items as never }),
    list: db.listSteps,
    load: (projectId) => useStepsStore.getState().loadSteps(projectId),
    held: db.deleteStep,
    write: (id, projectId) => useStepsStore.getState().deleteStep(id, projectId),
    clear: () => useStepsStore.getState().clearSteps(),
  },
  {
    name: "milestones",
    isLoading: () => useStepsStore.getState().isLoading,
    items: () => useStepsStore.getState().milestones,
    seed: (items) => useStepsStore.setState({ milestones: items as never }),
    list: db.listMilestones,
    load: (projectId) => useStepsStore.getState().loadMilestones(projectId),
    held: db.getMilestoneUsageCount,
    write: (id, projectId) => useStepsStore.getState().deleteMilestone(id, projectId),
    clear: () => useStepsStore.getState().clearSteps(),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  useTeamsStore.setState({ teams: [], currentProjectId: "project-1", isLoading: false });
  useSystemsStore.setState({ systems: [], currentProjectId: "project-1", isLoading: false });
  usePoliciesStore.setState({ policies: [], currentProjectId: "project-1", isLoading: false });
  useGlossaryStore.setState({ entries: [], currentProjectId: "project-1", isLoading: false });
  useStepsStore.setState({
    steps: [],
    milestones: [],
    currentProjectId: "project-1",
    currentStep: null,
    isLoading: false,
  });
});

afterEach(() => {
  // Each `clearX` drops its store's request guard, and `clearProjectScope`
  // resets the module-level generation. Without both, a scope captured here
  // stays stale for every later test in the file.
  for (const c of cases) c.clear();
  clearProjectScope();
});

describe.each(cases)("$name isLoading contract", (c) => {
  it("clears isLoading when a load is abandoned by a project switch", async () => {
    beginProjectScope("project-1");
    const read = deferred<Row[]>();
    c.list.mockReturnValueOnce(read.promise);

    const loading = c.load("project-1");
    expect(c.isLoading()).toBe(true);

    // The user leaves the board. The read is still in flight.
    clearProjectScope();

    read.resolve([row("stale")]);
    await loading;

    expect(c.isLoading()).toBe(false);
    // Scope still guards the data: the stale result never lands.
    expect(c.items()).toEqual([]);
  });

  it("clears isLoading when the project scope changes mid-write, and keeps the stale write out", async () => {
    beginProjectScope("project-1");
    c.seed([row("item-1")]);
    const write = deferred<unknown>();
    c.held.mockReturnValueOnce(write.promise);

    const writing = c.write("item-1", "project-1");
    expect(c.isLoading()).toBe(true);

    clearProjectScope();

    write.resolve(0);
    await writing;

    expect(c.isLoading()).toBe(false);
    expect(c.items()).toEqual([row("item-1")]);
    expect(c.list).not.toHaveBeenCalled();
  });

  it("does not leave isLoading stuck when clear abandons an in-flight write", async () => {
    const write = deferred<unknown>();
    c.held.mockReturnValueOnce(write.promise);

    const writing = c.write("item-1", "project-1");
    expect(c.isLoading()).toBe(true);

    // `clear` invalidates the guard, so the write's own `finally` can no
    // longer clear the flag; `clear` has to do it.
    c.clear();
    expect(c.isLoading()).toBe(false);

    write.resolve(0);
    await writing;
    expect(c.isLoading()).toBe(false);
  });
});
