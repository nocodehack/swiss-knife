// Meter + report + budget: pure logic, no engine calls, so every rule is easy to test.
import { metaText, spendText } from './ui'

export const IDLE_MS = 10 * 60 * 1000 // a gap longer than this is a break, not work

// usd: what the work would cost on the pay-per-use API. weekPct: points of the plan's weekly limit it used.
export type Day = { ms: number; usd: number; tokens: number; prompts: string[]; done: string[]; weekPct?: number }
export type Last = { at: number; asked: string; did: string }
export type Project = {
  name: string
  days: Record<string, Day>
  budgetUsd?: number // per day, for this project
  budgetWarned?: { day: string; level: number } // the highest warning shown that day (80 or 100)
  budgetPct?: number // share of the plan's weekly limit this project may use in a week
  pctWarned?: { week: string; level: number }
  last?: Last // what happened last time, for the welcome-back line
}

// A budget amount as people write it: $5, $1.50.
export const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)

export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10)
export const emptyDay = (): Day => ({ ms: 0, usd: 0, tokens: 0, prompts: [], done: [] })
export const projectName = (cwd: string) => cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd
export const oneLine = (text: string, max: number) => {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

// Working time: count the gap since the last activity, unless it was a break.
export function workedMs(lastActivity: number | undefined, now: number): number {
  if (lastActivity === undefined) return 0
  const gap = now - lastActivity
  return gap > 0 && gap <= IDLE_MS ? gap : 0
}

export function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60000)
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function fmtTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M tokens` : n >= 1000 ? `${Math.round(n / 1000)}k tokens` : `${n} tokens`
}

// Dollars when Claude Code reports them, tokens otherwise. Never an invented price.
export const fmtSpend = (d: Pick<Day, 'usd' | 'tokens'>, hasCost: boolean) =>
  hasCost ? `$${d.usd.toFixed(2)}` : fmtTokens(d.tokens)

// The meter line: "bakery2 · 1h 12m today · $3.61 of $10". On a plan the dollars are what the work is worth.
export function statusText(name: string, d: Day, hasCost: boolean, budgetUsd?: number, hasPlan = false) {
  return metaText(name, fmtTime(d.ms), spendText(d.usd, hasCost, hasPlan, budgetUsd))
}

export function sumDays(p: Project, from: string): Day {
  const out = emptyDay()
  for (const [k, d] of Object.entries(p.days)) {
    if (k < from) continue
    out.ms += d.ms; out.usd += d.usd; out.tokens += d.tokens; out.weekPct = (out.weekPct ?? 0) + (d.weekPct ?? 0)
    out.prompts.push(...d.prompts); out.done.push(...(d.done ?? []))
  }
  return out
}

// Budget: 80 at four fifths of today's limit, 100 at the limit, 0 below. Each level warns once a day.
export function budgetLevel(usd: number, budgetUsd?: number): 0 | 80 | 100 {
  if (!budgetUsd) return 0
  return usd >= budgetUsd ? 100 : usd >= budgetUsd * 0.8 ? 80 : 0
}
export function budgetWarning(p: Project, day: string, usd: number): string | null {
  const level = budgetLevel(usd, p.budgetUsd)
  const shown = p.budgetWarned?.day === day ? p.budgetWarned.level : 0
  if (level <= shown) return null
  p.budgetWarned = { day, level }
  return level === 100
    ? `Over today's budget: $${usd.toFixed(2)} of ${money(p.budgetUsd!)}.`
    : `80% of today's ${money(p.budgetUsd!)} budget used.`
}
// "/budget 5" is dollars a day; "/budget 20%" is a share of the plan's weekly limit, per week.
export type Budget = { kind: 'usd' | 'pct'; value: number }
export function parseBudget(args: string): Budget | 'off' | null {
  const t = args.trim().toLowerCase()
  if (t === 'off' || t === '0' || t === '0%') return 'off'
  const isPct = t.endsWith('%')
  const n = Number(t.replace(/^\$/, '').replace(/%$/, ''))
  if (!Number.isFinite(n) || n <= 0 || (isPct && n > 100)) return null
  return { kind: isPct ? 'pct' : 'usd', value: Math.round(n * 100) / 100 }
}

// Points of a limit used between two readings; a drop means the window reset, so the new reading is all new use.
export function usageDelta(before: number | undefined, after: number | undefined): number {
  if (before === undefined || after === undefined) return 0
  return after >= before ? after - before : after
}

export const fmtPct = (n: number) => (n > 0 && n < 1 ? '<1%' : `${Math.round(n)}%`)

// The share-of-week budget: 80 at four fifths, 100 at the limit; each level warns once a week.
export function pctWarning(p: Project, week: string, used: number): string | null {
  if (!p.budgetPct) return null
  const level = used >= p.budgetPct ? 100 : used >= p.budgetPct * 0.8 ? 80 : 0
  const shown = p.pctWarned?.week === week ? p.pctWarned.level : 0
  if (level <= shown) return null
  p.pctWarned = { week, level }
  return level === 100
    ? `This project used its ${p.budgetPct}% share of your weekly limit (${fmtPct(used)}).`
    : `This project used 80% of its ${p.budgetPct}% share of your weekly limit.`
}

// Slash commands (and paths a shell mangled from one) are not work.
export const isWork = (text: string) => !/^\s*(\/|[A-Za-z]:[\/]Program Files)/.test(text)

// The report reads what was asked AND what Claude said it did, so it reports results, not guesses.
export function reportPrompt(name: string, period: string, d: Day): string {
  const asks = d.prompts.filter(isWork).slice(-60).map(p => `- ${p}`).join('\n') || '- (none recorded)'
  const did = d.done.slice(-60).map(p => `- ${p}`).join('\n') || '- (none recorded)'
  return `Project: ${name}\nPeriod: ${period}\nWhat the person asked for, in order:\n${asks}\nWhat Claude replied after each piece of work:\n${did}`
}
export const REPORT_SYSTEM =
  'You write short work updates for a non-technical reader (a client or a manager). ' +
  'Write 1 to 3 bullet lines starting with "• ", each under 15 words, saying what was achieved, in plain English. ' +
  'Only claim what Claude\'s replies confirm. If a reply says nothing needed changing, say it was checked. ' +
  'Write fewer lines when there was less work. Never pad. No code, no file names, no jargon, no mention of AI or prompts.'

// How long a task took: "45s", "2m 14s", "1h 05m".
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

// The first sentence of a reply, for a quick answer's report (no model call).
export function firstSentence(text: string, max = 160): string {
  const t = text.replace(/[#*`_>]/g, '').replace(/\s+/g, ' ').trim()
  const m = t.match(/^.*?[.!?](\s|$)/)
  return oneLine(m ? m[0] : t, max)
}

export function ago(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}
