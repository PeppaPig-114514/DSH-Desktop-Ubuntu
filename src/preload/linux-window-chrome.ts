/**
 * Announce the Linux desktop host to Harness's client modules before they mount.
 *
 * Harness reads `data-platform` for its window geometry and the desktop geometry
 * patches key off it. Leaving it unset does not mean "Linux": the patches express
 * "the host that reserves a native caption strip" as the absence of
 * `data-platform`, which is why Windows leaves it unset and why an unset
 * attribute gives Linux 32px of dead space above the sidebar.
 *
 * The browser-keyboard escape hatch is mandatory, not cosmetic: Harness throws
 * `Desktop keyboard bridge unavailable` when it resolves `runtime: desktop`
 * without `window.dshDesktop.keyboard`, and this host exposes no such bridge.
 * `runtime` therefore stays `web` and only the platform becomes explicit, which
 * matches what `macos-window-chrome.ts` does for macOS.
 */
export function mountLinuxWindowChrome(doc: Document): () => void {
  const mark = (): void => {
    const root = doc.documentElement
    if (!root) return
    root.dataset.dshDesktopWebShortcuts = 'true'
    root.dataset.platform = 'linux'
  }
  mark()
  doc.addEventListener('DOMContentLoaded', mark, { once: true })
  return () => doc.removeEventListener('DOMContentLoaded', mark)
}
