import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import initSqlJs, { type Database } from "sql.js";
import type { DatabaseAdapter, QueryResult } from "../../services/db/dbInterface";

const require = createRequire(import.meta.url);
const wasmBytes = readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm"));
const wasmBinary = new ArrayBuffer(wasmBytes.byteLength);
new Uint8Array(wasmBinary).set(wasmBytes);

export class SqlJsTestAdapter implements DatabaseAdapter {
  private db: Database | null = null;

  async initialize(): Promise<void> {
    const SQL = await initSqlJs({ wasmBinary });
    this.db = new SQL.Database();
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const db = this.requireDatabase();
    const bindParams = this.convertValues(params);
    if (bindParams.length === 0) {
      db.exec(sql);
    } else {
      db.run(this.convertParams(sql), bindParams);
    }
    return { rowsAffected: db.getRowsModified() };
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T> {
    const statement = this.requireDatabase().prepare(this.convertParams(sql));
    statement.bind(this.convertValues(params));

    const rows: Record<string, unknown>[] = [];
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }
    statement.free();
    return rows as T;
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private requireDatabase(): Database {
    if (!this.db) {
      throw new Error("Test database not initialized");
    }
    return this.db;
  }

  private convertParams(sql: string): string {
    return sql.replace(/\$\d+/g, "?");
  }

  private convertValues(values: unknown[]) {
    return values.map((value) => {
      if (value === undefined) return null;
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        value instanceof Uint8Array
      ) {
        return value;
      }
      throw new TypeError("Unsupported SQL.js test parameter");
    });
  }
}
