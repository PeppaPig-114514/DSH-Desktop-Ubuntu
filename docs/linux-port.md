# DSH Desktop on Linux

DSH Desktop was published for macOS and Windows only. This guide covers the
Linux port that is tracked in this tree: which parts of the desktop shell are
platform-specific, how to build and install the Linux packages, and which
capabilities intentionally stay unavailable.

The port keeps the existing architecture. Electron Main still hosts the
Harness runtime, the renderer is still the upstream Harness Web UI served on a
random loopback port, and the desktop customizations still arrive through the
tracked patch layer.

## What the port adds

| Area | Change |
| --- | --- |
| Packaging | `linux` (`deb` + `AppImage`), `deb`, and `appImage` sections in `package.json`; `package:linux`, `package:linux:dir`, and `package:dev:linux` scripts |
| Harness runtime | Linux uses the bundled target-native Node.js runtime, the same path Windows uses; macOS keeps its Electron `UtilityProcess` |
| Debian dependencies | The default `libgtk-3-0` / `libatspi2.0-0` names no longer exist after the Ubuntu 24.04 `t64` transition, so the Linux package declares alternatives that resolve on both older and newer releases |
| Chromium sandbox | Debian `postinst` restores the SUID `chrome-sandbox` helper and installs an AppArmor `userns` profile; `postrm` removes the profile; the AppImage launcher falls back to `--no-sandbox` |
| Target verification | `scripts/verify-target.mjs` already validates `linux/x64` and the bundled Node.js runtime; no change was needed |

## Prerequisites

- Ubuntu 24.04 or newer (Debian 13+) on x64, or another distribution with the
  same libraries
- Node.js 22 or later and npm
- No additional build toolchain: Electron, the Harness runtime, and the PPT
  runtime are downloaded as prebuilt or JavaScript packages

## Build

```bash
npm ci                 # postinstall applies patches, brand assets, Electron
npm run build          # PPT runtime + main/preload bundles
npm run package:linux  # deb + AppImage into dist/
```

Individual targets:

```bash
npm run package:linux:dir   # unpacked dist/linux-unpacked, fastest to test
npm run package:dev:linux   # development channel (name/appId suffix "dev")
npx electron-builder --linux deb --x64 --publish never
```

Only build each artifact on the operating system and architecture that will run
it. The packaged app contains architecture-specific native modules and a 129 MB
target-native Node.js runtime, so cross-building a Linux package from macOS or
Windows is not supported.

### Builds without a writable `$HOME`

electron-builder and `@electron/get` cache downloads in `$HOME` by default.
When `$HOME` is read-only (containers, sandboxes), point the caches at a
writable directory:

```bash
export XDG_CACHE_HOME="$PWD/.cache/xdg"
export ELECTRON_BUILDER_CACHE="$PWD/.cache/electron-builder"
export electron_config_cache="$PWD/.cache/electron"
npm run package:linux
```

## Install and run

The Debian package is the recommended artifact: it keeps the Chromium sandbox,
installs a desktop entry, and installs the AppArmor profile described below.

```bash
sudo apt install ./dist/dsh-desktop-linux-x64.deb
```

The application lands in `/opt/DSH Desktop` and can be started from the
application grid or with `dsh-desktop`.

The AppImage is portable but unsigned and runs without the Chromium sandbox:

```bash
chmod +x dist/dsh-desktop-linux-x86_64.AppImage
./dist/dsh-desktop-linux-x86_64.AppImage
```

## The Chromium sandbox on Ubuntu 23.10 and newer

Chromium starts its renderer inside a sandbox. It prefers the SUID helper
`chrome-sandbox`, which must be owned by root with mode 4755. When that helper
is missing it falls back to an unprivileged user namespace, and when it is
present but unusable it aborts with `The SUID sandbox helper binary was found,
but is not configured correctly`.

Both paths are blocked out of the box for a locally built package:

- The build runs as an unprivileged user, so `chrome-sandbox` ships as mode
  0755 owned by that user — present, but not usable.
- Ubuntu 23.10 and newer ship
  `kernel.apparmor_restrict_unprivileged_userns=1`, which denies user namespace
  creation to programs that have no AppArmor profile, so the namespace fallback
  aborts with `No usable sandbox!`.

This affects every unsigned Electron build on those releases, not only DSH
Desktop. The port handles it the same way `google-chrome-stable` does, with both
mechanisms:

- `build/linux-after-install.sh` (Debian `postinst`, run as root) chowns
  `chrome-sandbox` to `root:root` and restores mode 4755, then writes
  `/etc/apparmor.d/dsh-desktop` from `build/dsh-desktop.apparmor` with the
  installed executable path substituted, and loads it with `apparmor_parser`.
  The profile is `flags=(unconfined)` plus `userns,` — the exact shape Ubuntu
  ships for Chrome and Chromium — so it only lifts the namespace restriction and
  grants no extra access. `build/linux-after-remove.sh` (`postrm`) unloads and
  removes it again.
