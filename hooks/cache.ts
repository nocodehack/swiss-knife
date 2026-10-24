// Cache timer: Claude keeps the conversation in a cheap cache for a while after each reply.
// Come back after it expires and the next message pays to read the whole chat again. Pure logic.

// Plans with usage limits (Pro, Max) get a 1-hour cache in Claude Code; pay-per-use keys get 5 minutes,
// unless the person set `promptCacheTtl` (which wins when it reads as a time).
export const cacheTtlMs = (hasPlanLimits: boolean, setting?: number | null) => setting ?? (hasPlanLimits ? 60 : 5) * 60_000

// The `promptCacheTtl` setting as milliseconds: "1h", "5m", "300s" or a number of seconds; null when unset or unreadable.
export function parseTtl(value: unknown): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(h|m|s)?\s*$/i.exec(String(value ?? ''))
  if (!m) return null
  const n = Number(m[1]) * ({ h: 3_600_000, m: 60_000, s: 1000 }[(m[2] ?? 's').toLowerCase() as 'h' | 'm' | 's'])
  return n > 0 ? n : null
}

// Shown only near the end, and once it has run out, while the chat is big enough for a re-read to matter.
export const MIN_TOKENS = 50_000

export type CacheState = { leftMs: number; isExpired: boolean } | null

export function cacheState(lastReplyAt: number, now: number, ttlMs: number, contextTokens: number): CacheState {
  if (!lastReplyAt || contextTokens < MIN_TOKENS) return null
  const left = lastReplyAt + ttlMs - now
  const warnFrom = Math.min(10 * 60_000, ttlMs / 2) // the last 10 minutes of an hour, the last 2.5 of five
  if (left > warnFrom) return null
  return { leftMs: Math.max(0, left), isExpired: left <= 0 }
}

// On a plan nobody pays per message: a full re-read costs plan limits, not dollars.
export function cacheText(s: NonNullable<CacheState>, _contextTokens: number, hasPlanLimits = false): string {
  const cost = hasPlanLimits ? 'uses more of your limits' : 'costs more'
  if (s.isExpired) return `Quick memory ran out, so your next message ${cost}. New topic? Continue in a new chat.`
  const min = Math.ceil(s.leftMs / 60_000)
  return `Quick memory ends in ${min} min. Reply soon to keep it ${hasPlanLimits ? 'light on your limits' : 'cheap'}.`
}
