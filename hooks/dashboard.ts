// The panel: text bars for the terminal, one drawn card for the desktop app. Pure logic.
// Design: the mascot is the one bold thing; the data is quiet. Hairlines instead of boxes, sentence case,
// one type family with aligned numbers, and colour only where it carries meaning (sage, amber, red).
import type { Mood } from './mascot'

// A text bar for the terminal: ████████░░░░
export function bar(fraction: number, width = 16): string {
  const f = clamp01(fraction)
  const full = Math.round(f * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0))

const WORDS: Record<Mood, string> = {
  'greeting': 'saying hello', 'idle': 'ready', 'thinking': 'thinking', 'reading': 'reading files',
  'writing': 'writing', 'running-commands': 'running commands', 'testing': 'testing',
  'searching-web': 'searching the web', 'error': 'hit a problem', 'done': 'done',
  'asleep': 'on a break', 'context-nearly-full': 'conversation almost full', 'waiting-for-you': 'waiting for you',
  'compacting': 'tidying up', 'gag-tokens': 'over budget', 'gag-dance': 'dancing to the sound', 'asleep-nightcap': 'keeping it quiet',
}
export const moodWords = (m: Mood) => WORDS[m] ?? m
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const C = {
  ink: '#ECE7DF', soft: '#C9C3B8', muted: '#8F8A80', hair: '#2F2D29', track: '#34322E', tick: '#4A4740',
  sage: '#8DBF8B', amber: '#E3B04B', red: '#E46A4E', glow: '#D97757',
}
// Sage, then amber from 70%, red from 90%.
export const levelColor = (f: number) => (f >= 0.9 ? C.red : f >= 0.7 ? C.amber : C.sage)
const TONE = { urgent: C.red, warn: C.amber, info: C.sage } as const
export type Tone = keyof typeof TONE

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Word-wraps at about `width` characters, at most `lines` lines, an ellipsis when cut.
export function wrap(text: string, width: number, lines: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + ' ' + word).length > width) { out.push(line); line = word } else line = line ? `${line} ${word}` : word
    }
    if (line) out.push(line)
  }
  if (out.length > lines) {
    const kept = out.slice(0, lines)
    const last = kept[lines - 1]!
    kept[lines - 1] = (last.length < width ? last : last.replace(/\s+\S+$/, '')) + '…' // whole words only
    return kept
  }
  return out
}

// The mascot's own SVG, placed inside the card.
export const placeMascot = (svg: string, x: number, y: number, w: number, h: number) =>
  svg.replace(/^<svg\b([^>]*?)\swidth="[^"]*"\sheight="[^"]*"/, `<svg$1 x="${x}" y="${y}" width="${w}" height="${h}"`)

// A half-ring gauge with ticks every 10%; `f` from 0 to 1.
export function gauge(cx: number, cy: number, f: number, value: string, label: string, sub: string): string {
  const r = 30
  const at = (t: number) => [cx + r * Math.cos(Math.PI * (1 - t)), cy - r * Math.sin(Math.PI * (1 - t))] as const
  const [x0, y0] = at(0), [x1, y1] = at(1), [xf, yf] = at(clamp01(f))
  const p: string[] = []
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1 - i / 10), r1 = r + 6, r2 = r + (i % 5 === 0 ? 11 : 9)
    p.push(`<line x1="${(cx + r1 * Math.cos(a)).toFixed(1)}" y1="${(cy - r1 * Math.sin(a)).toFixed(1)}" x2="${(cx + r2 * Math.cos(a)).toFixed(1)}" y2="${(cy - r2 * Math.sin(a)).toFixed(1)}" stroke="${C.tick}" stroke-width="1.2"/>`)
  }
  p.push(`<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${C.track}" stroke-width="6" stroke-linecap="round"/>`)
  if (f > 0.005)
    p.push(`<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${xf.toFixed(1)} ${yf.toFixed(1)}" fill="none" stroke="${levelColor(f)}" stroke-width="6" stroke-linecap="round"/>`)
  p.push(`<text x="${cx}" y="${cy - 3}" text-anchor="middle" font-size="16" font-weight="650" fill="${C.ink}">${esc(value)}</text>`)
  p.push(`<text x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="13" font-weight="600" fill="${C.ink}">${esc(label)}</text>`)
  if (sub) p.push(`<text x="${cx}" y="${cy + 36}" text-anchor="middle" font-size="11.5" fill="${C.muted}">${esc(sub)}</text>`)
  return p.join('')
}

