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
| Harness runtime | Linux uses the bundled target-native Node.js runtime; macOS keeps its Electron `UtilityProcess`. Upstream `edb4398` later moved Windows to the packaged Electron binary in Node mode, so Linux is now the only platform that ships the standalone runtime |
| Debian dependencies | The default `libgtk-3-0` / `libatspi2.0-0` names no longer exist after the Ubuntu 24.04 `t64` transition, so the Linux package declares alternatives that resolve on both older and newer releases |
| Chromium sandbox | Debian `postinst` restores the SUID `chrome-sandbox` helper and installs an AppArmor `userns` profile; `postrm` removes the profile; the AppImage launcher falls back to `--no-sandbox` |
| Target verification | `scripts/verify-target.mjs` already validates `linux/x64` and the bundled Node.js runtime; no change was needed |

## Tracking the upstream build

The port adds packaging and platform fixes on top of the upstream tree; it does
not fork the shared code. The reference implementation is the Windows (and
macOS) build, so upstream work is merged rather than reimplemented.

This branch was cut from upstream `v0.10.0` and then merged forward to the
current `origin/v0.10.0`. The merge carried one fix that the port needed badly,
upstream `85ca438` ("Avoid duplicate web import preload bridge"), which removed a
second `contextBridge.exposeInMainWorld('dshWebImport', …)` call.

`contextBridge` throws `Cannot bind an API on top of an existing property on the
window object` on the second exposure of the same key, and nothing in the preload
catches it. The duplicate sat at module scope, so every statement after it was
unreachable: `initializeUi()` and with it the About overlay, the Connect Phone
button, the Safe Mode banner, the boot-failure overlay, the update banner, and
the `updates:status-changed` / `desktop:show-about` listeners. The window still
painted the Harness UI, so the build looked healthy while the whole
preload-injected desktop layer was dead — which is why the shipped `0.1.1`
package offered no About anywhere and no phone button.

Re-check what the reference has moved on to with:

```bash
git fetch origin --tags
git log --oneline <port-base>..origin/v0.10.0
git merge origin/v0.10.0     # conflicts are usually the platform blocks below
```

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
  Linux. This is enforced by the service, not only by that local gate: the
  update endpoint rejects the platform the desktop would send, and no Linux
  artifact is published to the feed.

  ```console
  $ curl -sS 'https://dshdesktop.com/crash/v1/updates/check?installationId=…&currentVersion=0.1.0&platform=linux'
  {"error":"Invalid request","issues":[{"code":"invalid_value","values":["mac","mac-intel","windows"],
   "path":["platform"],"message":"Invalid option: expected one of \"mac\"|\"mac-intel\"|\"windows\""}]}
  $ curl -sSL -o /dev/null -w '%{http_code}\n' https://dshdesktop.com/updates/latest/latest-linux.yml
  404
  ```

  A Linux value in `desktopPlatform()` would therefore change nothing by itself;
  enabling updates needs the service to accept the platform and to publish
  `latest-linux.yml` beside `latest.yml`. Reinstall the new package to upgrade.
- **Crash reporting** is disabled for the same reason. `desktopPlatform()` in
  `src/main/desktop-service/service.ts` has no Linux value, so
  `initializeDesktopService()` logs one warning and the app continues without
  diagnostics. The service knows the macOS and Windows platforms only, so a
  report Linux sent would be rejected exactly like the update check above.
- **The menu bar carries two commands the other chromes own.** Windows reaches
  Export Session Log and About from its custom titlebar menu and macOS from the
  application menu. Both of those chromes are platform-gated, and neither is
  mounted on Linux, so `installMenu` adds the two entries itself when
  `process.platform === 'linux'`. Removing them leaves the commands implemented
  but offered by no menu.
- **Tray icon and close-to-tray** stay Windows-only (`ensureTray()` and
  `shouldKeepRunningInBackground()`), so closing the window quits the app. A
  Linux tray needs a StatusNotifier host, which stock GNOME only provides
  through an extension; hiding the window into a tray that never appears would
  strand the user with no way back to the window. Closing the window therefore
  stops the Harness and any session it is running, as on macOS.
- **Keyboard shortcuts start unbound.** Harness declares browser defaults for
  macOS and Windows but none for Linux, so every command resolves an empty
  `web:linux` profile. This cannot be fixed by borrowing another profile:
  `register()` validates all six runtime/platform pairs and throws
  `Unsupported Web shortcut` for any browser-on-Linux binding outside its allow
  list, which takes `dsh-client-ui-layout` down with it. Binding them needs the
  native keyboard bridge described below.
- **macOS-only recovery** — LaunchAgent auditing and quarantine — stays inert:
  both entry points return early on non-macOS platforms.
- **Directory picker, phone pairing, safe mode, plugin recovery, PPT mode, and
  workbenches** are platform-agnostic and work unchanged. `cloudflared` already
  has Linux x64/arm64 download entries for the optional public tunnel.

## The frontend on Linux

