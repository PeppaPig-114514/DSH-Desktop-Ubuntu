/**
 * Why the desktop shell asked for a Harness launch.
 *
 * A restart is nearly invisible in the Harness log: the child exits with code 0
 * by design (upstream maps SIGTERM to a graceful zero exit), so an "exit code 0"
 * line is evidence of a requested stop rather than of a crash, and several
 * launch paths write no note of their own. A user-visible "backend
 * disconnected" episode therefore stays unattributable after the fact. Naming
 * the caller keeps that answer in the log.
 *
 * Keep this list closed: a new launch path must add its own source instead of
 * reusing an unrelated one, otherwise the note recreates the same ambiguity.
 */
export type HarnessLaunchSource =
  | 'startup'
  | 'window-restore'
  | 'second-instance'
  | 'menu'
  | 'frontend-bridge'
  | 'market-uninstall'
  | 'plugin-recovery'
  | 'repair-agent'
  | 'safe-mode'

/** A renderer-supplied reason is untrusted input; keep it short and one line. */
const MAX_REASON_LENGTH = 120

export function sanitizeLaunchReason(reason: unknown): string | undefined {
  if (typeof reason !== 'string') return undefined
  // Control and format characters would break the one-line log shape.
  const collapsed = reason
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (collapsed.length === 0) return undefined
  return collapsed.length > MAX_REASON_LENGTH ? `${collapsed.slice(0, MAX_REASON_LENGTH)}…` : collapsed
}

/** The note written for one launch attempt, in the shape `runtime.note` stores. */
export function formatHarnessLaunchNote(source: HarnessLaunchSource, reason?: unknown): string {
  const detail = sanitizeLaunchReason(reason)
  return `[desktop] Harness launch requested by ${source}${detail === undefined ? '' : `: ${detail}`}`
}
