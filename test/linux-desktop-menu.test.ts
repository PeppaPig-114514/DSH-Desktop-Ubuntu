import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Windows reaches Export Session Log and About from its custom titlebar menu
 * (`src/preload/windows-menu.ts`, mounted only on win32) and macOS from the
 * application menu. Linux mounts neither chrome, so `installMenu` is the only
 * menu there and has to carry both commands itself.
 *
 * `installMenu` builds the template inline in `src/main/index.ts`, which pulls
 * in Electron and cannot be imported by a unit test. This is therefore a source
 * contract; the live menu was read back from the running main process with
 *
 *   electron --inspect=<port> .   # then: Menu.getApplicationMenu().items
 *
 * which is the read-back recorded in `docs/linux-port.md`.
 */
const projectRoot = path.resolve(import.meta.dirname, '..')

async function readMainProcessSource(): Promise<string> {
  const source = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')
  // Line wrapping is not part of the contract.
  return source.replace(/\s+/g, ' ')
}

describe('Linux desktop menu', () => {
  it('carries the commands whose only other menu is a platform-gated chrome', async () => {
    const source = await readMainProcessSource()

    // The condition that marks "the native menu bar is the only menu here".
    expect(source).toContain("const nativeMenuOnly = process.platform === 'linux'")
    // Export Session Log: the Windows titlebar menu owns it, so Linux needs it.
    expect(source).toContain('...(nativeMenuOnly ? [exportSessionEntry] : [])')
    // About: the macOS application menu owns it, so Linux needs it too.
    expect(source).toContain('...(nativeMenuOnly ? [aboutEntry, { type: \'separator\' as const }] : [])')
  })

  it('routes both entries through the shared command and About implementations', async () => {
    const source = await readMainProcessSource()

    // Export Session Log must reuse the same command path as the Windows menu
    // instead of a second implementation that can drift from it.
    expect(source).toContain("void executeDesktopMenuCommand('export-session').catch(showUnexpectedError)")
    // About must open the same dialog/overlay the macOS menu opens.
    expect(source).toContain('void showAbout(mainWindow).catch(showUnexpectedError)')
  })

  it('labels both entries in Chinese and English', async () => {
    const source = await readMainProcessSource()

    expect(source).toContain("isChinese ? '导出 Session 日志…' : 'Export Session Log…'")
    expect(source).toContain("isChinese ? '关于 DSH Desktop' : 'About DSH Desktop'")
  })

  it('keeps About reachable on macOS as well', async () => {
    const source = await readMainProcessSource()

    // The darwin app menu and the Linux native menu share one entry definition;
    // losing the macOS placement would be a regression on the reference platform.
    expect(source).toContain('submenu: [ aboutEntry, {')
  })
})