- The AppImage can do neither without root: its squashfs image cannot carry a
  root-owned SUID helper, and it cannot install a profile. `appImage.executableArgs`
  therefore launches it with `--no-sandbox`.

Run `ls -l '/opt/DSH Desktop/chrome-sandbox'` after installing the deb to confirm
the helper shows `-rwsr-xr-x root root`; if a later copy of the tree loses that,
the AppArmor profile keeps the namespace sandbox working as long as
`chrome-sandbox` is removed or made usable again.

To keep the sandbox with an AppImage instead:

```bash
./dist/dsh-desktop-linux-x86_64.AppImage --appimage-extract
sudo tee /etc/apparmor.d/dsh-desktop >/dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>

profile dsh-desktop "$PWD/squashfs-root/dsh-desktop" flags=(unconfined) {
  userns,
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/dsh-desktop
./squashfs-root/dsh-desktop
```

## Local data

| Path | Contents |
| --- | --- |
| `/opt/DSH Desktop` | Installed application and bundled Harness runtime |
| `~/.config/dsh-desktop` | Production user data (or `$XDG_CONFIG_HOME/dsh-desktop`) |
| `~/.config/dsh-desktop/harness` | `DSH_HOME`: profiles, sessions, settings, credentials |
| `~/.config/dsh-desktop/logs/harness.log` | Desktop and Harness startup diagnostics |
| `~/.config/dsh-desktop-dev` | Development-channel data, kept separate from production |
| `~/.config/dsh-desktop/bin` | Cached helper binaries such as `cloudflared` |

The first launch offers to import an existing `~/.dsh` Harness home. The import
copies sessions, settings, credentials, presets, and workspaces into the
desktop profile and records the decision in
`.web-import-decision.json`; the original `~/.dsh` tree is never moved or
modified.

## Platform differences that remain

- **In-app updates** stay disabled. `supportsAutoUpdates()` covers packaged
  macOS and Windows builds, so the update surfaces report `unsupported` on
  Linux. Reinstall the new package to upgrade.
- **Crash reporting** is disabled. `desktopPlatform()` in
  `src/main/desktop-service/service.ts` has no Linux value, so
  `initializeDesktopService()` logs one warning and the app continues without
  diagnostics. Adding a Linux value would send reports to a service that only
  knows the macOS and Windows platforms.
- **Tray icon and close-to-tray** stay Windows-only (`ensureTray()` and
  `shouldKeepRunningInBackground()`), so closing the window quits the app, which
  matches Linux desktop conventions. The AppImage/deb desktop entry exposes the
  same menu commands through the in-window menu bar.
- **macOS-only recovery** — LaunchAgent auditing and quarantine — stays inert:
  both entry points return early on non-macOS platforms.
- **Directory picker, phone pairing, safe mode, plugin recovery, PPT mode, and
  workbenches** are platform-agnostic and work unchanged. `cloudflared` already
  has Linux x64/arm64 download entries for the optional public tunnel.

## Verifying a Linux build

```bash
npm run typecheck
npm test
npm run package:linux:dir
XDG_CONFIG_HOME=/tmp/dsh-linux-check ./dist/linux-unpacked/dsh-desktop
```

The development-channel run writes to `$XDG_CONFIG_HOME/dsh-desktop-dev`; a
packaged run writes to `$XDG_CONFIG_HOME/dsh-desktop`. A healthy launch ends with
`Harness is ready` in `<userData>/logs/harness.log`, and the Harness Web UI loads
in the window. On a machine without a usable GPU the shell may relaunch itself
once or twice while its GPU fallback ladder settles; that state is stored in
`gpu-fallback.json`.

Run `npm test` with a writable `$HOME` (or a writable `XDG_DATA_HOME`). The
generation installer tests drive a real `pnpm` process, which needs to create its
store under `$XDG_DATA_HOME/pnpm`; a read-only home fails those two cases with
`ENOENT`/`EROFS` even though the port is fine.

The port was verified on Ubuntu 26.04 x64 (kernel 7.0, NVIDIA RTX 4070 Ti):

- `npm run build`, `npm run typecheck`, and `npm test` (1490 tests) pass.
- `npm run package:linux` produces `dsh-desktop-linux-amd64.deb` and
  `dsh-desktop-linux-x86_64.AppImage`.
- Both the unpacked build and the AppImage start the bundled Node.js 24.9.0
  Harness runtime from `resources/app.asar.unpacked`, reach `Harness is ready` on
  the loopback endpoint, and render the full Harness UI — sidebar, sessions,
  composer, PPT mode, and the desktop plugins injected by the patch layer.
- `apparmor_parser -Q --skip-cache` accepts `build/dsh-desktop.apparmor` with the
  installed path substituted, including the space in `/opt/DSH Desktop`.

The SUID helper and AppArmor profile can only be exercised by a real install,
because dpkg runs the `postinst` as root:

```bash
sudo apt install ./dist/dsh-desktop-linux-amd64.deb
ls -l '/opt/DSH Desktop/chrome-sandbox'      # expect -rwsr-xr-x root root
sudo aa-status | grep dsh-desktop            # expect the loaded profile
```
