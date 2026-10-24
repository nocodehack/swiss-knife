// The look: one accent, one text size, a few glyphs and plain words. What the strip says at any moment,
// the bars and the small formats every surface shares. Pure logic.

// Colors follow the person's theme where a theme key exists; SVG bars take fixed tones that read on both.
export const ACCENT = 'claude'
export const RED = 'error'
export const AMBER = 'warning'
export const GREEN = 'success'
const HEX = { accent: '#DD775B', amber: '#D9A03A', red: '#E0524A', track: 'rgba(128,128,128,0.28)', line: 'rgba(128,128,128,0.35)' }

export type Level = 'urgent' | 'warn' | 'info'
export type AlertKind = 'waiting' | 'budget' | 'limit' | 'chat-full' | 'cache' | 'tip' | 'note'
export type Alert = { kind: AlertKind; level: Level; text: string }

// "0:42", "12:05", "1:02:03": how long something has run.
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// "14:02" today, "Mon 14:02" another day.
export function when(at: number, now: number): string {
  const d = new Date(at)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return new Date(now).toDateString() === d.toDateString() ? hm : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}`
}

const base = (path: string) => path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path

// What Claude is doing right now, as the strip's first words: "Writing index.html".
export function actionText(tool: string, input: { file_path?: unknown; notebook_path?: unknown; command?: unknown; path?: unknown }): string {
  const file = String(input.file_path ?? input.notebook_path ?? '')
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) return file ? `Writing ${base(file)}` : 'Writing'
  if (/^(Read|NotebookRead)$/.test(tool)) return file ? `Reading ${base(file)}` : 'Reading'
  if (/^(Grep|Glob|LS)$/.test(tool)) return 'Looking through the project'
  if (/^(WebSearch|WebFetch)$/.test(tool)) return 'Searching the web'
  if (/^(Bash|PowerShell)$/.test(tool))
    return /\b(test|tests|pytest|jest|vitest|mocha|spec|lint|check)\b/i.test(String(input.command ?? '')) ? 'Testing' : 'Running a command'
  if (/^(Task|Agent)$/.test(tool)) return 'Working with a helper'
  return 'Thinking'
}

// Money as a person on a plan reads it: they pay no bill per message, so it is what the work is worth.
export function spendText(usd: number, hasCost: boolean, hasPlan: boolean, budget = 0): string {
  if (!hasCost) return ''
  const v = usd > 0 && usd < 0.01 ? 'under 1¢' : `$${usd.toFixed(2)}`
  if (budget) return `${v} of $${Number.isInteger(budget) ? budget : budget.toFixed(2)}`
  return hasPlan ? `worth ${v}` : v
}

// The meta line: "bakery2 · 1h 12m today · $3.61 of $10".
export const metaText = (name: string, time: string, spend: string) => [name, `${time} today`, spend].filter(Boolean).join(' · ')

// Claude Code's own words for a wait, made short: what it wants and where to answer.
export function waitingText(raw: string): string {
  if (/plan/i.test(raw)) return 'It has a plan for you to approve. Answer in the chat.'
  if (/question/i.test(raw)) return 'It has a question. Answer in the chat.'
  if (/permission|allow|approve|ok\b/i.test(raw)) return 'It wants your OK to go on. Answer in the chat.'
  return 'It is waiting for your answer in the chat.'
}

// The strip, from what is true now: line 1 the status, line 2 the detail or the one alert that wins, line 3 one action.
export type StripIn = {
  now: number
  meta: string
  waiting?: { since: number; text: string } | null
  working?: { action: string; since: number } | null
  isAsleep?: boolean
  done?: { at: number; took: string; summary: string } | null
  next?: string
  alerts: Alert[] // most urgent first
  note?: { goal: string; at: number; isStale: boolean; isSent: boolean } | null
  isHandedOff?: boolean
}
export type Action = 'fresh-chat' | 'next' | 'note-continue' | 'note-drop'
export type StripOut = {
  glyph: string; glyphColor?: string
  title: string; titleColor?: string
  meta: string // dim, after the title
  detail: string; detailGlyph: string; detailColor?: string
  actions: { key: Action; label: string; isPrimary: boolean }[]
  isUrgent: boolean
  folded: string // the one line of the folded strip
}

export const DONE_SHOWN_MS = 10 * 60_000

export function strip(s: StripIn): StripOut {
  const out: StripOut = { glyph: '', title: 'Ready', meta: s.meta, detail: '', detailGlyph: '', actions: [], isUrgent: false, folded: '' }
  const top = s.alerts.find(a => a.kind !== 'waiting')
  const loud = top && (top.level !== 'info' || top.kind === 'cache') ? top : undefined
  const tip = top && top.kind === 'tip' ? top : undefined
  const alertLine = (a: Alert) => {
    out.detail = a.text
    out.detailGlyph = a.kind === 'tip' ? 'Tip' : '!'
    out.detailColor = a.kind === 'tip' ? ACCENT : a.level === 'urgent' ? RED : AMBER
    if ((a.kind === 'chat-full' || (a.kind === 'cache' && a.level === 'warn')) && !s.note) out.actions = [{ key: 'fresh-chat', label: 'Continue in a new chat', isPrimary: true }]
  }
  if (s.waiting) {
    out.glyph = '●'; out.glyphColor = RED; out.title = 'Claude needs you'; out.titleColor = RED
    out.meta = `waiting ${clock(s.now - s.waiting.since)}`
    out.detail = s.waiting.text
    out.isUrgent = true
  } else if (s.note && (s.note.isStale || !s.working)) {
    out.glyph = '→'; out.glyphColor = ACCENT
    out.title = s.note.isStale ? 'A handoff is waiting:' : 'Continuing:'
    out.meta = s.note.goal
    out.detail = s.note.isStale ? `From ${when(s.note.at, s.now)}. Continue it, or start fresh?`
      : s.note.isSent ? `From your handoff at ${when(s.note.at, s.now)}. Claude has the goal, files and next steps.`
      : 'Claude reads your handoff with your first message.'
    out.actions = s.note.isStale
      ? [{ key: 'note-continue', label: 'Continue it', isPrimary: true }, { key: 'note-drop', label: 'Start fresh', isPrimary: false }]
      : s.note.isSent ? [] : [{ key: 'note-drop', label: 'Start fresh instead', isPrimary: false }]
  } else if (s.working) {
    out.glyph = '●'; out.glyphColor = ACCENT; out.title = s.working.action
    out.meta = clock(s.now - s.working.since)
    out.detail = s.meta
    if (loud) alertLine(loud)
  } else if (s.isHandedOff) {
    out.glyph = '✓'; out.glyphColor = GREEN; out.title = 'Handoff ready'
    out.detail = 'Open a new chat in this project. Claude reads it first.'
  } else if (s.done && s.now - s.done.at < DONE_SHOWN_MS && !loud) {
    out.glyph = '✓'; out.glyphColor = GREEN; out.title = 'Done'; out.meta = s.done.took
    out.detail = s.done.summary
  } else {
    out.title = s.isAsleep ? 'On a break' : 'Ready'
    out.meta = s.isAsleep ? 'timer paused' : s.meta
    if (s.isAsleep) out.detail = s.meta
    if (loud ?? tip) alertLine((loud ?? tip)!)
  }
  out.folded = [out.title, out.meta].filter(Boolean).join(' · ')
  return out
}

// A pixel bar as wide as its slot: square segments like the mascot's, accent, amber from 80%, red from 95%.
export function barSvg(fraction: number, segments = 24): string {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0))
  const fill = f >= 0.95 ? HEX.red : f >= 0.8 ? HEX.amber : HEX.accent
  const lit = Math.round(f * segments)
  const cell = 1000 / segments, gap = cell * 0.22
  const cells = Array.from({ length: segments }, (_, i) =>
    `<rect x="${(i * cell).toFixed(1)}" y="0" width="${(cell - gap).toFixed(1)}" height="8" fill="${i < lit ? fill : HEX.track}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 8" preserveAspectRatio="none" width="1000" height="8" shape-rendering="crispEdges">${cells}</svg>`
}

// The volume row: ten pixel bars that fill in Claude orange, none lit when muted.
export function volumeBarsSvg(volume: number, isOn: boolean): string {
  const lit = isOn ? Math.round(Math.max(0, Math.min(1, volume)) * 10) : 0
  const w = 7, h = 14, gap = 3
  const cells = Array.from({ length: 10 }, (_, i) =>
    `<rect x="${i * (w + gap)}" y="0" width="${w}" height="${h}" fill="${i < lit ? HEX.accent : HEX.track}"/>`).join('')
  const width = 10 * (w + gap) - gap
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" shape-rendering="crispEdges">${cells}</svg>`
}

