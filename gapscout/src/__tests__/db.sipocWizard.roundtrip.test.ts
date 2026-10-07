/**
 * Round-trip tests for the SIPOC Wizard write path (ZIP-381).
 *
 * Bug: SIPOC-wizard-generated steps were persisted with `teamId = ""` when the
 * project had no teams. On read, the Zod row validator at the db.ts boundary
 * fired `schema validation failed: teamId: Too small...` for every step.
 *
 * ZIP-369 added round-trip tests for policies and glossary but missed steps.
 * This file fills the gap and locks in:
 *
 *  - `parsedStepToStep` throws when `parsed.teamId` is empty (loud invariant
 *    replacing the silent `|| ''` fallback that was the data-loss vector).
 *  - `parseSipocData` leaves `teamId` unset when a sentence names no owner
 *    (confirm resolves Unassigned; the parser must not invent `teams[0]`).
 *  - A wizard-shaped step round-trips through `createStep` →
 *    `listSteps` without firing the Zod `schema validation failed`
 *    warning.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ParsedStep } from "../lib/sipocParser";
import type { Team } from "../data/types";

vi.mock("../services/db/sqlJsAdapter", async () => {
  const { InMemoryAdapter } = await import("./helpers/inMemoryAdapter");
  return { SqlJsAdapter: InMemoryAdapter };
});

import { initDB, createStep, listSteps } from "../services/db";
import { parseSipocData, parsedStepToStep } from "../lib/sipocParser";

describe("SIPOC wizard write path round-trip (ZIP-381)", () => {
  beforeEach(async () => {
    await initDB();
  });

  it("parsedStepToStep throws when parsed.teamId is missing (loud invariant)", () => {
    const parsed: ParsedStep = {
      label: "Review applications",
      suppliers: [],
      inputs: [],
      outputs: [],
      customers: [],
      order: 0,
    };

    expect(() => parsedStepToStep(parsed, "proj-1", "ms-1")).toThrow(/teamId/i);
  });

  it("parsedStepToStep throws on empty-string teamId, not just undefined", () => {
    const parsed: ParsedStep = {
      label: "Review applications",
      suppliers: [],
      inputs: [],
      outputs: [],
      customers: [],
      teamId: "",
      order: 0,
    };

    expect(() => parsedStepToStep(parsed, "proj-1", "ms-1")).toThrow(/teamId/i);
  });

  it("parseSipocData leaves teamId unset when prose names no owner", () => {
    // Having an Unassigned sentinel in the registry must not make the parser
    // invent an owner — confirm is what files those rows under Unassigned.
    const teams: Team[] = [
      {
        id: "team-unassigned",
        projectId: "proj-1",
        name: "Unassigned",
        color: "#6B7280",
        order: 1,
        tags: [],
        createdAt: 0,
      },
    ];

    const result = parseSipocData(
      {
        suppliers: ["General"],
        inputs: ["application form"],
        processDescription: "Review the application. Approve the result.",
        outputs: ["decision"],
        customers: ["Applicant"],
      },
      teams,
    );

    expect(result.steps.length).toBeGreaterThan(0);
    for (const step of result.steps) {
      expect(step.teamId).toBeUndefined();
    }
  });

  it("parseSipocData no-action-phrases fallback leaves the generic step unowned", () => {
    // No recognized action verbs → warning branch with one generic step.
    // That step must stay unowned so Review can confirm Unassigned; inventing
    // teams[0] would file prose that named nobody under the first registry row.
    const teams: Team[] = [
      {
        id: "team-unassigned",
        projectId: "proj-1",
        name: "Unassigned",
        color: "#6B7280",
        order: 1,
        tags: [],
        createdAt: 0,
      },
    ];

    const result = parseSipocData(
      {
        suppliers: [],
        inputs: [],
        processDescription: "foo bar baz qux",
        outputs: [],
        customers: [],
      },
      teams,
    );

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].teamId).toBeUndefined();

    expect(() =>
      parsedStepToStep(result.steps[0], "proj-1", "ms-1"),
    ).toThrow(/teamId/i);
  });

  it("round-trip: wizard-created step writes + reads without a Zod schema warning", async () => {
    const projectId = "proj-1";
    const milestoneId = "ms-1";
    const teamId = "team-unassigned";

    const parsed: ParsedStep = {
      label: "Review applications",
      suppliers: ["General"],
      inputs: ["application form"],
      outputs: ["reviewed application"],
      customers: ["Applicant"],
      teamId,
      order: 0,
    };

    const stepData = parsedStepToStep(parsed, projectId, milestoneId);
    expect(stepData.teamId).toBe(teamId);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await createStep(stepData);
    const steps = await listSteps(projectId);

    expect(steps).toHaveLength(1);
    expect(steps[0].teamId).toBe(teamId);
    expect(steps[0].label).toBe("Review applications");

    const schemaWarnings = warnSpy.mock.calls.filter((args) =>
      args.some(
        (arg) =>
          typeof arg === "string" && arg.includes("schema validation failed"),
      ),
    );
    expect(schemaWarnings).toEqual([]);

    warnSpy.mockRestore();
  });
});
