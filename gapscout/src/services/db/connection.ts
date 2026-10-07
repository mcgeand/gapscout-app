import type { DatabaseAdapter } from "./dbInterface";

let _adapter: DatabaseAdapter | null = null;

export function getDB(): DatabaseAdapter {
  if (!_adapter) {
    throw new Error("Database not initialized. Call initDB() first.");
  }
  return _adapter;
}

export function setDB(adapter: DatabaseAdapter): void {
  if (_adapter) {
    void _adapter.close();
  }
  _adapter = adapter;
}