The shell contributes only window chrome; the interface itself is the upstream
Harness Web UI, so "porting the frontend" means telling that UI which platform it
is running on. Harness reads `data-platform` from `<html>` before its client
modules mount, and the desktop patches key their geometry off it.

macOS announces `darwin` (`src/preload/macos-window-chrome.ts`). Windows
deliberately announces nothing, so the patches express "the host that reserves a
native caption strip" as the absence of the attribute. Linux announced nothing
either and therefore inherited the Windows geometry: the sidebar carried a
`padding-top:32px` meant to clear a caption strip that a natively framed Linux
window does not have. Measured in a running window, the sidebar's own padding was
`32px` before and `6px` after, with the conversation header unchanged at `10px`.

`src/preload/linux-window-chrome.ts` now announces `linux`, and the two geometry
patches scope the Windows rules as
`html:not([data-platform=darwin]):not([data-platform=linux])` — explicit rather
than "no attribute", so a future platform that announces itself cannot silently
inherit the caption strip.

Announcing the platform alone is not enough. Harness throws
`Desktop keyboard bridge unavailable` when it resolves `runtime: desktop`
without `window.dshDesktop.keyboard`, and this host exposes no such bridge, so
the new module also sets `dshDesktopWebShortcuts` exactly as the macOS chrome
does. `runtime` therefore stays `web` and only the platform becomes explicit.

Sharing the Windows defaults is not an option for the keyboard layer. Ten of the
eleven commands that register shortcut defaults declare `desktop:linux`,
`web:macos` and `web:windows`, but only `shortcuts.open` declares `web:linux`,
because a browser on Linux can be trusted with almost no key combinations.
`register()` enforces that when a command registers, across every profile:

```js
if (runtime === "web" && !isWebBindingAllowed(binding, platform))
  throw new Error(`Unsupported Web shortcut: ${command.id}`);
```

Falling back from `web:linux` to `web:windows` therefore throws during
registration, and because `dsh-client-ui-layout` registers `sidebar.left.toggle`
the whole client module graph fails with `required client modules failed to
activate` and the app drops into plugin recovery. Closing this gap means
implementing the native keyboard bridge and letting Linux resolve
`runtime: desktop` against the `desktop:linux` defaults upstream already ships —
a deliberate piece of work, not a one-line patch.

## App icons

`build/icon.png` is not an app icon. `scripts/install-brand-assets.mjs` turns it
into the Web favicon (`dsh-desktop-logo.png`) and the page's `<link rel="icon">`;
it is light artwork, 1254px wide, and has no alpha channel. Pointing `linux.icon`
at it was wrong twice over:

- A single PNG makes electron-builder name the icon-theme directory after the
  image's pixel width, so the deb and the AppImage installed exactly one entry,
  `/usr/share/icons/hicolor/1254x1254/apps/dsh-desktop.png`. No icon loader reads
  that directory, so `Icon=dsh-desktop` resolved to nothing and the dock,
  launcher and app switcher fell back to a generic placeholder.
- The artwork itself differed from Windows and macOS, which build `icon.ico` and
  `icon.icns` from `build/app-icon.png`.

`linux.icon` is now `build/icons`, filled with the freedesktop size ladder (16,
22, 24, 32, 36, 48, 64, 72, 96, 128, 192, 256, 512) rendered from
`build/app-icon.png` — the same source as the Windows and macOS icons, and the
file `resources/icon.png` already used for the window icon. Both targets install
all thirteen sizes, and the AppImage points `.DirIcon` at the 512px entry.

`npm run icons:generate` produces all three formats from `build/app-icon.png`.
It used to shell out to the macOS-only `sips`/`iconutil` for the Windows and
macOS containers, which meant a Linux contributor could not refresh the committed
icons at all; the containers are written in Node now, so one command produces the
same set on any host. The ICNS carries the PNG chunk types `iconutil` emits
(`ic07`–`ic14`); the long-obsolete raw `ic04`/`ic05` frames are not reproduced.
`test/app-icon-set.test.ts` reads every ICO frame and ICNS chunk back out,
checks the container length macOS trusts, checks each frame against its declared
size, and fails if the committed ladder drifts from `build/app-icon.png`.

## The brand mark

DSH Desktop shipped its own mark — a whale drawn as a window with a tail
(`BRAND_MARK_PATH`) — and registered it over both of Harness's brand seats, so
the sidebar, the onboarding header and the splash loader all showed it while the
conversation hero showed the official whale. Three copies of that path existed
and the rasters were hand-drawn, which is how the icon theme ended up with a
light artwork file that matched none of the other icons.

The mark is now Harness's own whale, taken from
`@deepseek-ai/dsh-client-ui-primitives` — `FISH_LOGO_PATH` with its native
23.16×17.04 viewBox. There is one authoritative copy in the repository,
`build/brand-mark.svg`, and the UI seats render the shared `FishLogo` primitive
rather than a private path:

```bash
npm run brand:generate    # build/brand-mark.svg -> app-icon.png, icon.png, logo-*.png
npm run icons:generate    # app-icon.png -> icon.ico, icon.icns, build/icons/*
npm run loader:generate   # build/brand-mark.svg -> the two splash loaders
```