// A line of the last-task report: done, or the one thing still to do ("Left to check: ...").
export function reportLine(line: string): { isTodo: boolean; lead: string; text: string } {
  const m = /^\s*(left to check|still needed|still to do|to do|next)\s*:\s*(.*)$/i.exec(line)
  return m ? { isTodo: true, lead: 'Still needed:', text: m[2]! } : { isTodo: false, lead: '', text: line.trim() }
}

// The terminal's bar: █ for done, ░ for the rest.
export function barText(fraction: number, width = 24): string {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0))
  const full = Math.round(f * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

// A 1 px hairline between sections.
export const ruleSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1" preserveAspectRatio="none" width="1000" height="1"><rect width="1000" height="1" fill="${HEX.line}"/></svg>`

// The handoff loader: 20 square segments filling up and starting over while it writes.
export function segmentsSvg(elapsedMs: number, count = 20): string {
  const lit = Math.floor(elapsedMs / 350) % (count + 1)
  const w = 14, gap = 4
  const cells = Array.from({ length: count }, (_, i) =>
    `<rect x="${i * (w + gap)}" y="0" width="${w}" height="8" fill="${i < lit ? HEX.accent : HEX.track}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count * (w + gap) - gap} 8" width="${count * (w + gap) - gap}" height="8">${cells}</svg>`
}

export const segmentsText = (elapsedMs: number, count = 20) => {
  const lit = Math.floor(elapsedMs / 350) % (count + 1)
  return '■'.repeat(lit) + '□'.repeat(count - lit)
}

// A doc line as the Handoff tab shows it: Markdown marks gone, bullets as dashes.
export function docLine(line: string): { kind: 'heading' | 'text' | 'blank'; text: string } {
  if (/^#{1,3}\s/.test(line)) return { kind: 'heading', text: line.replace(/^#+\s*/, '') }
  const t = line.replace(/\*\*|`/g, '').replace(/^(\s*)[-*•]\s+/, '$1– ')
  return t.trim() ? { kind: 'text', text: t } : { kind: 'blank', text: '' }
}

// The handoff document as sections, each with its items: "- [done] text" lines, numbered steps, plain lines.
export type DocItem = { mark: 'open' | 'done' | null; text: string }
export function docSections(body: string): { name: string; items: DocItem[] }[] {
  const out: { name: string; items: DocItem[] }[] = []
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\*\*|`/g, '').trimEnd()
    if (/^#{1,3}\s/.test(line)) { out.push({ name: line.replace(/^#+\s*/, '').trim(), items: [] }); continue }
    const t = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()
    if (!out.length || !t || /^none\.?$/i.test(t)) continue
    const m = /^\[(open|done|x| )\]\s*(.*)$/i.exec(t)
    const mark = m ? (/done|x/i.test(m[1]!) ? 'done' : 'open') : null
    out[out.length - 1]!.items.push({ mark, text: m ? m[2]! : t })
  }
  return out
}

// "index.html: footer, lines 27-31" as a name and what changed in it, the path cut to the project.
export function fileItem(text: string): { name: string; what: string; isFile: boolean } {
  const m = /^([^\s:]+\.[\w]+|[^\s:]+\/)\s*[:–-]\s*(.*)$/.exec(text)
  const name = (m ? m[1]! : text).replace(/\\/g, '/').replace(/^.*\/(?=[^/]+\/[^/]+$)/, '')
  return { name, what: m ? m[2]! : '', isFile: !!m }
}

// What a folded section says on its row: "1 done · 1 waiting", the file names, or a count.
export function sectionSummary(name: string, items: DocItem[]): string {
  if (items.some(i => i.mark)) {
    const done = items.filter(i => i.mark === 'done').length, open = items.filter(i => i.mark === 'open').length
    return [done ? `${done} done` : '', open ? `${open} waiting` : ''].filter(Boolean).join(' · ')
  }
  if (/^files/i.test(name)) {
    const files = items.map(i => fileItem(i.text)).filter(x => x.isFile)
    if (files.length === 0) return items.length === 1 ? 'none kept' : String(items.length)
    return files.map(x => x.name).slice(0, 2).join(', ') + (files.length > 2 ? ` +${files.length - 2}` : '')
  }
  return String(items.length)
}

// A pin's text without Markdown: links as their words, headings and emphasis gone, bullets as dashes.
export function cleanPin(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+•]\s+/gm, '– ')
    .trim()
}
