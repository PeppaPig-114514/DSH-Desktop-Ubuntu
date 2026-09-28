// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { mountLinuxWindowChrome } from '../src/preload/linux-window-chrome'

async function readShortcutsClient(): Promise<string> {
  return readFile('node_modules/@deepseek-ai/dsh-client-shortcuts/lib/client.js', 'utf8')
}

function extract(source: string, signature: string): string {
  const pattern = new RegExp(`function ${signature}\\([^)]*\\) \\{[\\s\\S]*?\\n\\t\\t\\}`)
  const fn = source.match(pattern)?.[0]
  expect(fn, signature).toBeDefined()
  return fn as string
}

it('marks the Linux platform and the Web keyboard adapter before the client modules mount', () => {
  const doc = document.implementation.createHTMLDocument()
  const dispose = mountLinuxWindowChrome(doc)
  expect(doc.documentElement.dataset.platform).toBe('linux')
  expect(doc.documentElement.dataset.dshDesktopWebShortcuts).toBe('true')
  dispose()
})

it('marks the root again on DOMContentLoaded and stops listening on dispose', () => {
  const doc = document.implementation.createHTMLDocument()
  const root = doc.documentElement
  root.remove()
  const dispose = mountLinuxWindowChrome(doc)
  // The preload runs before the parser creates <html>; DOMContentLoaded is the
  // second chance to stamp the attributes the client modules read.
  doc.append(root)
  doc.dispatchEvent(new Event('DOMContentLoaded'))
  expect(root.dataset.platform).toBe('linux')
  expect(root.dataset.dshDesktopWebShortcuts).toBe('true')
  dispose()
  root.removeAttribute('data-platform')
  doc.dispatchEvent(new Event('DOMContentLoaded'))
  expect(root.hasAttribute('data-platform')).toBe(false)
})

it('keeps the Web runtime so Harness never demands the missing native keyboard bridge', async () => {
  const source = await readShortcutsClient()
  const detect = new Function(
    `${extract(source, 'detectEnvironment')}; return detectEnvironment`
  )() as (doc: Document, nav: { platform: string }) => { runtime: string; platform: string }

  const doc = document.implementation.createHTMLDocument()
  // Without the marker Harness falls back to navigator.platform, which is the
  // deprecated string "Linux x86_64" rather than a platform name.
  expect(detect(doc, { platform: 'Linux x86_64' })).toEqual({ runtime: 'web', platform: 'linux' })

  mountLinuxWindowChrome(doc)
  // `runtime: desktop` makes Harness throw "Desktop keyboard bridge unavailable"
  // unless window.dshDesktop.keyboard exists, and this host exposes no bridge.
  expect(detect(doc, { platform: 'Linux x86_64' })).toEqual({ runtime: 'web', platform: 'linux' })
})

it('leaves the browser-on-Linux profile unbound instead of borrowing another profile', async () => {
  const source = await readShortcutsClient()
  const resolve = new Function(
    `${extract(source, 'resolveShortcutDefault')}; return resolveShortcutDefault`
  )() as (definition: unknown, runtime: string, platform: string) => unknown

  // Harness declares browser defaults for macOS and Windows but deliberately
  // none for Linux, because `register()` throws `Unsupported Web shortcut` for
  // any browser-on-Linux binding that is not on its small allow list. Falling
  // back to a sibling web profile fails registration and takes down
  // dsh-client-ui-layout, so the absence of a Linux binding is load-bearing.
  expect(resolve({ defaults: { 'web:windows': { code: 'KeyB', modifiers: ['primary', 'alt'] } } }, 'web', 'linux'))
    .toBeUndefined()
  expect(resolve({ defaults: { 'desktop:linux': { code: 'KeyB', modifiers: ['primary'] } } }, 'desktop', 'linux'))
    .toEqual({ code: 'KeyB', modifiers: ['primary'] })
})

it('scopes the Windows caption-strip geometry away from Linux', async () => {
  const [sidebar, conversation] = await Promise.all([
    readFile('patches/@deepseek-ai+dsh-client-ui-sidebar+0.1.7-rc.2.patch', 'utf8'),
    readFile('patches/@deepseek-ai+dsh-client-ui-conversation+0.1.7-rc.2.patch', 'utf8')
  ])
  const scoped = 'html:not([data-platform=darwin]):not([data-platform=linux])'
  // Windows leaves data-platform unset, so the caption strip is the absence of
  // both announcing platforms. Linux runs a native frame and must not reserve it.
  expect(sidebar).toContain(`${scoped} [data-dsh-sidebar-root][data-dsh-sidebar-wide=\\"true\\"]{padding-top:32px}`)
  expect(conversation.split(scoped).length - 1).toBe(2)
  expect(sidebar).not.toContain('html:not([data-platform=darwin]) [data-dsh-sidebar-root]')
})

it('leaves the other desktop hosts untouched', async () => {
  const [sidebar, conversation] = await Promise.all([
    readFile('patches/@deepseek-ai+dsh-client-ui-sidebar+0.1.7-rc.2.patch', 'utf8'),
    readFile('patches/@deepseek-ai+dsh-client-ui-conversation+0.1.7-rc.2.patch', 'utf8')
  ])
  // macOS selects its geometry by announcement; the Windows rules must still
  // match a host that announces nothing.
  expect(conversation).toContain('[data-platform=darwin] .wSkVaW_headerLeading')
  for (const patch of [sidebar, conversation]) expect(patch).not.toContain('[data-platform=windows]')
})

it('mounts only on Linux and disposes with the window', async () => {
  const source = await readFile('src/preload/index.ts', 'utf8')
  expect(source).toContain("import { mountLinuxWindowChrome } from './linux-window-chrome'")
  expect(source).toContain("if (process.platform === 'linux') {")
  expect(source).toContain('const dispose = mountLinuxWindowChrome(document)')
  expect(source.match(/mountLinuxWindowChrome\(document\)/g)).toHaveLength(1)
})
