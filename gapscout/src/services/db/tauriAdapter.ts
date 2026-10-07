/**
 * Tauri adapter for desktop environments
 * Wraps @tauri-apps/plugin-sql
 */

import type { DatabaseAdapter, QueryResult } from './dbInterface';

export class TauriAdapter implements DatabaseAdapter {
  private db: unknown = null;

  async initialize(): Promise<void> {
    console.log('[TauriAdapter] Initializing Tauri SQL plugin...');

    // Dynamic imports to avoid loading Tauri in browser
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    const { homeDir } = await import('@tauri-apps/api/path');

    const homePath = await homeDir();
    console.log('[TauriAdapter] Home directory:', homePath);

    const dbPath = `sqlite:${homePath}/.gapscout/gapscout.db`;
    console.log('[TauriAdapter] Loading database from:', dbPath);

    this.db = await Database.load(dbPath);
    console.log('[TauriAdapter] Database initialized successfully');
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // @ts-expect-error - Tauri Database type not available
    const result = await this.db.execute(sql, params);
    return { rowsAffected: result?.rowsAffected ?? 0 };
  }

  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // @ts-expect-error - Tauri Database type not available
    return await this.db.select(sql, params);
  }

  async close(): Promise<void> {
    // Tauri manages the connection lifecycle
    this.db = null;
  }
}
