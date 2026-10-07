/**
 * sql.js adapter for browser environments
 * Uses IndexedDB for persistence
 */

import type { DatabaseAdapter, QueryResult } from './dbInterface';

// sql.js types
interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
  close(): void;
  getRowsModified(): number;
}

interface SqlJsStatement {
  bind(params?: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

interface SqlJsStatic {
  Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
}

type InitSqlJs = (config?: { locateFile?: (file: string) => string }) => Promise<SqlJsStatic>;

const IDB_NAME = 'gapscout';
const IDB_VERSION = 1;
const IDB_STORE = 'database';
const IDB_KEY = 'main';

// Debounce save operations
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 500;

export class SqlJsAdapter implements DatabaseAdapter {
  private db: SqlJsDatabase | null = null;
  private idbDatabase: IDBDatabase | null = null;

  async initialize(): Promise<void> {
    console.log('[SqlJsAdapter] Initializing sql.js...');

    // Load sql.js from CDN (more reliable than npm import for this CJS module)
    const initSqlJs = await this.loadSqlJsFromCDN();

    // Initialize sql.js with WASM from CDN
    const SQL = await initSqlJs({
      locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
    });

    // Open IndexedDB for persistence (using native API)
    this.idbDatabase = await this.openIndexedDB();

    // Try to load existing database from IndexedDB
    const savedData = await this.loadFromIndexedDB();

    if (savedData) {
      console.log('[SqlJsAdapter] Loaded existing database from IndexedDB');
      this.db = new SQL.Database(savedData);
    } else {
      console.log('[SqlJsAdapter] Creating new database');
      this.db = new SQL.Database();
    }

    console.log('[SqlJsAdapter] Database initialized successfully');
  }

  /**
   * Load sql.js from CDN
   */
  private loadSqlJsFromCDN(): Promise<InitSqlJs> {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if ((window as unknown as { initSqlJs?: InitSqlJs }).initSqlJs) {
        resolve((window as unknown as { initSqlJs: InitSqlJs }).initSqlJs);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://sql.js.org/dist/sql-wasm.js';
      script.async = true;

      script.onload = () => {
        const initSqlJs = (window as unknown as { initSqlJs?: InitSqlJs }).initSqlJs;
        if (initSqlJs) {
          console.log('[SqlJsAdapter] sql.js loaded from CDN');
          resolve(initSqlJs);
        } else {
          reject(new Error('sql.js loaded but initSqlJs not found on window'));
        }
      };

      script.onerror = () => {
        reject(new Error('Failed to load sql.js from CDN'));
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Open IndexedDB using native API
   */
  private openIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
    });
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const convertedSql = this.convertParams(sql);
    const bindParams = params?.map((p) => this.convertValue(p));

    try {
      this.db.run(convertedSql, bindParams);
      const changes = this.db.getRowsModified();

      // Schedule save to IndexedDB
      this.scheduleSave();

      return { rowsAffected: changes };
    } catch (error) {
      console.error('[SqlJsAdapter] Execute error:', error);
      console.error('[SqlJsAdapter] SQL:', convertedSql);
      console.error('[SqlJsAdapter] Params:', bindParams);
      throw error;
    }
  }

  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const convertedSql = this.convertParams(sql);
    const bindParams = params?.map((p) => this.convertValue(p));

    try {
      const stmt = this.db.prepare(convertedSql);
      if (bindParams) {
        stmt.bind(bindParams);
      }

      const results: unknown[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push(row);
      }
      stmt.free();

      // Return as T (typically an array type like SomeRow[])
      return results as T;
    } catch (error) {
      console.error('[SqlJsAdapter] Select error:', error);
      console.error('[SqlJsAdapter] SQL:', convertedSql);
      console.error('[SqlJsAdapter] Params:', bindParams);
      throw error;
    }
  }

  async close(): Promise<void> {
    // Flush any pending saves
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      await this.saveToIndexedDB();
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    if (this.idbDatabase) {
      this.idbDatabase.close();
      this.idbDatabase = null;
    }
  }

  /**
   * Convert $1, $2, $3 style params to ? placeholders
   * sql.js uses ? placeholders in order
   */
  private convertParams(sql: string): string {
    // Replace $1, $2, etc. with ?
    // We need to ensure the order is preserved
    return sql.replace(/\$\d+/g, '?');
  }

  /**
   * Convert JavaScript values to SQLite-compatible values
   */
  private convertValue(value: unknown): unknown {
    if (value === undefined) {
      return null;
    }
    return value;
  }

  /**
   * Schedule a debounced save to IndexedDB
   */
  private scheduleSave(): void {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(() => {
      this.saveToIndexedDB().catch((err) => {
        console.error('[SqlJsAdapter] Failed to save to IndexedDB:', err);
      });
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Save database to IndexedDB
   */
  private async saveToIndexedDB(): Promise<void> {
    if (!this.db || !this.idbDatabase) return;

    const data = this.db.export();

    return new Promise((resolve, reject) => {
      const transaction = this.idbDatabase!.transaction(IDB_STORE, 'readwrite');
      const store = transaction.objectStore(IDB_STORE);
      const request = store.put(data, IDB_KEY);

      request.onsuccess = () => {
        console.log('[SqlJsAdapter] Saved database to IndexedDB');
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to save to IndexedDB'));
      };
    });
  }

  /**
   * Load database from IndexedDB
   */
  private async loadFromIndexedDB(): Promise<Uint8Array | null> {
    if (!this.idbDatabase) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.idbDatabase!.transaction(IDB_STORE, 'readonly');
      const store = transaction.objectStore(IDB_STORE);
      const request = store.get(IDB_KEY);

      request.onsuccess = () => {
        const data = request.result;
        resolve(data ? new Uint8Array(data) : null);
      };

      request.onerror = () => {
        reject(new Error('Failed to load from IndexedDB'));
      };
    });
  }
}