export type Card = {
  mascot: string; mood: Mood; name: string; model: string
  todayTime: string; todaySpend: string; weekTime: string; weekSpend: string
  contextPercent: number; handoffAt: number
  limits?: { five?: { percent: number; reset: string }; week?: { percent: number; reset: string } }
  forecast?: string
  alerts?: { tone: Tone; text: string }[]
  lastTask?: { took: string; asked: string; summary: string; report?: string[]; files: string[]; isOpen?: boolean; age?: number }
  changed?: string[]
  budget?: { used: number; limit: number; isPct?: boolean }
  sound?: { isOn: boolean; volume: number }
}

const W = 320, X = 20, R = 300
const FONT = `font-family="Segoe UI Variable Text, Segoe UI, system-ui, sans-serif" style="font-variant-numeric: tabular-nums"`
const hair = (y: number) => `<line x1="${X}" y1="${y}" x2="${R}" y2="${y}" stroke="${C.hair}" stroke-width="1"/>`
const label = (x: number, y: number, t: string, anchor = 'start') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="12.5" font-weight="600" fill="${C.muted}">${esc(t)}</text>`
const line = (x: number, y: number, t: string, fill = C.ink, size = 13) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${esc(t)}</text>`

// A thin rule that runs up to the arrow button beside it.
export const divider = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 8" width="100%"><line x1="${X}" y1="4" x2="${W - 6}" y2="4" stroke="${C.hair}" stroke-width="1"/></svg>`

// Every file Claude touched in this chat, in the card's type: a few on one line at rest, one per line when open.
export function filesSvg(files: string[], isOpen: boolean): string {
  const p: string[] = []
  let y = 16
  p.push(label(X, y, `${files.length} file${files.length === 1 ? '' : 's'} changed in this chat`)); y += 19
  if (isOpen) for (const f of files.slice(0, 60)) { p.push(`<circle cx="${X + 3}" cy="${y - 4}" r="2" fill="${C.sage}"/>` + line(X + 12, y, wrap(f, 42, 1)[0], C.soft, 12.5)); y += 17 }
  else for (const l of wrap(files.slice(0, 3).join(', ') + (files.length > 3 ? ` and ${files.length - 3} more` : ''), 46, 2)) { p.push(line(X, y, l, C.soft, 12.5)); y += 17 }
  y += 4
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${y}" width="100%" ${FONT}>${p.join('')}</svg>`
}

const HERO_H = 164

