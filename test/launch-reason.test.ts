import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatHarnessLaunchNote, sanitizeLaunchReason, type HarnessLaunchSource } from '../src/main/runtime/launch-reason'

const projectRoot = path.resolve(import.meta.dirname, '..')

const LAUNCH_SOURCES: HarnessLaunchSource[] = [
  'startup',
  'window-restore',
  'second-instance',
  'menu',
  'frontend-bridge',
  'market-uninstall',
  'plugin-recovery',
  'repair-agent',
  'safe-mode'
]

describe('sanitizeLaunchReason', () => {
  it('keeps a plain renderer reason', () => {
    expect(sanitizeLaunchReason('workbenches: install restart button')).toBe('workbenches: install restart button')
  })

  it('drops values that cannot be log text', () => {
    expect(sanitizeLaunchReason(undefined)).toBeUndefined()
    expect(sanitizeLaunchReason(null)).toBeUndefined()
    expect(sanitizeLaunchReason(42)).toBeUndefined()
    expect(sanitizeLaunchReason({ reason: 'workbenches' })).toBeUndefined()
    expect(sanitizeLaunchReason(true)).toBeUndefined()
  })

  it('drops reasons that carry no text', () => {
    expect(sanitizeLaunchReason('')).toBeUndefined()
    expect(sanitizeLaunchReason('   ')).toBeUndefined()
    expect(sanitizeLaunchReason('\n\t')).toBeUndefined()
  })

  it('collapses control characters so one note stays one line', () => {
    expect(sanitizeLaunchReason('a\nb\u0007c')).toBe('a b c')
    expect(sanitizeLaunchReason('  padded\nreason  ')).toBe('padded reason')
  })

  it('bounds the length of untrusted text', () => {
    const result = sanitizeLaunchReason('x'.repeat(400))
    expect(result).toHaveLength(121)
    expect(result?.endsWith('…')).toBe(true)
  })
})

describe('formatHarnessLaunchNote', () => {
  it('names the source without a reason', () => {
    expect(formatHarnessLaunchNote('frontend-bridge')).toBe('[desktop] Harness launch requested by frontend-bridge')
  })

  it('appends the reason that identifies the caller', () => {
    expect(formatHarnessLaunchNote('frontend-bridge', 'workbenches: install restart button')).toBe(
      '[desktop] Harness launch requested by frontend-bridge: workbenches: install restart button'
    )
  })

  it('leaves no dangling separator when the reason is unusable', () => {
    expect(formatHarnessLaunchNote('menu', '   ')).toBe('[desktop] Harness launch requested by menu')
    expect(formatHarnessLaunchNote('menu', undefined)).toBe('[desktop] Harness launch requested by menu')
    expect(formatHarnessLaunchNote('menu', { channel: 'harness:restart' })).not.toContain(':')
  })

  it('formats every declared source', () => {
    for (const source of LAUNCH_SOURCES) {
      expect(formatHarnessLaunchNote(source)).toBe(`[desktop] Harness launch requested by ${source}`)
    }
  })
})

describe('labelled launch paths', () => {
  it('labels every main-process launch and restart call', async () => {
    const source = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')
    // Behaviour itself is covered above. This contract keeps a new launch path
    // from being added without a source: an unlabelled restart is exactly what
    // made a user-visible backend disconnect impossible to attribute.
    expect([...source.matchAll(/\b(?:launchHarness|launchSafeHarness|restartHarness)\(\s*\)/g)]).toHaveLength(0)
    const labelled = [...source.matchAll(/\b(?:launchHarness|launchSafeHarness|restartHarness)\(\s*'([a-z-]+)'/g)]
    expect(labelled.length).toBeGreaterThan(0)
    for (const match of labelled) {
      expect(LAUNCH_SOURCES as readonly string[]).toContain(match[1])
    }
  })

  it('forwards the renderer reason through the preload bridge', async () => {
    const preload = await readFile(path.join(projectRoot, 'src', 'preload', 'index.ts'), 'utf8')
    expect(preload).toContain("ipcRenderer.invoke('harness:restart', reason)")
  })
})
