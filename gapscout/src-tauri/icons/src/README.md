# Icon masters

Two 1024² masters, exported from the design project's `export/` folder
(`GapScout App Icon.dc.html`, mark 3b, the viewfinder). Everything in the
parent folder is generated from them; edit the design, re-export, regenerate.

| File | Shape |
|---|---|
| `gapscout-icon-square-1024.png` | Full bleed, no margin, no rounding, no shadow. Source for every output except `icon.icns`. |
| `gapscout-icon-macos-1024.png` | Transparent canvas, an 824² squircle centred with 100 px clear all round, corner radius 185, shadow baked in. Source for `icon.icns` only, because macOS insets its own art and a full-bleed icon sits about 20% oversized in the Dock. |

Regenerate from `gapscout/`:

```bash
pnpm tauri icon src-tauri/icons/src/gapscout-icon-square-1024.png
mac=$(mktemp -d)
pnpm tauri icon src-tauri/icons/src/gapscout-icon-macos-1024.png --output "$mac"
cp "$mac/icon.icns" src-tauri/icons/icon.icns
rm -rf src-tauri/icons/android src-tauri/icons/ios src-tauri/icons/64x64.png
```

The last line removes outputs the CLI adds that nothing here consumes:
`bundle.icon` in `tauri.conf.json` names `32x32.png`, `128x128.png`,
`128x128@2x.png`, `icon.icns` and `icon.ico`; the `Square*Logo.png` and
`StoreLogo.png` set is the MSIX set and stays with the folder.

macOS caches icons hard; `killall Dock Finder` after installing a build.