// The volume beside the mascot: ten bars that fill from the bottom, and the level under them.
export function volumeSvg(sound: { isOn: boolean; volume: number }): string {
  const on = sound.isOn && sound.volume > 0
  const steps = on ? Math.round(sound.volume * 10) : 0
  const p: string[] = []
  for (let i = 0; i < 10; i++) {
    const y = 4 + (9 - i) * 8
    p.push(`<rect x="${10 - (4 + i * 0.9) / 2}" y="${y}" width="${(4 + i * 0.9).toFixed(1)}" height="5" rx="2.5" fill="${i < steps ? (i >= 8 ? C.glow : C.soft) : C.track}"/>`)
  }
  p.push(`<text x="10" y="98" text-anchor="middle" font-size="11" font-weight="600" fill="${on ? C.soft : C.muted}">${on ? `${Math.round(sound.volume * 100)}%` : 'off'}</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 0 32 102" width="32" height="102" ${FONT}>${p.join('')}</svg>`
}

export function cardSvg(c: Card): string {
  return cardParts(c).whole
}

// The card in two pieces, split just above the sound row, so the sound buttons sit between them.
export function cardParts(c: Card): { whole: string; hero: string; top: string; middle: string; bottom: string; isTaskCut: boolean } {
  const p: string[] = []
  let isTaskCut = false
  // Mascot on its glow, then who and what
  p.push(`<ellipse cx="160" cy="96" rx="112" ry="66" fill="url(#glow)"/>`)
  if (c.mascot) p.push(placeMascot(c.mascot, 72, 0, 176, 161))
  p.push(`<text x="160" y="182" text-anchor="middle" font-size="20" font-weight="650" fill="${C.ink}">${esc(c.name)}</text>`)
  p.push(`<text x="160" y="202" text-anchor="middle" font-size="13" fill="${C.muted}">${esc(`${sentence(moodWords(c.mood))}, on ${c.model}`)}</text>`)
  let y = 228
  // Today | This week
  for (const [x, name, time, spend] of [[X, 'Today', c.todayTime, c.todaySpend], [176, 'This week', c.weekTime, c.weekSpend]] as const) {
    p.push(label(x, y + 12, name))
    p.push(`<text x="${x}" y="${y + 40}" font-size="24" font-weight="650" fill="${C.ink}">${esc(time)}</text>`)
    p.push(`<text x="${x}" y="${y + 60}" font-size="14" font-weight="500" fill="${C.soft}">${esc(spend)}</text>`)
  }
  p.push(`<line x1="160" y1="${y}" x2="160" y2="${y + 62}" stroke="${C.hair}" stroke-width="1"/>`)
  y += 80
  p.push(hair(y))
  // Gauges: the conversation, and the plan's limits when Claude Code reports them
  const cf = c.contextPercent / 100
  const chat = gauge(0, 0, cf, `${Math.round(c.contextPercent)}%`, 'Chat', cf * 100 >= c.handoffAt ? 'hand off now' : `hand off at ${c.handoffAt}%`)
  const gy = y + 54
  if (c.limits && (c.limits.five || c.limits.week)) {
    const cols = [chat]
    if (c.limits.five) cols.push(gauge(0, 0, c.limits.five.percent / 100, `${Math.round(c.limits.five.percent)}%`, '5-hour', c.limits.five.reset && `resets ${c.limits.five.reset}`))
    if (c.limits.week) cols.push(gauge(0, 0, c.limits.week.percent / 100, `${Math.round(c.limits.week.percent)}%`, 'Weekly', c.limits.week.reset && `resets ${c.limits.week.reset}`))
    const step = (R - X) / cols.length
    cols.forEach((g, i) => p.push(`<g transform="translate(${(X + step * (i + 0.5)).toFixed(1)} ${gy})">${g}</g>`))
  } else p.push(`<g transform="translate(160 ${gy})">${chat}</g>`)
  y = gy + 62
  if (c.forecast) {
    for (const l of wrap(c.forecast, 46, 2)) { p.push(line(X, y, l, C.soft, 12.5)); y += 17 }
    y += 4
  }
  // Alerts and notes, only when there is something to say
  for (const a of c.alerts ?? []) {
    const ls = wrap(a.text, 42, 6)
    p.push(`<rect x="${X}" y="${y}" width="3" height="${ls.length * 18 + 6}" rx="1.5" fill="${TONE[a.tone]}"/>`)
    ls.forEach((l, i) => p.push(line(X + 14, y + 16 + i * 18, l)))
    y += ls.length * 18 + 18
  }
  // What Claude did in the last prompt, in full; a new report fades in line by line
  const t = c.lastTask
  const open = true
  if (t && (t.summary || t.asked)) {
    p.push(hair(y)); y += 22
    p.push(label(X, y, 'Last task report'))
    p.push(`<text x="${R}" y="${y}" text-anchor="end" font-size="12.5" fill="${C.soft}">${esc(t.took)}</text>`)
    y += 20
    const from = p.length
    if (t.asked) for (const l of wrap(`You asked: ${t.asked}`, 46, 3)) { p.push(line(X, y, l, C.muted, 12.5)); y += 18 }
    for (const l of wrap(t.summary, 44, 8)) { p.push(line(X, y, l, C.ink, 13)); y += 18 }
    const report = t.report ?? []
    if (report.length) {
      y += 6
      for (const point of report.slice(0, 6)) {
        wrap(point, 42, 4).forEach((l, i) => { p.push((i === 0 ? `<circle cx="${X + 3}" cy="${y - 4}" r="2" fill="${C.soft}"/>` : '') + line(X + 12, y, l, C.ink, 12.5)); y += 17 })
        y += 3
      }
    }
    y += 6
    if (t.files.length) {
      p.push(line(X, y, `Files changed (${t.files.length})`, C.muted, 12.5)); y += 18
      for (const f of t.files.slice(0, 6)) { p.push(`<circle cx="${X + 3}" cy="${y - 4}" r="2" fill="${C.sage}"/>` + line(X + 12, y, wrap(f, 42, 1)[0], C.soft, 12.5)); y += 17 }
      if (t.files.length > 6) { p.push(line(X + 12, y, `and ${t.files.length - 6} more`, C.muted, 12.5)); y += 17 }
    } else { p.push(line(X, y, 'No files changed', C.muted, 12.5)); y += 17 }
    if (t.age !== undefined) for (let n = from; n < p.length; n++) {
      const o = Math.max(0, Math.min(1, (t.age - (n - from) * 70) / 320))
      if (o < 1) p[n] = `<g opacity="${o.toFixed(2)}" transform="translate(0 ${((1 - o) * 6).toFixed(1)})">${p[n]}</g>`
    }
    y += 6
  }
  // Every file Claude touched in this chat
  if (c.changed && c.changed.length) {
    p.push(hair(y)); y += 22
    p.push(label(X, y, `${c.changed.length} file${c.changed.length === 1 ? '' : 's'} changed in this chat`)); y += 19
    for (const l of wrap(c.changed.slice(0, 5).join(', ') + (c.changed.length > 5 ? ` and ${c.changed.length - 5} more` : ''), 46, 3)) { p.push(line(X, y, l, C.soft, 12.5)); y += 17 }
    y += 8
  }
  // Split: the "See more" button goes here
  const taskY = y
  // Budget
  p.push(hair(y)); y += 22
  p.push(label(X, y, c.budget?.isPct ? 'Budget this week' : 'Budget today'))
  if (c.budget) {
    const b = clamp01(c.budget.used / c.budget.limit)
    const amount = c.budget.isPct
      ? `${c.budget.used > 0 && c.budget.used < 1 ? '<1' : Math.round(c.budget.used)}% of ${c.budget.limit}% of your limit`
      : `$${c.budget.used.toFixed(2)} of ${Number.isInteger(c.budget.limit) ? `$${c.budget.limit}` : `$${c.budget.limit.toFixed(2)}`}`
    p.push(`<text x="${R}" y="${y}" text-anchor="end" font-size="12.5" fill="${C.soft}">${amount}</text>`)
    p.push(`<rect x="${X}" y="${y + 10}" width="${R - X}" height="6" rx="3" fill="${C.track}"/>`)
    if (b > 0) p.push(`<rect x="${X}" y="${y + 10}" width="${Math.max(6, (R - X) * b).toFixed(1)}" height="6" rx="3" fill="${levelColor(b)}"/>`)
    y += 30
  } else {
    p.push(`<text x="${R}" y="${y}" text-anchor="end" font-size="12.5" fill="${C.muted}">none set, try /budget 20%</text>`)
    y += 14
  }
  // Split: the sound buttons go here
  const splitY = y + 4
  y += 18
  if (c.sound) {
    const on = c.sound.isOn && c.sound.volume > 0
    const steps = Math.round(c.sound.volume * 10)
    p.push(label(X, y, 'Sound when a task is done'))
    p.push(`<text x="${R}" y="${y}" text-anchor="end" font-size="12.5" fill="${on ? C.soft : C.muted}">${on ? `${Math.round(c.sound.volume * 100)}%` : 'off'}</text>`)
    for (let i = 0; i < 10; i++)
      p.push(`<rect x="${(X + i * 28.4).toFixed(1)}" y="${y + 10}" width="24" height="6" rx="3" fill="${on && i < steps ? C.soft : C.track}"/>`)
    y += 34
  }
  const cmds = ['/report', '/handoff', '/pin', '/budget', '/knife']
  cmds.forEach((t, i) => p.push(`<text x="${(X + (R - X) * (i + 0.5) / cmds.length).toFixed(1)}" y="${y}" text-anchor="middle" font-size="12" fill="${C.muted}">${t}</text>`))
  const H = y + 14
  const svg = (y0: number, y1: number, x0 = 0, w = W) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${y1 - y0}" width="100%" ${FONT}>` +
    `<defs><radialGradient id="glow"><stop offset="0" stop-color="${C.glow}" stop-opacity=".30"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/></radialGradient></defs>` +
    p.join('') + `</svg>`
  // hero: the mascot on its glow alone, narrower, so the volume control can stand beside it
  return { whole: svg(0, H), hero: svg(0, HERO_H, 40, 240), top: svg(HERO_H, taskY), middle: svg(taskY, splitY), bottom: svg(splitY, H), isTaskCut }
}
