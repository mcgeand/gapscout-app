/**
 * Round-trip tests for SIPOC persistence (#93).
 *
 * The `sipoc` table, the SIPOC/SIPOCRow types, the Zod schema and the row
 * converter all shipped without a read or write path, so the wizard's summary
 * lived only in React state and did not survive a reload. These lock in the
 * write → read → overwrite → read cycle through db.ts:
 *
 *  - `getSipoc` returns null for a project that has never run the wizard.
 *  - JSON array columns survive the round trip, empty arrays included.
 *  - `upsertSipoc` overwrites in place rather than adding a second row, so a
 *    re-run of the wizard edits the summary instead of duplicating it.
 *  - Neither path trips the Zod row validator, including the empty `process`
 *    the wizard's "Save Anyway" branch can produce.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/db/sqlJsAdapter", async () => {
  const { InMemoryAdapter } = await import("./helpers/inMemoryAdapter");
  return { SqlJsAdapter: InMemoryAdapter };
});

import { InMemoryAdapter } from "./helpers/inMemoryAdapter";
import { setDB } from "../services/db/connection";
import { initDB, getSipoc, upsertSipoc } from "../services/db";
import type { SIPOC } from "../data/types";

const sipoc: SIPOC = {
  projectId: "proj-1",
  suppliers: ["Requestor"],
  inputs: ["Purchase request", "Budget code"],
  process: "Review the request. Approve the result.",
  outputs: ["Approved order"],
  customers: ["Finance", "Supplier"],
};

describe("SIPOC persistence — full round-trip (#93)", () => {
  beforeEach(async () => {
    setDB(new InMemoryAdapter());
    await initDB();
  });

  it("getSipoc returns null before the wizard has ever run", async () => {
    expect(await getSipoc("proj-1")).toBeNull();
  });

  it("upsertSipoc -> getSipoc returns the same shape", async () => {
    await upsertSipoc(sipoc);

    expect(await getSipoc("proj-1")).toEqual(sipoc);
  });

  it("round-trips empty arrays rather than collapsing them to null", async () => {
    await upsertSipoc({
      projectId: "proj-1",
      suppliers: [],
      inputs: [],
      process: "Single unattributed step.",
      outputs: [],
      customers: [],
    });

    const loaded = await getSipoc("proj-1");
    expect(loaded).toEqual({
      projectId: "proj-1",
      suppliers: [],
      inputs: [],
      process: "Single unattributed step.",
      outputs: [],
      customers: [],
    });
  });

  it("a second upsert overwrites in place instead of duplicating the project", async () => {
    await upsertSipoc(sipoc);
    await upsertSipoc({
      ...sipoc,
      suppliers: ["Requestor", "Vendor"],
      process: "Review the request. Escalate over budget. Approve the result.",
    });

    const loaded = await getSipoc("proj-1");
    expect(loaded?.suppliers).toEqual(["Requestor", "Vendor"]);
    expect(loaded?.process).toBe(
      "Review the request. Escalate over budget. Approve the result.",
    );
  });

  it("keeps projects isolated", async () => {
    await upsertSipoc(sipoc);
    await upsertSipoc({ ...sipoc, projectId: "proj-2", process: "Other flow." });

    expect((await getSipoc("proj-1"))?.process).toBe(sipoc.process);
    expect((await getSipoc("proj-2"))?.process).toBe("Other flow.");
  });

  it("round-trips an empty process without a schema warning", async () => {
    // The wizard's validation modal offers "Save Anyway", so an empty process
    // is reachable. It must not make every later read log a validation failure.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await upsertSipoc({ ...sipoc, process: "" });
    const loaded = await getSipoc("proj-1");

    expect(loaded?.process).toBe("");
    expect(
      warnSpy.mock.calls.filter((args) =>
        args.some(
          (arg) =>
            typeof arg === "string" && arg.includes("schema validation failed"),
        ),
      ),
    ).toEqual([]);

    warnSpy.mockRestore();
  });
});
