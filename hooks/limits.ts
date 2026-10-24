// Plan limits: the 5-hour and weekly windows, when they reset, and when you would run out at this pace.
// Pure logic.

export type Window = { kind: string; percentUsed: number; resetsAt?: string }
export type Sample = { at: number; percent: number }

export const FIVE_HOUR = 'five_hour'
export const WEEKLY = 'seven_day'
export const WARN_AT = [80, 95] // a toast once per window at each

export const windowOf = (all: readonly Window[], kind: string) => all.find(w => w.kind === kind && Number.isFinite(w.percentUsed))

const resetMs = (w?: Window) => (w?.resetsAt ? Date.parse(w.resetsAt) : NaN)

// A reading from before its window reset is stale: the window is empty again until Claude Code reports anew.
export const current = (w: Window | undefined, now: number): Window | undefined =>
  w && resetMs(w) <= now ? { ...w, percentUsed: 0, resetsAt: undefined } : w

// "16:40" today, "Fri 09:00" later this week.
export function fmtReset(w: Window | undefined, now: number): string {
  const t = resetMs(w)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = new Date(now).toDateString() === d.toDateString()
  return sameDay ? hm : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}`
}

// Keeps the last hour of readings for the pace; a drop means the window reset, so it starts over.
export function addSample(samples: Sample[], s: Sample): Sample[] {
  const last = samples[samples.length - 1]
  const kept = last && s.percent < last.percent ? [] : samples.filter(x => s.at - x.at <= 60 * 60_000)
  return last && last.percent === s.percent && s.at - last.at < 60_000 ? kept : [...kept, s]
}

// When the 5-hour window runs out at the pace of the last hour, or null when it lasts until it resets.
export function runsOutAt(samples: Sample[], w: Window | undefined): number | null {
  if (!w || samples.length < 2) return null
  const a = samples[0]!, b = samples[samples.length - 1]!
  const minutes = (b.at - a.at) / 60_000
  if (minutes < 5 || b.percent <= a.percent) return null
  const perMs = (b.percent - a.percent) / (b.at - a.at)
  const at = b.at + (100 - b.percent) / perMs
  const reset = resetMs(w)
  return Number.isFinite(reset) && at >= reset ? null : at
}

export const fmtClock = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// The warning to show for this window now, or null; `shown` remembers what was shown, per reset.
export function limitWarning(w: Window | undefined, shown: Record<string, number>): string | null {
  if (!w) return null
  const key = `${w.kind}:${w.resetsAt ?? ''}`
  const level = [...WARN_AT].reverse().find(l => w.percentUsed >= l)
  if (!level || (shown[key] ?? 0) >= level) return null
  shown[key] = level
  const name = w.kind === FIVE_HOUR ? '5-hour' : 'weekly'
  return `You've used ${Math.round(w.percentUsed)}% of your ${name} limit.`
}
