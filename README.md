# GapScout

Find gaps. Fix flows.

GapScout is a desktop app for SIPOC process mapping and gap analysis. You describe a process, GapScout turns it into steps, and you raise gaps against the steps that are missing or broken. Everything lives in a SQLite file on your own machine. Nothing is uploaded.

GapScout is in **beta**. Expect rough edges, and please tell us about them.

## Download

Get the latest build from [Releases](https://github.com/mcgeand/gapscout-app/releases/latest).

| System | File |
| --- | --- |
| macOS (Apple silicon and Intel) | `GapScout_<version>_universal.dmg` |
| Windows 10 / 11 (64-bit) | `GapScout_<version>_x64_en-US.msi` (recommended) or `GapScout_<version>_x64-setup.exe` |

### Opening it the first time

The beta builds are not yet signed by Apple or Microsoft, so both systems warn you once.

- **macOS.** Open the DMG and drag GapScout to Applications. The first time you open it, macOS says it cannot verify the developer. Close that message **without** choosing Move to Trash. Then open **System Settings → Privacy & Security**, scroll to the message about GapScout, and choose **Open Anyway**.
- **Windows.** If SmartScreen shows "Windows protected your PC", choose **More info → Run anyway**.

You only need to do this once per install.

## Updates

GapScout checks for a new version when it starts. If there is one, it asks first. Choose **Update** to download, verify and install it, or **Later** to be asked again next launch. Updates are signed, and a build that fails verification is not installed.

## Your data

Your projects are stored in one file:

- macOS: `~/.gapscout/gapscout.db`
- Windows: `%USERPROFILE%\.gapscout\gapscout.db`

Help → About shows the exact path. There is no built-in backup yet, so during the beta **copy that file somewhere safe** now and then, with GapScout closed. Uninstalling the app leaves the file where it is.

## Feedback and bugs

In the app, open **Help → About** (`⌘/` or `Ctrl+/`):

- **Send feedback** opens a new issue here with your app version, OS and database details filled in.
- **Copy diagnostics** copies the same details, for pasting into an issue you write yourself.

Or open an issue directly: [report a bug](https://github.com/mcgeand/gapscout-app/issues/new?template=bug_report.yml) · [share feedback](https://github.com/mcgeand/gapscout-app/issues/new?template=feedback.yml).

Issues here are public, so please leave out anything confidential about the processes you map. To report a security problem, see [SECURITY.md](SECURITY.md).

## Privacy

GapScout makes one network request on its own: the update check at launch, which fetches `latest.json` from this repository's releases. Opening Send feedback opens your browser; nothing is sent until you submit the issue yourself.

## Building from source

The source in this repository is a snapshot of each release. You need Node.js 24, pnpm 10 and Rust; the Rust toolchain is pinned in `gapscout/src-tauri/rust-toolchain.toml`.

```bash
cd gapscout
pnpm install
pnpm tauri dev
```

```bash
pnpm test:run
pnpm typecheck
pnpm lint
```

More detail is in [gapscout/README.md](gapscout/README.md). Pull requests are welcome, but development happens elsewhere and changes are carried across by hand, so please open an issue first to talk it through.

## License

[MIT](LICENSE)
