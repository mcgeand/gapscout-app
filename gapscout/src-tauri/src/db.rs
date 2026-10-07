use std::fs;
use std::path::PathBuf;

/// Get the database directory path
/// Default: ~/.gapscout/
pub fn get_db_dir() -> Result<PathBuf, String> {
  let home_dir = dirs::home_dir().ok_or("Could not determine home directory")?;
  Ok(home_dir.join(".gapscout"))
}

/// Full path to gapscout.db (`~/.gapscout/gapscout.db` today).
///
/// Exposed as a Tauri command so Help → About and diagnostics never rebuild
/// this in JS. When #123 adds a configurable override, change this function
/// alone — the frontend will follow.
pub fn get_db_path() -> Result<PathBuf, String> {
  let db_dir = get_db_dir()?;
  Ok(db_dir.join("gapscout.db"))
}

/// Ensure the database directory exists
/// Creates ~/.gapscout/ if it doesn't exist
pub fn ensure_db_directory() -> Result<PathBuf, String> {
  let db_dir = get_db_dir()?;

  if !db_dir.exists() {
    fs::create_dir_all(&db_dir)
      .map_err(|e| format!("Failed to create database directory: {}", e))?;
    println!("Created GapScout database directory: {:?}", db_dir);
  }

  Ok(db_dir)
}

/// OS-native string for Help → About / Copy diagnostics.
#[tauri::command(name = "get_db_path")]
pub fn get_db_path_string() -> Result<String, String> {
  get_db_path().map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Database schema SQL (embedded at compile time). Test-only: production
  /// schema creation is owned by the frontend (`src/services/db.ts`).
  const SCHEMA_SQL: &str = include_str!("schema.sql");

  /// Get the database schema SQL
  fn get_schema() -> &'static str {
    SCHEMA_SQL
  }

  #[test]
  fn test_db_paths() {
    let db_dir = get_db_dir().expect("Should get db dir");
    assert!(db_dir.to_string_lossy().contains(".gapscout"));

    let db_path = get_db_path().expect("Should get db path");
    assert!(db_path.to_string_lossy().contains("gapscout.db"));
  }

  #[test]
  fn test_schema_loads() {
    let schema = get_schema();
    assert!(schema.contains("CREATE TABLE"));
    assert!(schema.contains("projects"));
    assert!(schema.contains("steps"));
  }
}
