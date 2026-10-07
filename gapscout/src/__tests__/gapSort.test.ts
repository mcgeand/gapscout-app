/**
 * Unit tests for the gap table sort helpers.
 *
 * Covers rank ordering per column, the "empty values last in both directions"
 * rule, the tie-break chain, header click cycling and persisted-sort parsing.
 *
 * Ticket: #161
 */

import { describe, expect, it } from "vitest";
import {
  defaultGapSort,
  nextGapSort,
  parseGapSort,
  sortGaps,
  type GapSort,
  type GapSortContext,
} from "../lib/gapSort";
import type { Gap, Link } from "../data/types";

function link(id: string): Link {
  return { id, url: `https://jira.example/${id}`, label: id, type: "jira", createdAt: 1 };
}

function makeGap(id: string, overrides: Partial<Gap> = {}): Gap {
  return {
    id,
    projectId: "project-1",
    observed: `${id} observed`,
    expected: `${id} expected`,
    severity: "M",
    status: "Open",
    links: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

/** Context that knows nothing, for columns that do not consult it. */
const noContext: GapSortContext = {
  stepOrderOf: () => undefined,
  teamNameOf: () => undefined,
};

/** Build a context from plain id -> value maps. */
function contextOf(
  stepOrders: Record<string, number | undefined> = {},
  teamNames: Record<string, string | undefined> = {},
): GapSortContext {
  return {
    stepOrderOf: (gap) => stepOrders[gap.id],
    teamNameOf: (gap) => teamNames[gap.id],
  };
}

function idsOf(gaps: Gap[]): string[] {
  return gaps.map((gap) => gap.id);
}

function sortedIds(gaps: Gap[], sort: GapSort, ctx: GapSortContext = noContext): string[] {
  return idsOf(sortGaps(gaps, sort, ctx));
}

describe("defaultGapSort", () => {
  it("is priority ascending, so Critical (1) leads the list", () => {
    expect(defaultGapSort).toEqual({ column: "priority", direction: "asc" });
  });

  it("puts priority 1 before priority 3 and unprioritised gaps last", () => {
    const gaps = [
      makeGap("medium", { priority: 3 }),
      makeGap("none"),
      makeGap("critical", { priority: 1 }),
    ];

    expect(sortedIds(gaps, defaultGapSort)).toEqual(["critical", "medium", "none"]);
  });
});

describe("sortGaps empty values", () => {
  it("keeps missing priority last in BOTH directions", () => {
    const gaps = [
      makeGap("none"),
      makeGap("p3", { priority: 3 }),
      makeGap("p1", { priority: 1 }),
    ];

    expect(sortedIds(gaps, { column: "priority", direction: "asc" })).toEqual(["p1", "p3", "none"]);
    expect(sortedIds(gaps, { column: "priority", direction: "desc" })).toEqual(["p3", "p1", "none"]);
  });

  it("keeps missing rootCause last in BOTH directions", () => {
    const gaps = [
      makeGap("none"),
      makeGap("data", { rootCause: "Data" }),
      makeGap("config", { rootCause: "Config" }),
    ];

    expect(sortedIds(gaps, { column: "rootCause", direction: "asc" })).toEqual([
      "config",
      "data",
      "none",
    ]);
    expect(sortedIds(gaps, { column: "rootCause", direction: "desc" })).toEqual([
      "data",
      "config",
      "none",
    ]);
  });

  it("keeps missing timeToFix last in BOTH directions", () => {
    const gaps = [
      makeGap("none"),
      makeGap("long", { timeToFix: "long" }),
      makeGap("qwin", { timeToFix: "qwin" }),
    ];

    expect(sortedIds(gaps, { column: "timeToFix", direction: "asc" })).toEqual([
      "qwin",
      "long",
      "none",
    ]);
    expect(sortedIds(gaps, { column: "timeToFix", direction: "desc" })).toEqual([
      "long",
      "qwin",
      "none",
    ]);
  });

  it("keeps a gap with no step order last in BOTH directions", () => {
    const gaps = [makeGap("floating"), makeGap("late"), makeGap("early")];
    const ctx = contextOf({ early: 1, late: 7, floating: undefined });

    expect(sortedIds(gaps, { column: "step", direction: "asc" }, ctx)).toEqual([
      "early",
      "late",
      "floating",
    ]);
    expect(sortedIds(gaps, { column: "step", direction: "desc" }, ctx)).toEqual([
      "late",
      "early",
      "floating",
    ]);
  });

  it("keeps an unassigned owner team last in BOTH directions", () => {
    const gaps = [makeGap("unassigned"), makeGap("zebra"), makeGap("apple")];
    const ctx = contextOf({}, { apple: "Apple Team", zebra: "zebra team", unassigned: undefined });

    expect(sortedIds(gaps, { column: "ownerTeam", direction: "asc" }, ctx)).toEqual([
      "apple",
      "zebra",
      "unassigned",
    ]);
    expect(sortedIds(gaps, { column: "ownerTeam", direction: "desc" }, ctx)).toEqual([
      "zebra",
      "apple",
      "unassigned",
    ]);
  });
});

describe("sortGaps column ranks", () => {
  it("orders severity Low -> High ascending and High -> Low descending", () => {
    const gaps = [
      makeGap("high", { severity: "H" }),
      makeGap("low", { severity: "L" }),
      makeGap("medium", { severity: "M" }),
    ];

    expect(sortedIds(gaps, { column: "severity", direction: "asc" })).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(sortedIds(gaps, { column: "severity", direction: "desc" })).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });

  it("orders status by workflow position, not alphabetically", () => {
    const gaps = [
      makeGap("closed", { status: "Closed" }),
      makeGap("review", { status: "Review" }),
      makeGap("open", { status: "Open" }),
    ];

    expect(sortedIds(gaps, { column: "status", direction: "asc" })).toEqual([
      "open",
      "review",
      "closed",
    ]);
    expect(sortedIds(gaps, { column: "status", direction: "desc" })).toEqual([
      "closed",
      "review",
      "open",
    ]);
  });

  it("orders rootCause Config -> Policy -> Behavior -> Data", () => {
    const gaps = [
      makeGap("data", { rootCause: "Data" }),
      makeGap("behavior", { rootCause: "Behavior" }),
      makeGap("config", { rootCause: "Config" }),
      makeGap("policy", { rootCause: "Policy" }),
    ];

    expect(sortedIds(gaps, { column: "rootCause", direction: "asc" })).toEqual([
      "config",
      "policy",
      "behavior",
      "data",
    ]);
    expect(sortedIds(gaps, { column: "rootCause", direction: "desc" })).toEqual([
      "data",
      "behavior",
      "policy",
      "config",
    ]);
  });

  it("orders timeToFix qwin -> near -> mid -> long", () => {
    const gaps = [
      makeGap("mid", { timeToFix: "mid" }),
      makeGap("long", { timeToFix: "long" }),
      makeGap("qwin", { timeToFix: "qwin" }),
      makeGap("near", { timeToFix: "near" }),
    ];

    expect(sortedIds(gaps, { column: "timeToFix", direction: "asc" })).toEqual([
      "qwin",
      "near",
      "mid",
      "long",
    ]);
    expect(sortedIds(gaps, { column: "timeToFix", direction: "desc" })).toEqual([
      "long",
      "mid",
      "near",
      "qwin",
    ]);
  });

  it("orders the links column by link count, treating zero links as a real value", () => {
    const gaps = [
      makeGap("two", { links: [link("A-1"), link("A-2")] }),
      makeGap("zero"),
      makeGap("one", { links: [link("B-1")] }),
    ];

    expect(sortedIds(gaps, { column: "links", direction: "asc" })).toEqual(["zero", "one", "two"]);
    expect(sortedIds(gaps, { column: "links", direction: "desc" })).toEqual(["two", "one", "zero"]);
  });

  it("orders the ID column by createdAt rather than by the nanoid itself", () => {
    const gaps = [
      makeGap("zzz-newest", { createdAt: 300 }),
      makeGap("aaa-oldest", { createdAt: 100 }),
      makeGap("mmm-middle", { createdAt: 200 }),
    ];

    expect(sortedIds(gaps, { column: "id", direction: "asc" })).toEqual([
      "aaa-oldest",
      "mmm-middle",
      "zzz-newest",
    ]);
    expect(sortedIds(gaps, { column: "id", direction: "desc" })).toEqual([
      "zzz-newest",
      "mmm-middle",
      "aaa-oldest",
    ]);
  });

  it("orders the step column by the context's step order", () => {
    const gaps = [makeGap("third"), makeGap("first"), makeGap("second")];
    const ctx = contextOf({ first: 1, second: 2, third: 3 });

    expect(sortedIds(gaps, { column: "step", direction: "asc" }, ctx)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(sortedIds(gaps, { column: "step", direction: "desc" }, ctx)).toEqual([
      "third",
      "second",
      "first",
    ]);
  });

  it("orders owner team by name, case-insensitively", () => {
    const gaps = [makeGap("zeta"), makeGap("alpha"), makeGap("Mid")];
    const ctx = contextOf({}, { alpha: "apple squad", Mid: "Middle Office", zeta: "Zebra Crew" });

    expect(sortedIds(gaps, { column: "ownerTeam", direction: "asc" }, ctx)).toEqual([
      "alpha",
      "Mid",
      "zeta",
    ]);
    expect(sortedIds(gaps, { column: "ownerTeam", direction: "desc" }, ctx)).toEqual([
      "zeta",
      "Mid",
      "alpha",
    ]);
  });
});

describe("sortGaps purity", () => {
  it("returns a new array and leaves the input order untouched", () => {
    const gaps = [
      makeGap("c", { priority: 3 }),
      makeGap("a", { priority: 1 }),
      makeGap("b", { priority: 2 }),
    ];
    const before = idsOf(gaps);

    const result = sortGaps(gaps, defaultGapSort, noContext);

    expect(result).not.toBe(gaps);
    expect(idsOf(result)).toEqual(["a", "b", "c"]);
    expect(idsOf(gaps)).toEqual(before);
  });
});

describe("sortGaps tie-breaks", () => {
  it("falls through an equal primary key to severity descending", () => {
    const gaps = [
      makeGap("low", { status: "Open", severity: "L", createdAt: 500 }),
      makeGap("high", { status: "Open", severity: "H", createdAt: 500 }),
      makeGap("medium", { status: "Open", severity: "M", createdAt: 500 }),
    ];

    expect(sortedIds(gaps, { column: "status", direction: "asc" })).toEqual([
      "high",
      "medium",
      "low",
    ]);
    // The severity fallback is direction-independent: flipping the primary
    // column must not flip the tie-break.
    expect(sortedIds(gaps, { column: "status", direction: "desc" })).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });

  it("falls through equal primary and severity to the newer createdAt", () => {
    const gaps = [
      makeGap("oldest", { status: "Open", severity: "M", createdAt: 100 }),
      makeGap("newest", { status: "Open", severity: "M", createdAt: 300 }),
      makeGap("middle", { status: "Open", severity: "M", createdAt: 200 }),
    ];

    expect(sortedIds(gaps, { column: "status", direction: "asc" })).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("skips the severity tie-break when severity is the sorted column", () => {
    const gaps = [
      makeGap("older-medium", { severity: "M", createdAt: 100 }),
      makeGap("newer-medium", { severity: "M", createdAt: 200 }),
    ];

    expect(sortedIds(gaps, { column: "severity", direction: "asc" })).toEqual([
      "newer-medium",
      "older-medium",
    ]);
  });

  it("settles a total tie on ascending id", () => {
    const gaps = [
      makeGap("gap-c", { status: "Open", severity: "M", createdAt: 100 }),
      makeGap("gap-a", { status: "Open", severity: "M", createdAt: 100 }),
      makeGap("gap-b", { status: "Open", severity: "M", createdAt: 100 }),
    ];

    expect(sortedIds(gaps, { column: "status", direction: "asc" })).toEqual([
      "gap-a",
      "gap-b",
      "gap-c",
    ]);
  });
});

describe("nextGapSort", () => {
  it("starts a newly clicked column ascending", () => {
    expect(nextGapSort({ column: "priority", direction: "desc" }, "severity")).toEqual({
      column: "severity",
      direction: "asc",
    });
  });

  it("flips the active column from ascending to descending", () => {
    expect(nextGapSort({ column: "severity", direction: "asc" }, "severity")).toEqual({
      column: "severity",
      direction: "desc",
    });
  });

  it("flips the active column from descending back to ascending", () => {
    expect(nextGapSort({ column: "severity", direction: "desc" }, "severity")).toEqual({
      column: "severity",
      direction: "asc",
    });
  });
});

describe("parseGapSort", () => {
  it("round-trips a valid non-default sort", () => {
    const sort: GapSort = { column: "links", direction: "desc" };
    expect(parseGapSort(JSON.parse(JSON.stringify(sort)))).toEqual(sort);
  });

  it("falls back to the default for an unknown column", () => {
    expect(parseGapSort({ column: "assignee", direction: "asc" })).toEqual(defaultGapSort);
  });

  it("falls back to the default for a bad direction", () => {
    expect(parseGapSort({ column: "severity", direction: "sideways" })).toEqual(defaultGapSort);
  });

  it("falls back to the default when the direction is missing", () => {
    expect(parseGapSort({ column: "severity" })).toEqual(defaultGapSort);
  });

  it("falls back to the default for null", () => {
    expect(parseGapSort(null)).toEqual(defaultGapSort);
  });

  it("falls back to the default for a string", () => {
    expect(parseGapSort("priority")).toEqual(defaultGapSort);
  });

  it("falls back to the default for an empty object", () => {
    expect(parseGapSort({})).toEqual(defaultGapSort);
  });

  it("falls back to the default for undefined", () => {
    expect(parseGapSort(undefined)).toEqual(defaultGapSort);
  });
});
