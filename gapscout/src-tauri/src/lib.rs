mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    // Export suite (PRD 4.12): the dialog plugin's save() adds the chosen path to the
    // fs scope at runtime, so writing there needs no static path scope.
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    // External URLs (Help → Send feedback, future external-link chrome).
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![db::get_db_path_string])
    .setup(|app| {
      // Ensure database directory exists
      match db::ensure_db_directory() {
        Ok(db_dir) => {
          println!("Database directory ready: {:?}", db_dir);
        }
        Err(e) => {
          eprintln!("Failed to create database directory: {}", e);
          return Err(Box::new(std::io::Error::other(e)));
        }
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