`brand:generate` also reruns `scripts/install-brand-assets.mjs`, which is the
postinstall step that propagates `icon.png` and the two logo files into
`node_modules/@deepseek-ai/dsh-web-frontend/dist`. Packaging copies those, not
the `build/` originals, so regenerating the artwork without that step ships the
previous favicon — the mistake is silent until the deb is opened.

`scripts/generate-brand-assets.mjs` keeps the composition the hand-drawn files
had, so only the mark changed: the app icon is still the same dark rounded tile
(`#0d1616`, 824px inside a 1024px canvas, 185px radius) with the mark at its
previous optical height, the favicon is still a blue mark on a light plate, and
the logo companions are still the mark in black and white. The splash loader
quantises the same silhouette onto its 4px grid and now spouts its bubbles from
the whale's back instead of the window's traffic lights.

`test/brand-mark.test.ts` compares `build/brand-mark.svg` against the primitive's
geometry and fails if either UI seat carries a private copy of the retired path.

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

- `npm run package:linux` produces `dsh-desktop-linux-amd64.deb` and
  `dsh-desktop-linux-x86_64.AppImage`.
- Both the unpacked build and the AppImage start the bundled Node.js 24.9.0
  Harness runtime from `resources/app.asar.unpacked`, reach `Harness is ready` on
  the loopback endpoint, and render the full Harness UI — sidebar, sessions,
  composer, PPT mode, and the desktop plugins injected by the patch layer.
- `apparmor_parser -Q --skip-cache` accepts `build/dsh-desktop.apparmor` with the
  installed path substituted, including the space in `/opt/DSH Desktop`.

After the upstream merge, `npm run typecheck`, `npm run build`, and `npm test`
(1502 passed, 4 skipped) were re-run on the same host. Two things the test suite
cannot reach need a running app, and both were read back from a development
instance started with:

```bash
XDG_CONFIG_HOME=/tmp/dsh-linux-check \
  node_modules/electron/dist/electron --inspect=9333 . \
  --remote-debugging-port=9334 --no-sandbox --password-store=basic
```

- **The preload layer.** `http://127.0.0.1:9334/json` exposes the renderer, where
  the preload-injected roots `dsh-desktop-about-root`, `dsh-desktop-update-root`
  and `dsh-desktop-mobile-button` appear once `initializeUi()` has run. Copying
  the built `out/preload/index.cjs`, re-adding the duplicate `dshWebImport`
  exposure, and reloading the page removes all three — the failure the shipped
  `0.1.1` package had. The phone button is injected from the DOM observer, so it
  follows an animation frame and stays absent while the window is hidden.
- **The menu.** `http://127.0.0.1:9333/json` exposes the main process. The main
  bundle is ESM, so `Menu` is reached through
  `process.getBuiltinModule('module').createRequire(…)( 'electron')` rather than
  `require`. On Linux `Menu.getApplicationMenu().items` then lists 连接手机…,
  重启 Harness, 以安全模式重启…, 查看 Harness 日志, 检查更新…,
  导出 Session 日志…, 关于 DSH Desktop and Quit.

`test/linux-desktop-menu.test.ts` keeps that menu coverage from being dropped
again, as a source contract over `installMenu`; `test/preload-bridge-uniqueness.test.ts`
(from upstream) is the behavioural guard for the bridge.

Frontend geometry is measured the same way, on the renderer that
`http://127.0.0.1:<debug port>/json` exposes:

```js
const root = document.documentElement
const sidebar = document.querySelector('[data-dsh-sidebar-root]')
JSON.stringify({
  platform: root.dataset.platform,                         // 'linux'
  webShortcuts: root.dataset.dshDesktopWebShortcuts,       // 'true'
  sidebarPaddingTop: getComputedStyle(sidebar).paddingTop   // '6px', was '32px'
})
```

`test/linux-window-chrome.test.ts` covers the same ground without a window: it
mounts the module in jsdom, evaluates the patched `detectEnvironment` and
`resolveShortcutDefault` out of the Harness client bundle, and reads the two
geometry patches. Both halves fail if the escape hatch is dropped or the Linux
scope is removed from a patch.

Packaged icons are read back out of the artifacts, because that is where both
failures lived — a source image that was not an app icon, and a directory name
no icon loader understands:

```bash
dpkg-deb -c dist/dsh-desktop-linux-amd64.deb | grep hicolor
```

Expect one `apps/dsh-desktop.png` under each standard size directory and no
`hicolor/<nonstandard width>/`. Every packaged file's pixel dimensions must match
the directory it sits in; `test/app-icon-set.test.ts` asserts that for the
source ladder and pins it to `build/app-icon.png`.

The SUID helper and AppArmor profile can only be exercised by a real install,
because dpkg runs the `postinst` as root:

```bash
sudo apt install ./dist/dsh-desktop-linux-amd64.deb
ls -l '/opt/DSH Desktop/chrome-sandbox'      # expect -rwsr-xr-x root root
sudo aa-status | grep dsh-desktop            # expect the loaded profile
```
