/**
 * Structured logger singleton.
 *
 * Funnels every store/component log through one place so a future
 * file-transport (planned follow-up to ZIP-121) can be added without
 * touching call sites. For now, transports to console only — the file
 * write to `~/.gapscout/logs/app.log` needs `@tauri-apps/plugin-fs` plus
 * a capability config, which is deferred per the scope plan's bounded
 * elegance carve-out.
 */
export const logger = {
  debug(message: string, ...args: unknown[]): void {
    console.debug(`[DEBUG] ${message}`, ...args)
  },
  info(message: string, ...args: unknown[]): void {
    console.log(`[INFO] ${message}`, ...args)
  },
  warn(message: string, ...args: unknown[]): void {
    console.warn(`[WARN] ${message}`, ...args)
  },
  error(message: string, ...args: unknown[]): void {
    console.error(`[ERROR] ${message}`, ...args)
  },
}
