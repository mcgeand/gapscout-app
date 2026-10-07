# GapScout

Find gaps. Fix flows. A local-first desktop app for SIPOC process mapping and gap analysis.

The repository overview, install notes and documentation index are in the [root README](../README.md). This file is how to run the app from source.

## Requirements

- Node.js 24
- pnpm 10 (`packageManager` in `package.json`)
- Rust, from `src-tauri/rust-toolchain.toml`

## Run

```bash
pnpm install
pnpm tauri dev
```

The database is created at `~/.gapscout/gapscout.db` (a `.gapscout` folder in the home directory). It is only available inside the Tauri shell. `pnpm dev` serves the UI and cannot open a project.

## Commands

```bash
pnpm tauri dev       # desktop app
pnpm tauri build     # installer for this machine's architecture
pnpm test:run
pnpm typecheck
pnpm lint
pnpm build           # frontend only
```

A release DMG carries both Apple silicon and Intel slices. That needs the Intel target installed once, then an explicit target:

```bash
rustup target add x86_64-apple-darwin
pnpm tauri build --target universal-apple-darwin
```

The DMG lands in `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`. Confirm both slices:

```bash
lipo -archs src-tauri/target/universal-apple-darwin/release/bundle/macos/GapScout.app/Contents/MacOS/gapscout
```

That build is ad-hoc signed, so Gatekeeper blocks it on a machine that downloaded it. Signing and notarisation are not done yet; the top-level README says how to open it anyway.

## Keyboard shortcuts

These are the shortcuts the app actually binds.

| Shortcut | Action |
| --- | --- |
| `⌘B` / `Ctrl+B` | Collapse or expand the sidebar |
| `⌘F` / `Ctrl+F` | Search the open project |
| `⌘/` / `Ctrl+/` | Help & About |
| `Esc` | Close the topmost dialog |

`⌘F` does nothing until a project is open. There is no command palette.

## Layout

```
src/            React frontend
  app/          shell, routes
  pages/        project list, process board
  components/   discovery, diagram, gaps, registries, export
  state/        one Zustand store per entity
  services/     database access
  data/         types and Zod schemas
  styles/       design tokens
src-tauri/      Rust backend, SQLite schema, Tauri config
```

Colour, spacing and type are defined once, in `src/styles/globals.css`.

## Troubleshooting

**Failed to initialize database.** Run `pnpm tauri dev`, not `pnpm dev`.

**First launch is slow.** The first Rust compile takes a few minutes. After that the UI hot-reloads.

**Port 5173 is in use.** Stop the other process listening on it and start again.

## License

MIT
