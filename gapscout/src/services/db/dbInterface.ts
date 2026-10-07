/**
 * Database adapter interface
 * Abstracts the underlying database implementation (Tauri SQL or sql.js)
 */

export interface QueryResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface DatabaseAdapter {
  /**
   * Initialize the database connection
   * Should be called once at app startup
   */
  initialize(): Promise<void>;

  /**
   * Execute a SQL statement that modifies data (INSERT, UPDATE, DELETE)
   * @param sql - SQL statement with $1, $2, etc. placeholders
   * @param params - Parameter values
   */
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;

  /**
   * Execute a SQL query that returns data (SELECT)
   * @param sql - SQL statement with $1, $2, etc. placeholders
   * @param params - Parameter values
   * @returns The result rows (T should be the full return type, e.g., SomeRow[])
   */
  select<T>(sql: string, params?: unknown[]): Promise<T>;

  /**
   * Close the database connection
   */
  close(): Promise<void>;
}
