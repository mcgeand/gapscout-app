/**
 * `Project.state` through the real CRUD path (#263).
 *
 * The two-tier types mean a field can be declared, validated and stored and
 * still never reach the caller, because the row mapper forgot it. This drives
 * the actual `db.ts` functions against real SQLite so the write path and the
 * read path have to agree.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProject,
  getProject,
  listProjects,
  SCHEMA_SQL,
  updateProject,
} from "../services/db";
import { setDB } from "../services/db/connection";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

let adapter: SqlJsTestAdapter;

describe("Project.state round-trip", () => {
  beforeEach(async () => {
    adapter = new SqlJsTestAdapter();
    await adapter.initialize();
    setDB(adapter);
    await adapter.execute(SCHEMA_SQL);
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("persists the state a project is created with", async () => {
    const id = await createProject({ name: "Order to Cash", state: "future" });

    expect(await getProject(id)).toMatchObject({ name: "Order to Cash", state: "future" });
  });

  it("leaves state undefined when nobody has said", async () => {
    const id = await createProject({ name: "my process" });

    const project = await getProject(id);
    expect(project?.state).toBeUndefined();
    // Stored as NULL, not the string "undefined".
    const rows = await adapter.select<Array<{ state: string | null }>>(
      "SELECT state FROM projects WHERE id = $1",
      [id]
    );
    expect(rows[0].state).toBeNull();
  });

  it("updates state without touching the name", async () => {
    const id = await createProject({ name: "P2P - Acme Corp" });

    await updateProject(id, { state: "current" });

    expect(await getProject(id)).toMatchObject({ name: "P2P - Acme Corp", state: "current" });
  });

  it("carries state through listProjects", async () => {
    await createProject({ name: "Current map", state: "current" });
    await createProject({ name: "Future map", state: "future" });
    await createProject({ name: "Unclassified map" });

    const byName = new Map((await listProjects()).map((p) => [p.name, p.state]));
    expect(byName.get("Current map")).toBe("current");
    expect(byName.get("Future map")).toBe("future");
    expect(byName.get("Unclassified map")).toBeUndefined();
  });

  it("drops an unrecognised stored state rather than passing it on", async () => {
    // `validateRow` only warns, so a bad column value must be filtered by the
    // mapper or it reaches the UI typed as a state it is not.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = await createProject({ name: "Hand-edited" });
    await adapter.execute("UPDATE projects SET state = 'archived' WHERE id = $1", [id]);

    expect((await getProject(id))?.state).toBeUndefined();
    warn.mockRestore();
  });

  it("clears a state back to NULL (#318)", async () => {
    // `undefined` means "no change" on this path, so a project that has been
    // classified needs an expressible value that returns the column to NULL.
    const id = await createProject({ name: "Reclassified", state: "current" });

    await updateProject(id, { state: null });

    expect((await getProject(id))?.state).toBeUndefined();
    const rows = await adapter.select<Array<{ state: string | null }>>(
      "SELECT state FROM projects WHERE id = $1",
      [id]
    );
    expect(rows[0].state).toBeNull();
  });

  it("clears legacy_name when the name changes (#265)", async () => {
    const id = await createProject({ name: "P2P - Acme Corp", state: "current" });
    await adapter.execute("UPDATE projects SET legacy_name = $1 WHERE id = $2", [
      "P2P - Acme Corp Current State",
      id,
    ]);

    await updateProject(id, { name: "Procure to Pay" });

    const rows = await adapter.select<Array<{ name: string; legacy_name: string | null }>>(
      "SELECT name, legacy_name FROM projects WHERE id = $1",
      [id]
    );
    expect(rows[0].name).toBe("Procure to Pay");
    expect(rows[0].legacy_name).toBeNull();
  });

  it("keeps legacy_name when the name is resubmitted unchanged (#265)", async () => {
    // The edit form always sends `name`, so a description-only edit reaches
    // here as a no-op rename. That must not discard the migration's original.
    const id = await createProject({ name: "P2P - Acme Corp", state: "current" });
    await adapter.execute("UPDATE projects SET legacy_name = $1 WHERE id = $2", [
      "P2P - Acme Corp Current State",
      id,
    ]);

    await updateProject(id, { name: "P2P - Acme Corp", description: "Now described" });

    const rows = await adapter.select<Array<{ legacy_name: string | null }>>(
      "SELECT legacy_name FROM projects WHERE id = $1",
      [id]
    );
    expect(rows[0].legacy_name).toBe("P2P - Acme Corp Current State");
  });
});
