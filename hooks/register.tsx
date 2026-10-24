// Swiss Knife: one mod, many blades. Meter, /report, model coach, handoff, guard, budget, mascot,
// "needs you" alerts, plan limits, /pin and the changed-files list.
// The rules live in the other files in this folder; this file wires them to Claude Code.
import type { Register } from 'claude-code'
import {
  type Day, type Project, dayKey, emptyDay, projectName, workedMs, statusText, sumDays, fmtTime, fmtSpend,
  budgetWarning, budgetLevel, parseBudget, money, usageDelta, fmtPct, pctWarning, reportPrompt, REPORT_SYSTEM, oneLine, ago, fmtDuration, firstSentence, IDLE_MS,
} from './meter'
import { sizeOf, DIRECTION_SYSTEM, coachLine, label } from './coach'
import { bar, moodWords } from './dashboard'
import {
  type Alert, type Level, type AlertKind, ACCENT, RED, AMBER, GREEN, reportLine, docSections, fileItem, sectionSummary, cleanPin, clock, when, actionText, spendText, waitingText, strip, barSvg, barText, ruleSvg, volumeBarsSvg,
  segmentsSvg, segmentsText, docLine,
} from './ui'
import { type Sound, DEFAULT_SOUND, MIN_TASK_MS, step, parseVolume, windowsPlay, soundLabel } from './sound'
import {
  type Note, type HandoffLevel, HANDOFF_AT, STALE_MS, shouldWarn, warnText, handoffSystem, handoffInput, parseDoc, noteContext, notePaste,
  noteFile, noteMarkdown, loadingBar, parseThreshold, conversationText,
} from './handoff'
import { explain, SHELL_TOOLS } from './guard'
import { type Mood, moodForTool, frameAt, svgFrameAt, playLength, cellsFor, COLUMNS, ROWS } from './mascot'
import { type Window, type Sample, FIVE_HOUR, WEEKLY, windowOf, current, fmtReset, addSample, runsOutAt, fmtClock, limitWarning } from './limits'
import { type Pin, makePin, relPath, EDIT_TOOLS, addChanged, titleOf, togglePin } from './pin'
import { mask, scrub, parseRecap, secretRanges, MASKED } from './secrets'
import { BLADES, DEMOS, type BladeKey, type Group } from './settings'
import { cacheTtlMs, cacheState, cacheText, parseTtl } from './cache'

const PANE = 'swiss-knife'
const PINS_PANE = 'swiss-knife-pins'
const SETTINGS_PANE = 'swiss-knife-settings'
const HANDOFF_PANE = 'swiss-knife-handoff'
const HARD_TASK_MS = 90_000 // a task this long, or with this many steps, gets an automatic recap
const HARD_TASK_TOOLS = 8
const REPING_MS = 5 * 60_000 // still waiting after this long: a second ping
const RECAP_SYSTEM =
  'Line 1 starts with "RECAP:" and says, in 1 or 2 short sentences of plain English, ' +
  'what was just achieved, for someone who is not a developer: start with a verb, no code, no file names, no jargon, ' +
  'only claim what the reply confirms. Line 2 starts with "NEXT:" and gives the most useful next request the person ' +
  'could type, under 12 words, in their voice (like "make the form send emails"), or "none". ' +
  'Then a line "REPORT:" followed by 2 to 5 lines starting with "- ": what was done or found, step by step, ' +
  'and anything left to check, in the same plain English, only what the reply confirms.'

// What one answer used: dollars (what it would cost on the API) and points of the plan's limits.
type ReplyUsage = { usd?: number; five?: number; week?: number }
const replyKey = (text: string) => oneLine(text, 160)
const usageKey = () => `usage:${k.sessionId}`
const taskKey = () => `task:${k.sessionId}`

// The last-task report and this chat's changed files outlive a restart of the app.
async function saveTask($: any) {
  await $.store.set(taskKey(), { lastTask: k.lastTask, changed: k.changed }).catch(() => undefined)
}

// "2% of 5-hour", "<1% of week", "worth $0.20": what one answer used.
function usageParts(r: ReplyUsage): string[] {
  const pct = (n: number) => (n > 0 ? fmtPct(n) : '<1%')
  const out: string[] = []
  if (r.five !== undefined) out.push(`${pct(r.five)} of 5-hour`)
  if (r.week !== undefined) out.push(`${pct(r.week)} of week`)
  if (r.usd !== undefined) out.push(`${k.limits.length ? 'worth ' : ''}${r.usd < 0.01 ? 'under 1¢' : `$${r.usd.toFixed(2)}`}`)
  return out
}

type Tab = 'knife' | 'handoff' | 'pins' | 'settings'

type Blades = { all: boolean; mascot: boolean; coach: boolean; guard: boolean; ping: boolean; cache: boolean; next: boolean; secrets: boolean; strip: boolean }

// This session's running values. They start over when the mod reloads; totals live in $.store.
const k = {
  cwd: '',
  lastActivity: undefined as number | undefined,
  lastUsd: undefined as number | undefined, // the session's reported cost at the last answer
  hasCost: false,
  isFirstPrompt: true,
  isWorking: false,
  hasWarnedHandoff: false,
  handoffAt: HANDOFF_AT,
  contextPercent: 0,
  sound: { ...DEFAULT_SOUND } as Sound,
  turnStartAt: 0,
  turnTools: 0,
  appDrawnAt: 0, // when the desktop app last drew the mascot: it needs a redraw per frame
  appFrame: '',
  model: '',
  coachSize: null as 'small' | 'medium' | 'big' | null, // where the chat is going, as the coach last judged it
  blades: { all: true, mascot: true, coach: true, guard: true, ping: true, cache: true, next: true, secrets: true, strip: true } as Blades,
  lastReplyAt: 0, // when Claude last answered: the cheap cache runs from here
  contextTokens: 0,
  cacheLine: '', // the cache timer's text as last drawn
  cacheTtl: null as number | null, // the person's own promptCacheTtl setting, when they set one

  status: '', // the meter line, also drawn in the band
  message: null as Alert | null, // one line for the person: welcome back, a demo, a warning
  tab: 'knife' as Tab, // the panel's tab: Swiss Knife, Handoff, Pins or Settings
  action: '', // what Claude is doing now, for the strip: "Writing index.html"
  second: 0, // the clock second last drawn, so running timers tick
  isHandedOff: false, // a handoff was just written: the strip says so until the next prompt
  noteSent: null as Note | null, // the handoff a new chat just picked up, shown until the first reply
  note: null as Note | null, // a handoff note waiting for the first prompt
  isNoteStale: false, // that note is old: it waits for "Continue it" instead of going along by itself
  // The Handoff tab: writing (the mascot writes), ready (the document), failed, or idle.
  handoff: { status: 'idle', level: 'standard', startedAt: 0, note: null, file: '' } as {
    status: 'idle' | 'writing' | 'ready' | 'failed'; level: HandoffLevel; startedAt: number; note: Note | null; file: string; messages?: number
  },
  handoffFrame: '',
  nextStep: '', // the suggested next request, a button in the strip until the next prompt
  waiting: null as { since: number; text: string } | null, // Claude is waiting for the person
  limits: [] as Window[],
  samples: [] as Sample[], // the 5-hour window over the last hour, for the pace
  limitShown: {} as Record<string, number>,
  changed: [] as string[], // files Claude changed this session
  sessionId: '', // pins made in this session can scroll back to their message
  expanded: '', // the pin whose full text the Pins tab shows
  pins: null as Pin[] | null, // kept in memory: every reply's pin button reads it on each redraw
  turnFiles: [] as string[], // files changed by the current prompt
  isTaskOpen: false, // the last task's full list of changed files
  isSoundOpen: false, // the volume row under the panel's header
  hoOpen: '', // the handoff section opened in the Handoff tab
  settingsOpen: '', // the Settings group opened
  isFilesOpen: false, // the "files changed in this chat" list, opened in full
  reportAt: 0, // when the last-task report last changed: it fades in from there
  isBandFolded: false, // the strip above the prompt, folded to one line
  lastWeekPct: undefined as number | undefined, // the weekly limit's reading at the last answer
  lastFivePct: undefined as number | undefined, // and the 5-hour limit's
  replyUsage: {} as Record<string, ReplyUsage>, // what each answer of this chat used, by its text
  lastTask: null as null | { at: number; ms: number; usd?: number; asked: string; summary: string; report?: string[]; files: string[] },
  mood: 'greeting' as Mood,
  moodAt: 0,
  band: null as { requestId: string; drawn: string } | null, // where the terminal mascot is mounted
  timer: null as { cancel: () => void } | null,
}

// A chip's label with room on both sides: the button itself fills the chip, so all of it is clickable.
const pad = (label: string) => ` ${label} `

const projectKey = () => `project:${k.cwd}`
const noteKey = () => `handoff:${k.cwd}`
const pinsKey = () => `pins:${k.cwd}`

async function load($: any): Promise<Project> {
  return ((await $.store.get(projectKey())) as Project | undefined) ?? { name: projectName(k.cwd), days: {} }
}

// Adds working time (and any change) to today, saves, and refreshes the meter line.
async function track($: any, change: (d: Day, p: Project) => void = () => {}) {
  if (!k.blades.all) return
  const cwd = (await $.session.cwd()) || k.cwd // the desktop app starts in your home folder, then moves to the project
  if (cwd !== k.cwd) k.pins = null // another project: its own pins
  k.cwd = cwd
  if (!k.cwd) return
  const now = await $.clock.now()
  const p = await load($)
  const day = dayKey(now)
  const today = (p.days[day] ??= emptyDay())
  today.done ??= []
  today.ms += workedMs(k.lastActivity, now)
  k.lastActivity = now
  change(today, p)
  const week = sumDays(p, dayKey(now - 6 * 86400000))
  const hasPlan = k.limits.length > 0
  const warning = budgetWarning(p, day, today.usd) ?? pctWarning(p, dayKey(now - (new Date(now).getDay() * 86400000)), week.weekPct ?? 0)
  await $.store.set(projectKey(), p)
  k.status = statusText(p.name, today, k.hasCost, p.budgetUsd, hasPlan)
  $.ui.status(k.status)
  if (warning) { $.ui.toast(warning); await setMood($, 'gag-tokens') } // the alert itself comes from the numbers
}

function say($: any, text: string, level: Level = 'info', kind: AlertKind = 'note') {
  k.message = text ? { kind, level, text } : null
  $.ui.invalidate('ui.render')
}

async function setMood($: any, mood: Mood) {
  if (k.mood === mood) return
  k.mood = mood
  k.moodAt = await $.clock.now()
  $.ui.invalidate('ui.render') // the desktop app redraws its picture; the terminal repaints on the next tick
}

// Pins: a list per project, newest first.
async function loadPins($: any): Promise<Pin[]> {
  if (k.pins) return k.pins
  const list = (await $.store.get(pinsKey())) as Pin[] | undefined
  const old = (await $.store.get(`pin:${k.cwd}`)) as Omit<Pin, 'id'> | undefined // the single pin of the first version
  k.pins = list ?? (old ? [{ ...old, id: `pin-${old.at}` }] : [])
  return k.pins
}

async function savePins($: any, pins: Pin[]) {
  k.pins = pins
  await $.store.set(pinsKey(), pins)
  $.ui.invalidate('ui.render')
}

// The 📌 under a reply: pins it, or unpins it when it is pinned already.
async function pinMessage($: any, requestId: string, text: string) {
  const pins = await loadPins($)
  const updated = togglePin(pins, makePin(text, titleOf(text), await $.clock.now(), { requestId, sessionId: k.sessionId }))
  await savePins($, updated)
  $.ui.toast(updated.length > pins.length ? 'Pinned. Find it in the Pins tab.' : 'Unpinned.')
}

async function unpin($: any, id: string) {
  await savePins($, (await loadPins($)).filter(x => x.id !== id))
}

async function foldBand($: any) {
  k.isBandFolded = !k.isBandFolded
  await $.store.set('bandFolded', k.isBandFolded)
  $.ui.invalidate('ui.render')
}

function toggleText($: any, id: string) {
  k.expanded = k.expanded === id ? '' : id
  $.ui.invalidate('ui.render')
}

// "Go to message": scroll the conversation, up or down, to the pinned reply.
async function jumpTo($: any, pin: Pin) {
  if (!pin.requestId) return
  const byKey = await $.ui.scroll({ to: { key: `reply-${pin.requestId}` }, block: 'center' }).catch((x: unknown) => ({ deny: String(x) }))
  if (byKey.deny === undefined) return
  const byId = await $.ui.scroll({ to: { requestId: pin.requestId }, block: 'center' }).catch((x: unknown) => ({ deny: String(x) }))
  if (byId.deny === undefined) return
  $.ui.toast(`The app didn't scroll to that message (${oneLine(String(byId.deny || byKey.deny), 90)}).`)
}

// Clicking a pin: scroll the conversation to its message when it is in this session, else show its full text.
async function openPin($: any, pin: Pin) {
  if (pin.requestId && pin.sessionId === k.sessionId) {
    // First the 📌 row this mod drew under the reply, then the reply itself.
    const byKey = await $.ui.scroll({ to: { key: `reply-${pin.requestId}` }, block: 'start' }).catch((x: unknown) => ({ deny: String(x) }))
    if (byKey.deny === undefined) return
    const byId = await $.ui.scroll({ to: { requestId: pin.requestId }, block: 'start' }).catch((x: unknown) => ({ deny: String(x) }))
    if (byId.deny === undefined) return
    $.ui.toast(`Couldn't jump to that message (${oneLine(String(byId.deny || byKey.deny), 80)}). Showing its text here instead.`)
  }
  k.expanded = k.expanded === pin.id ? '' : pin.id
  $.ui.invalidate('ui.render')
}

async function copyPin($: any, pin: Pin, surface: string) {
  const r = await $.ui.copy({ text: pin.text, surface }).catch((x: unknown) => ({ isCopied: false, reason: String(x) }))
  $.ui.toast(r.isCopied ? 'Copied.' : `Couldn't copy (${oneLine(String(r.reason), 80)}).`)
}

function toggleFiles($: any) {
  k.isFilesOpen = !k.isFilesOpen
  $.ui.invalidate('ui.render')
}

function toggleTask($: any) {
  k.isTaskOpen = !k.isTaskOpen
  $.ui.invalidate('ui.render')
}

async function showSettings($: any) {
  await showPane($, 'settings')
}

async function toggleBlade($: any, key: BladeKey) {
  k.blades[key] = !k.blades[key]
  await $.store.set('blades', k.blades)
  $.ui.invalidate('ui.render')
}

async function setAll($: any) {
  k.blades.all = !k.blades.all
  await $.store.set('blades', k.blades)
  if (!k.blades.all) $.ui.status(undefined)
  else { k.lastActivity = undefined; await track($) }
  $.ui.invalidate('ui.render')
}

// Budget from the Settings tab: a share of the weekly limit in steps of 5%, or dollars in steps of $1; 0 turns it off.
async function stepBudget($: any, kind: 'pct' | 'usd', by: number | 'off') {
  const p = await load($)
  if (kind === 'pct') {
    const next = by === 'off' ? 0 : Math.max(0, Math.min(100, (p.budgetPct ?? 0) + by))
    if (next > 0) { p.budgetPct = next; delete p.pctWarned } else delete p.budgetPct
  } else {
    const next = by === 'off' ? 0 : Math.max(0, Math.round(((p.budgetUsd ?? 0) + by) * 100) / 100)
    if (next > 0) { p.budgetUsd = next; delete p.budgetWarned } else delete p.budgetUsd
  }
  await $.store.set(projectKey(), p)
  await track($)
  $.ui.invalidate('ui.render')
}

async function setHandoffAt($: any, at: number) {
  k.handoffAt = Math.max(20, Math.min(95, at))
  k.hasWarnedHandoff = false
  await $.store.set('handoffAt', k.handoffAt)
  $.ui.invalidate('ui.render')
}

// /knife demo: stages a feature with sample numbers, so the ones that need a long chat can be seen in seconds.
// The next real answer from Claude puts the real numbers back.
async function demo($: any, name: string): Promise<string> {
  const now = await $.clock.now()
  const ttl = cacheTtlMs(k.limits.length > 0, k.cacheTtl)
  if (name === 'needs-you') { k.waiting = null; await needsYou($, 'Claude needs your permission to run npm install'); return 'Demo: Claude is waiting for you. Send any message to clear it.' }
  if (name === 'handoff') { k.contextPercent = 74; k.hasWarnedHandoff = true; $.ui.toast(warnText(74)); await setMood($, 'context-nearly-full') }
  else if (name === 'cache') { k.contextTokens = 82_000; k.lastReplyAt = now - ttl + 4 * 60_000 }
  else if (name === 'cache-gone') { k.contextTokens = 82_000; k.lastReplyAt = now - ttl - 60_000 }
  else if (name === 'limits') {
    const reset = new Date(now + 2 * 3600_000).toISOString()
    k.limits = [{ kind: FIVE_HOUR, percentUsed: 86, resetsAt: reset }, { kind: WEEKLY, percentUsed: 52, resetsAt: new Date(now + 4 * 86400_000).toISOString() }]
    k.samples = [{ at: now - 30 * 60_000, percent: 70 }, { at: now, percent: 86 }]
    $.ui.toast(`Demo: you've used 86% of your 5-hour limit.`)
  } else if (name === 'budget') { say($, 'Over today\'s budget: $5.40 of $5 (demo).', 'urgent', 'budget'); $.ui.toast('Demo: over today\'s $5 budget.'); await setMood($, 'gag-tokens') }
  else if (name === 'recap') {
    k.lastTask = { at: now, ms: 134_000, usd: 0.12, asked: 'add a contact form with name, email and message',
      summary: 'Added a contact form under the address with name, email and message fields, a check that the email looks right, and a thank-you note after sending. It also fits phone screens.',
      report: ['Added a form with name, email and message under the shop address.', 'The email box now checks that the address looks right before sending.', 'A thank-you note shows after sending.', 'Left to check: the form does not send anything yet; it needs an email service.'],
      files: ['index.html', 'css/form.css', 'js/form.js', 'images/send.svg', 'README.md'] }
    k.isTaskOpen = false
    k.reportAt = now
    offerNext($, 'make the form send me an email')
    void chime($, 'done')
  } else return `Demos: ${Object.keys(DEMOS).join(', ')}. Example: /knife demo cache`
  await showPane($)
  $.ui.invalidate('ui.render')
  return `Demo: ${DEMOS[name]}. The next real answer from Claude puts the real numbers back.`
}

// At startup only the Swiss Knife tab opens: the app shows the last tab opened, so Pins and Settings wait for a click.
async function openTabs($: any) {
  await showPane($)
}

async function showPins($: any) {
  await showPane($, 'pins')
}

// One app tab holds everything; its own tabs switch between Swiss Knife, Handoff, Pins and Settings.
async function showPane($: any, tab?: Tab) {
  if (tab && tab !== k.tab) { k.tab = tab; $.ui.invalidate('ui.render') }
  await $.ui.open({ id: PANE, title: 'Swiss Knife' }).catch(() => undefined)
}

// After a task: a plain-English recap for the "Last task" report, saved for /report too.
// The toast is only for long tasks, the ones you may have walked away from.
async function recap($: any, asked: string, did: string, isLong: boolean) {
  try {
    const r = await $.model.complete({ model: 'haiku', maxTokens: 600, system: RECAP_SYSTEM, prompt: `Asked: ${asked}\nClaude's reply: ${did}` })
    if (!r.isAnswered || !r.text.trim()) return
    const { recap: text, next, report } = parseRecap(r.text)
    const line = oneLine(text, 600)
    // Next step: shown dim in the empty prompt box, Tab takes it.
    if (next && k.blades.next) offerNext($, oneLine(next, 120))
    if (k.lastTask) { k.lastTask.summary = line; k.lastTask.report = report.map(x => oneLine(x, 300)); k.reportAt = await $.clock.now(); await saveTask($) }
    $.ui.invalidate('ui.render')
    if (isLong) $.ui.toast(`✅ ${line}`)
    await track($, d => { if (d.done.length) d.done[d.done.length - 1] = line })
  } catch { /* the recap is a bonus: the reply's first sentence stays */ }
}

// The next step: the prompt box's dim suggestion where it draws one (the terminal), and a button in the
// strip everywhere, which types it into the prompt box.
function offerNext($: any, text: string) {
  k.nextStep = text
  void $.prompt.suggest({ text }).catch(() => undefined)
  $.ui.invalidate('ui.render')
}

async function takeNext($: any, surface: string) {
  const text = k.nextStep
  if (!text) return
  const r = await $.prompt.fill({ text, mode: 'replace' }).catch(() => ({ isFilled: false }))
  if (r.isFilled) { k.nextStep = ''; $.ui.invalidate('ui.render'); return }
  const c = await $.ui.copy({ text, surface }).catch(() => ({ isCopied: false }))
  $.ui.toast(c.isCopied ? 'Copied: paste it in the prompt box.' : text)
}

// Down to zero is off; "+" turns it back on.
function quieter($: any) {
  const volume = step(k.sound.volume, -0.1)
  return setSound($, volume === 0 ? { volume: 0, isOn: false } : { volume })
}

async function setSound($: any, change: Partial<Sound>) {
  const before = k.sound
  k.sound = { ...k.sound, ...change }
  // The mascot reacts: dances when it gets louder, puts on its nightcap when quieter or muted, waves when sound comes back.
  const reaction: Mood | null =
    !k.sound.isOn ? 'asleep-nightcap'
    : !before.isOn ? 'greeting'
    : k.sound.volume > before.volume ? 'gag-dance'
    : k.sound.volume < before.volume ? 'asleep-nightcap' : null
  if (reaction && k.blades.mascot) { k.mood = 'idle'; await setMood($, reaction) }
  await $.store.set('sound', k.sound)
  $.ui.invalidate('ui.render')
  if (change.volume !== undefined && k.sound.isOn) void chime($, 'done')
}

// A sound: Windows' own player at the chosen volume; elsewhere Claude Code's player.
async function chime($: any, sound: 'done' | 'attention') {
  if (!k.sound.isOn || k.sound.volume <= 0) return
  try {
    if ((await $.env.get('OS')) === 'Windows_NT')
      await $.process.run(windowsPlay(`${$.plugin.root}\\sounds\\${sound}.wav`, k.sound.volume), { timeoutMs: 6000 })
    else await $.audio.play({ asset: `sounds/${sound}.wav` }, { gain: k.sound.volume })
  } catch { /* no sound is better than a broken session */ }
}

// Needs you: Claude asked a question, wants permission or wants a plan approved.
async function needsYou($: any, text: string) {
  if (!k.blades.all || !k.blades.ping || k.waiting) return
  const since = await $.clock.now()
  k.waiting = { since, text: waitingText(text) }
  await setMood($, 'waiting-for-you')
  void chime($, 'attention')
  const p = await load($)
  void $.ui.notify(text, { title: `Claude needs you in ${p.name}` }).catch(() => undefined)
  $.clock.after(REPING_MS, () => { void pingAgain($, since).catch(() => undefined) })
}

async function pingAgain($: any, since: number) {
  if (k.waiting?.since !== since) return // answered already
  void chime($, 'attention')
  const p = await load($)
  void $.ui.notify(`Still waiting, 5 min now. ${k.waiting.text}`, { title: `Claude needs you in ${p.name}` }).catch(() => undefined)
}

async function answered($: any) {
  if (!k.waiting) return
  k.waiting = null
  await setMood($, k.isWorking ? 'thinking' : 'idle')
}

// Plan limits: keep the windows, the pace of the 5-hour one, and warn at 80% and 95%.
function takeLimits($: any, windows: readonly Window[] | undefined, now: number) {
  if (!windows || windows.length === 0) return
  k.limits = windows.filter(w => Number.isFinite(w.percentUsed)).map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
  void $.store.set('limits', k.limits) // a new session knows the plan before its first answer
  const five = windowOf(k.limits, FIVE_HOUR)
  if (five) k.samples = addSample(k.samples, { at: now, percent: five.percentUsed })
  for (const w of [five, windowOf(k.limits, WEEKLY)]) {
    const warning = limitWarning(w, k.limitShown)
    if (warning) $.ui.toast(warning)
  }
  $.ui.invalidate('ui.render')
}

const restMood = (): Mood => (k.contextPercent >= k.handoffAt ? 'context-nearly-full' : 'idle')

// Every 100 ms: settle finished animations, fall asleep on a break, repaint the mascot.
async function tick($: any) {
  const now = await $.clock.now()
  const elapsed = now - k.moodAt
  if ((k.mood === 'done' || k.mood === 'greeting') && elapsed > playLength(k.mood) + 1500) await setMood($, restMood())
  else if ((k.mood === 'error' || k.mood === 'gag-tokens') && elapsed > 4000) await setMood($, k.isWorking ? 'thinking' : restMood())
  else if ((k.mood === 'gag-dance' || k.mood === 'asleep-nightcap') && elapsed > (k.sound.isOn ? 3000 : 4500)) await setMood($, k.isWorking ? 'thinking' : restMood())
  else if (!k.isWorking && !k.waiting && k.mood !== 'asleep' && now - (k.lastActivity ?? k.moodAt) > IDLE_MS) await setMood($, 'asleep')
  if (now - k.reportAt < 1600) $.ui.invalidate('ui.render') // the report fading in
  const second = Math.floor(now / 1000)
  if ((k.isWorking || k.waiting) && second !== k.second) { k.second = second; $.ui.invalidate('ui.render') } // "0:42" ticking
  if (k.handoff.status === 'writing') { // the Handoff tab: the mascot writing, the bar sliding
    const id = `${svgFrameAt('writing', now - k.handoff.startedAt).index}:${Math.floor((now - k.handoff.startedAt) / 120)}`
    if (id !== k.handoffFrame) { k.handoffFrame = id; $.ui.invalidate('ui.render') }
  }
  const cacheLine = currentCacheLine(now)
  if (cacheLine !== k.cacheLine) { k.cacheLine = cacheLine; $.ui.invalidate('ui.render') }
  if (k.blades.mascot && now - k.appDrawnAt < 60_000) {
    const id = `${k.mood}:${svgFrameAt(k.mood, now - k.moodAt).index}`
    if (id !== k.appFrame) { k.appFrame = id; $.ui.invalidate('ui.render') }
  }
  const band = k.band
  if (!band || !k.blades.mascot) return
  const { index, frame } = frameAt(k.mood, now - k.moodAt)
  const id = `${k.mood}:${index}`
  if (id === band.drawn) return
  const r = await $.ui.blit({ requestId: band.requestId, key: 'mascot', cells: cellsFor(k.mood, index, frame) })
  if (r.deny !== undefined) { k.band = null; $.ui.invalidate('ui.render') } // moved or resized: the next render remounts it
  else band.drawn = id
}

// A reload drops timers, so this runs again at every session and turn start.
function startTicker($: any) {
  if (k.timer) return
  k.timer = $.clock.every(100, () => { void tick($).catch(() => undefined) })
}

// Model coach: after each reply, a quick look at where the chat is going. It only advises; the person
// switches in the app's model menu, so the menu and the mascot always name the model that runs.
async function coachAfter($: any) {
  try {
    const messages = await $.session.messages()
    const r = await $.model.complete({ model: 'haiku', system: DIRECTION_SYSTEM, prompt: conversationText(messages, 8, 600), effort: 'low', maxTokens: 10 })
    if (!r.isAnswered) return
    k.coachSize = sizeOf(r.text)
    $.ui.invalidate('ui.render')
  } catch { /* advice is optional */ }
}

// An earlier version could change the default model; this only clears what it left behind.
async function restoreModel($: any) {
  await $.store.delete('coach:restore').catch(() => undefined)
}

// Guard: a destructive command waits for a yes in Claude Code's own permission prompt,
// explained in plain English. That prompt is drawn natively on every surface, desktop included.
const guardReason = (command: string) => explain(command)

// What needs saying right now, most urgent first: needs you, then anything over a limit, then warnings, then tips.
async function alerts($: any, p: Project, today: Day): Promise<Alert[]> {
  const out: Alert[] = []
  const now = await $.clock.now()
  if (k.waiting) out.push({ kind: 'waiting', level: 'urgent', text: `${k.waiting.text} We'll ping you again in 5 min.` })
  const spent = budgetLevel(today.usd, p.budgetUsd)
  if (spent > 0 && k.hasCost) out.push({ kind: 'budget', level: spent === 100 ? 'urgent' : 'warn',
    text: spent === 100 ? `Over today's budget: $${today.usd.toFixed(2)} of ${money(p.budgetUsd!)}.` : `80% of today's ${money(p.budgetUsd!)} budget used.` })
  if (p.budgetPct) {
    const share = sumDays(p, dayKey(now - 6 * 86400000)).weekPct ?? 0
    if (share >= p.budgetPct * 0.8) out.push({ kind: 'budget', level: share >= p.budgetPct ? 'urgent' : 'warn', text: `This project used ${fmtPct(share)} of your weekly limit, of its ${p.budgetPct}% share.` })
  }
  for (const w of [current(windowOf(k.limits, FIVE_HOUR), now), current(windowOf(k.limits, WEEKLY), now)]) {
    if (!w || w.percentUsed < 80) continue
    const name = w.kind === FIVE_HOUR ? '5-hour' : 'weekly'
    out.push({ kind: 'limit', level: w.percentUsed >= 95 ? 'urgent' : 'warn', text: `${Math.round(w.percentUsed)}% of your ${name} limit used. Resets ${fmtReset(w, now)}.` })
  }
  if (k.message && k.message.level !== 'info') out.push(k.message)
  if (k.contextPercent >= k.handoffAt) out.push({ kind: 'chat-full', level: 'warn', text: warnText(k.contextPercent) })
  const cache = currentCacheLine(now)
  if (cache) out.push({ kind: 'cache', level: cache.startsWith('Quick memory ran out') ? 'warn' : 'info', text: cache })
  const coachText = k.blades.coach && k.coachSize && !k.isWorking ? coachLine(k.coachSize, k.model, k.contextTokens) : ''
  if (coachText) out.push({ kind: 'tip', level: 'info', text: coachText })
  if (k.message && k.message.level === 'info') out.push(k.message)
  const rank = (a: Alert) => (a.kind === 'waiting' ? 0 : a.level === 'urgent' ? 1 : a.level === 'warn' ? 2 : a.kind === 'cache' ? 3 : a.kind === 'tip' ? 4 : 5)
  const sorted = out.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map(x => x.a)
  return k.blades.secrets ? sorted.map(a => ({ ...a, text: mask(a.text) })) : sorted
}

// The cache timer: only near the end of the cheap window, or once it ran out, while you are away.
function currentCacheLine(now: number): string {
  if (!k.blades.cache || k.isWorking || k.waiting) return ''
  const st = cacheState(k.lastReplyAt, now, cacheTtlMs(k.limits.length > 0, k.cacheTtl), k.contextTokens)
  return st ? cacheText(st, k.contextTokens, k.limits.length > 0) : ''
}

// The handoff document: Haiku for the quick one, Sonnet for the detailed one. Kept for the next
// session in this project, and as a file in .claude/handoffs.
async function writeHandoff($: any, level: HandoffLevel, next = ''): Promise<{ note: Note; file: string } | null> {
  try {
    const messages = await $.session.messages()
    if (messages.length < 2) return null
    const p = await load($)
    const r = await $.model.complete({
      model: level === 'full' ? 'sonnet' : 'haiku', system: handoffSystem(level),
      prompt: handoffInput(messages, k.changed, p.name, level),
      maxTokens: level === 'full' ? 6000 : 2000, timeoutMs: level === 'full' ? 240_000 : 90_000,
    })
    const note = r.isAnswered ? parseDoc(r.text, await $.clock.now(), level) : null
    if (!note) return null
    if (next.trim()) note.next = oneLine(next, 120) // the person's own words win
    await $.store.set(noteKey(), note)
    const file = noteFile(note)
    const isFiled = await $.fs.write(`${k.cwd}/${file}`, noteMarkdown(note, p.name)).then(() => true, () => false)
    return { note, file: isFiled ? file : '' }
  } catch { return null }
}

// The 🧳 button and /handoff: the Handoff tab opens, the mascot writes, then the document shows there.
// A mod can't open a session, so the person opens one; its first message carries the document.
async function startHandoff($: any, level: HandoffLevel = 'standard', next = '') {
  if (k.handoff.status === 'writing') { await showHandoff($); return }
  k.handoff = { ...k.handoff, status: 'writing', level, startedAt: await $.clock.now(), messages: (await $.session.messages()).length }
  $.ui.invalidate('ui.render')
  await showHandoff($)
  const done = await writeHandoff($, level, next)
  k.handoff = done ? { ...k.handoff, status: 'ready', note: done.note, file: done.file } : { ...k.handoff, status: 'failed' }
  if (done) { k.isHandedOff = true; $.ui.toast('Handoff ready. Open a new chat in this project to continue.'); void chime($, 'done') }
  $.ui.invalidate('ui.render')
}

async function showHandoff($: any) {
  await showPane($, 'handoff')
}

async function copyHandoff($: any, surface: string) {
  const note = k.handoff.note
  if (!note) return
  const r = await $.ui.copy({ text: notePaste(note), surface }).catch((x: unknown) => ({ isCopied: false, reason: String(x) }))
  $.ui.toast(r.isCopied ? 'Copied. Paste it as the first message of any chat.' : `Couldn't copy (${oneLine(String(r.reason), 80)}).`)
}

// Throw the handoff away: the next session starts with nothing.
async function discardHandoff($: any) {
  k.handoff = { ...k.handoff, status: 'idle', note: null, file: '' }
  k.note = null
  k.isHandedOff = false
  await $.store.delete(noteKey())
  $.ui.invalidate('ui.render')
}

// A waiting note, at a session's start: a recent one goes along with the first message by itself,
// with its next step ready in the prompt box; an old one waits for "Continue it".
async function takeNote($: any, now: number): Promise<boolean> {
  const note = (await $.store.get(noteKey())) as Note | undefined
  if (!note) return false
  k.note = note
  k.isNoteStale = now - note.at > STALE_MS
  if (!k.isNoteStale && note.next) void $.prompt.suggest({ text: oneLine(note.next, 120) }).catch(() => undefined)
  $.ui.invalidate('ui.render') // the strip says "Continuing", or asks about an old one
  return true
}

async function continueNote($: any) {
  k.isNoteStale = false
  if (k.note?.next) void $.prompt.suggest({ text: oneLine(k.note.next, 120) }).catch(() => undefined)
  $.ui.invalidate('ui.render')
}

// A new chat in the same process (/clear): nothing of the last chat carries over but the handoff note.
async function startOver($: any) {
  k.isFirstPrompt = true
  k.lastReplyAt = 0; k.contextPercent = 0; k.contextTokens = 0; k.hasWarnedHandoff = false
  k.coachSize = null
  await takeNote($, await $.clock.now())
}

// When a fresh chat would help: the quick memory is running out or gone, or the chat is getting full.
const isFreshTime = (now: number) => currentCacheLine(now) !== '' || k.contextPercent >= k.handoffAt

function forecast(now: number): string {
  const five = windowOf(k.limits, FIVE_HOUR)
  const at = runsOutAt(k.samples, five)
  return at && at > now ? `At this pace your 5-hour limit runs out around ${fmtClock(at)}.` : ''
}

// The drawing kit for one surface: the toolkit's elements, and the bar and rule that suit it.
function kit($: any, e: any) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const Svg = e.surface === 'terminal' ? null : ($.ui.resolve(e) as any).Svg
  const isTerm = e.surface === 'terminal'
  const Bar = ({ f, label }: { f: number; label: string }) => (Svg
    ? <Svg source={barSvg(f)} alt={label} height={8} />
    : <Text color={f >= 0.95 ? RED : f >= 0.8 ? AMBER : ACCENT} wrap="truncate-end">{barText(f, 28)}</Text>)
  const Rule = () => (Svg ? <Svg source={ruleSvg()} alt="" height={1} /> : <Text dimColor wrap="truncate-end">{'─'.repeat(120)}</Text>)
  return { Box, Text, Button, Svg, isTerm, Bar, Rule }
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'knife', label: 'Swiss Knife' }, { id: 'handoff', label: 'Handoff' }, { id: 'pins', label: 'Pins' }, { id: 'settings', label: 'Settings' },
]

function setTab($: any, tab: Tab) {
  k.tab = tab
  $.ui.invalidate('ui.render')
}

const spendOf = (usd: number | undefined, budget = 0) => (usd === undefined ? '' : spendText(usd, k.hasCost, k.limits.length > 0, budget))

// What the strip shows now: the inputs of strip(), from this session's values.
async function stripNow($: any, now: number) {
  const p = await load($)
  const today = p.days[dayKey(now)] ?? emptyDay()
  const list = await alerts($, p, today)
  const budget = p.budgetUsd && k.hasCost ? p.budgetUsd : 0
  const meta = statusText(p.name, today, k.hasCost, budget || undefined, k.limits.length > 0)
  const t = k.lastTask
  const show = k.blades.secrets ? mask : (x: string) => x
  const noteOf = (n: Note, isSent: boolean) => ({ goal: show(oneLine(n.goal, 70)), at: n.at, isStale: !isSent && k.isNoteStale, isSent })
  return strip({
    now, meta, alerts: list,
    waiting: k.waiting,
    working: k.isWorking ? { action: k.action || 'Thinking', since: k.turnStartAt || now } : null,
    isAsleep: k.mood === 'asleep',
    done: t && t.summary ? { at: t.at, took: [fmtDuration(t.ms), spendOf(t.usd)].filter(Boolean).join(' · '), summary: show(firstSentence(t.summary, 140)) } : null,
    next: k.blades.next && k.nextStep ? oneLine(k.nextStep, 48) : '',
    note: k.note ? noteOf(k.note, false) : k.noteSent ? noteOf(k.noteSent, true) : null,
    isHandedOff: k.isHandedOff && k.handoff.status === 'ready',
  })
}

function stripAction($: any, key: string, surface: string) {
  if (key === 'fresh-chat') return void startHandoff($)
  if (key === 'next') return void takeNext($, surface)
  if (key === 'note-continue') return void continueNote($)
  if (key === 'note-drop') return void discardHandoff($)
}

// The strip above the prompt: the mascot, one status line, the one alert that wins, one action.
async function stripView($: any, e: any, rest: unknown) {
  const { Box, Text, Button, Svg, isTerm } = kit($, e)
  const now = await $.clock.now()
  const s = await stripNow($, now)
  const head = (
    <Text wrap="truncate-end">
      {s.glyph ? <Text color={s.glyphColor}>{`${s.glyph} `}</Text> : ''}
      <Text bold color={s.titleColor}>{s.title}</Text>
      {s.meta ? <Text dimColor>{` · ${s.meta}`}</Text> : ''}
    </Text>
  )
  const side = isTerm ? null : (
    <Box flexDirection="row" gap="sm" alignItems="center">
      <Button key="show-panel" label="Panel" variant="secondary" onPress={() => showPane($, 'knife')} />
      <Button key={k.isBandFolded ? 'unfold-band' : 'fold-band'} label={k.isBandFolded ? '▴' : '▾'} variant="secondary" onPress={() => foldBand($)} />
    </Box>
  )
  if (k.isBandFolded) {
    k.band = null
    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="row" gap="sm" alignItems="center" paddingX="sm">
          {Svg && k.blades.mascot ? <Svg key="strip-mascot" source={svgFrameAt(k.mood, now - k.moodAt).svg} alt={`Mascot: ${moodWords(k.mood)}`} width={26} height={24} /> : null}
          <Box flexGrow={1} flexShrink={1}>{head}</Box>
          {side}
        </Box>
      </Box>
    )
  }
  let picture: unknown = null
  if (k.blades.mascot && isTerm && e.props.maxRows >= ROWS + 2 && e.props.bodyColumns >= COLUMNS + 30) {
    const { Raster } = $.ui.resolve(e)
    const { index, frame } = frameAt(k.mood, now - k.moodAt)
    k.band = { requestId: e.requestId, drawn: `${k.mood}:${index}` }
    picture = <Raster key="mascot" columns={COLUMNS} rows={ROWS} cells={cellsFor(k.mood, index, frame)} />
  } else if (k.blades.mascot && Svg) {
    k.band = null
    k.appDrawnAt = now
    picture = <Svg key="strip-mascot" source={svgFrameAt(k.mood, now - k.moodAt).svg} alt={`Mascot: ${moodWords(k.mood)}`} width={50} height={46} />
  } else k.band = null
  const isTip = s.detailGlyph === 'Tip'
  return (
    <Box flexDirection="column">
      {rest}
      <Box flexDirection="row" gap="md" alignItems="center" paddingX="sm" paddingY="xs"
        borderStyle={isTerm ? undefined : 'round'} borderColor={isTerm ? undefined : s.isUrgent ? RED : 'promptBorder'}>
        {picture}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {head}
          {s.detail ? (
            <Text wrap="wrap">
              {s.detailGlyph ? <Text bold color={s.detailColor}>{`${s.detailGlyph} `}</Text> : ''}
              <Text color={isTip ? undefined : s.detailColor}>{isTip ? s.detail.replace(/ Switch in the model menu\..*$/, '') : s.detail}</Text>
            </Text>
          ) : null}
          {s.actions.length > 0 ? (
            <Box flexDirection="row" gap="sm" marginTop="xs">
              {s.actions.map(a => <Button key={`strip-${a.key}`} label={a.label} variant={a.isPrimary ? 'primary' : 'secondary'} onPress={(press: any) => stripAction($, a.key, press.surface)} />)}
            </Box>
          ) : null}
        </Box>
        {side}
      </Box>
    </Box>
  )
}

// The tab row at the top of the panel.
function tabRow($: any, e: any) {
  const { Box, Text, Button, Rule } = kit($, e)
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" gap="md" paddingX="sm">
        {TABS.map(t => (
          <Button key={`tab-${t.id}`} label={t.label} plain onPress={() => setTab($, t.id)}>
            <Text bold={t.id === k.tab} color={t.id === k.tab ? ACCENT : undefined} dimColor={t.id !== k.tab}>{t.label}</Text>
          </Button>
        ))}
      </Box>
      <Rule />
    </Box>
  )
}

// A row with the name on the left and the value on the right.
const pairRow = (Box: any, Text: any, key: string, name: string, value: string, dim = false) => (
  <Box key={key} flexDirection="row" justifyContent="space-between" gap="sm">
    <Text dimColor={dim}>{name}</Text>
    <Text dimColor={dim} tabular>{value}</Text>
  </Box>
)

// The Swiss Knife tab: who is working on what, what needs you, the last task, today, the limits, the files.
async function knifeView($: any, e: any) {
  const { Box, Text, Button, Svg, Bar } = kit($, e)
  const now = await $.clock.now()
  const p = await load($)
  const today = p.days[dayKey(now)] ?? emptyDay()
  const week = sumDays(p, dayKey(now - 6 * 86400000))
  const hasPlan = k.limits.length > 0
  const budget = p.budgetUsd && k.hasCost ? p.budgetUsd : 0
  const list = await alerts($, p, today)
  const s = await stripNow($, now)
  const model = label(k.model || 'model')
  const show = k.blades.secrets ? mask : (x: string) => x
  const status = k.waiting
    ? { glyph: '●', color: RED, title: 'Claude needs you', sub: `Waiting ${clock(now - k.waiting.since)} · ${model}` }
    : k.isWorking ? { glyph: '●', color: ACCENT, title: k.action || 'Thinking', sub: `${model} · ${clock(now - (k.turnStartAt || now))}` }
    : { glyph: s.title === 'Done' ? '✓' : '', color: GREEN, title: s.title === 'Done' ? 'Done' : k.mood === 'asleep' ? 'On a break' : 'Ready', sub: model }
  // Each part of the panel is a card of its own, so the eye finds it before reading; alerts take their colour on the border.
  const section = (key: string, body: unknown, border = 'promptBorder') => (
    <Box key={key} flexDirection="column" gap="xs" borderStyle="round" borderColor={border} paddingX="md" paddingY="sm">{body}</Box>
  )
  const mute = () => setSound($, { isOn: !k.sound.isOn, ...(k.sound.volume === 0 ? { volume: 0.5 } : {}) })
  const louder = () => setSound($, { volume: step(k.sound.volume, 0.1), isOn: true })
  const level = k.sound.isOn ? `${Math.round(k.sound.volume * 100)}%` : 'off'
  const toggleSound = () => { k.isSoundOpen = !k.isSoundOpen; $.ui.invalidate('ui.render') }
  // The sound stays out of the way: one "Sound 60%" button opens the volume row.
  const volumeRow = (
    <Box key="volume" flexDirection="row" gap="sm" alignItems="center" borderStyle="round" borderColor="promptBorder" paddingX="md" paddingY="xs">
      <Box flexGrow={1}><Text dimColor>Volume</Text></Box>
      <Button key="quieter" label="−" variant="secondary" onPress={() => quieter($)} />
      {Svg ? <Svg key="volume-bars" source={volumeBarsSvg(k.sound.volume, k.sound.isOn)} alt={`Volume ${level}`} width={97} height={14} /> : <Text dimColor tabular>{level}</Text>}
      <Button key="louder" label="+" variant="secondary" onPress={louder} />
      <Button key="mute" label={k.sound.isOn ? 'Mute' : 'Unmute'} variant="secondary" onPress={mute} />
    </Box>
  )
  const out: unknown[] = []
  // Header: the mascot, the project and what is happening; the model and the sound on the right.
  out.push(
    <Box key="head" flexDirection="column" gap="sm">
      <Box flexDirection="row" gap="md" alignItems="center">
        {Svg && k.blades.mascot ? <Svg key="panel-mascot" source={svgFrameAt(k.mood, now - k.moodAt).svg} alt={`Mascot: ${moodWords(k.mood)}`} width={88} height={80} /> : null}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text bold>{p.name}</Text>
          <Text wrap="truncate-end">{status.glyph ? <Text color={status.color}>{`${status.glyph} `}</Text> : <Text color={GREEN}>● </Text>}<Text bold={!!k.waiting} color={k.waiting ? RED : undefined}>{status.title}</Text></Text>
          {status.sub !== model ? <Text dimColor>{status.sub.replace(` · ${model}`, '').replace(`${model} · `, '')}</Text> : null}
        </Box>
        <Box flexDirection="column" alignItems="flex-end" gap="xs">
          <Box borderStyle="round" borderColor="promptBorder" paddingX="xs"><Text size="footnote" dimColor>{model}</Text></Box>
          <Button key="sound" label={`Sound ${level}`} variant={k.isSoundOpen ? 'primary' : 'secondary'} onPress={toggleSound} />
        </Box>
      </Box>
      {k.isSoundOpen ? volumeRow : null}
    </Box>,
  )
  list.slice(0, 4).forEach((a, i) => {
    const glyph = a.kind === 'waiting' ? '● Claude needs you' : a.kind === 'tip' ? 'Tip' : a.kind === 'note' ? '→' : a.level === 'urgent' ? '! Over the limit' : '! Heads up'
    const color = a.level === 'urgent' ? RED : a.kind === 'tip' || a.kind === 'note' ? ACCENT : AMBER
    out.push(section(`alert-${i}`, [
      <Text key={`alert-${i}-head`} bold color={color}>{glyph}</Text>,
      <Text key={`alert-${i}-text`} wrap="wrap">{a.text}</Text>,
    ], color))
  })
  if (k.lastTask) {
    const t = k.lastTask
    const age = now - k.reportAt
    const steps = (t.report ?? []).slice(0, 5).map(x => reportLine(show(x)))
    const rows: unknown[] = [
      <Box key="task-head" flexDirection="row" justifyContent="space-between" gap="sm">
        <Text><Text bold color={GREEN}>✓ </Text><Text bold>Last task</Text></Text>
        <Text dimColor tabular>{[fmtDuration(t.ms), spendOf(t.usd)].filter(Boolean).join(' · ')}</Text>
      </Box>,
      <Text key="task-sum" wrap="wrap">{show(t.summary)}</Text>,
    ]
    steps.forEach((r, i) => {
      if (age <= (i + 1) * 250) return // the steps fade in one by one
      rows.push(r.isTodo
        ? <Box key={`task-${i}`} borderStyle="round" borderColor={AMBER} paddingX="sm"><Text wrap="wrap"><Text bold color={AMBER}>{`! ${r.lead} `}</Text>{r.text}</Text></Box>
        : <Text key={`task-${i}`} wrap="wrap"><Text color={GREEN}>✓ </Text>{r.text}</Text>)
    })
    if (t.files.length === 0) rows.push(<Text key="task-files" dimColor>No files changed</Text>)
    else {
      const many = t.files.length > 1
      rows.push(many
        ? <Button key="task-files" label="Changed files" plain onPress={() => toggleTask($)}>
            <Text dimColor>{k.isTaskOpen ? `▾ Changed ${t.files.length} files` : `▸ Changed ${t.files[0]} and ${t.files.length - 1} more`}</Text>
          </Button>
        : <Text key="task-files" dimColor wrap="truncate-middle">{`Changed ${t.files[0]}`}</Text>)
      if (many && k.isTaskOpen) t.files.forEach(f => rows.push(<Text key={`task-file-${f}`} dimColor wrap="truncate-middle">{`   ${f}`}</Text>))
    }
    out.push(section('task', rows))
  }
  // Today: the two numbers big, the budget as a pixel bar.
  const big = (key: string, value: string, sub: string) => (
    <Box key={key} flexDirection="column" width="50%">
      <Text size="title" bold tabular>{value}</Text>
      <Text dimColor wrap="wrap">{sub}</Text>
    </Box>
  )
  const todayRows: unknown[] = [
    <Text key="today-head" bold>Today</Text>,
    <Box key="today-big" flexDirection="row" gap="md">
      {big('today-time', fmtTime(today.ms), 'time worked')}
      {k.hasCost ? big('today-cost', `$${today.usd.toFixed(2)}`, budget ? `of ${money(budget)} budget` : hasPlan ? 'worth, at API prices' : 'spent') : null}
    </Box>,
  ]
  if (budget) todayRows.push(<Bar key="today-bar" f={today.usd / budget} label={`Budget: ${Math.round((today.usd / budget) * 100)}% used`} />)
  if (p.budgetPct) {
    todayRows.push(pairRow(Box, Text, 'today-share', 'Share of weekly limit', `${fmtPct(week.weekPct ?? 0)} of ${p.budgetPct}%`))
    todayRows.push(<Bar key="share-bar" f={(week.weekPct ?? 0) / p.budgetPct} label="Weekly share" />)
  }
  todayRows.push(<Text key="today-week" dimColor>{[`This week ${fmtTime(week.ms)}`, k.hasCost ? spendOf(week.usd) : ''].filter(Boolean).join(' · ')}</Text>)
  out.push(section('today', todayRows))
  const five = current(windowOf(k.limits, FIVE_HOUR), now), weekly = current(windowOf(k.limits, WEEKLY), now)
  if (five || weekly) {
    const fc = forecast(now)
    const limitRows = (key: string, name: string, w: Window, note: string) => [
      <Box key={`${key}-row`} flexDirection="row" justifyContent="space-between" alignItems="flex-end" gap="sm">
        <Text>{name}</Text>
        <Text size="heading" bold tabular>{`${Math.round(w.percentUsed)}%`}</Text>
      </Box>,
      <Bar key={`${key}-bar`} f={w.percentUsed / 100} label={`${name}: ${Math.round(w.percentUsed)}% used`} />,
      <Text key={`${key}-note`} dimColor wrap="wrap">{note}</Text>,
    ]
    const resets = (w: Window) => (fmtReset(w, now) ? `Resets ${fmtReset(w, now)}.` : '')
    out.push(section('limits', [
      <Text key="limits-head" bold>Plan limits</Text>,
      ...(five ? limitRows('five', '5-hour limit', five, [fc || (five.percentUsed < 50 ? 'Plenty left.' : ''), resets(five)].filter(Boolean).join(' ')) : []),
      ...(weekly ? limitRows('week', 'Weekly limit', weekly, [weekly.percentUsed < 50 ? 'Plenty left.' : '', resets(weekly)].filter(Boolean).join(' ')) : []),
    ]))
  }
  if (k.contextPercent >= 50) out.push(section('chat', [
    pairRow(Box, Text, 'chat-row', 'This chat', `${k.contextPercent}% full`),
    <Bar key="chat-bar" f={k.contextPercent / 100} label={`This chat is ${k.contextPercent}% full`} />,
  ]))
  if (k.changed.length) out.push(section('files', [
    <Box key="files-head" flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
      <Button key="files-more" label="Files changed in this chat" plain onPress={() => toggleFiles($)}>
        <Text>{`${k.isFilesOpen ? '▾' : '▸'} Files changed in this chat`}</Text>
      </Button>
      <Text dimColor tabular>{String(k.changed.length)}</Text>
    </Box>,
    ...(k.isFilesOpen ? k.changed.slice(0, 60).map(f => <Text key={`file-${f}`} wrap="truncate-middle">{`   ${f}`}</Text>) : []),
  ]))
  const isReady = k.handoff.status === 'ready'
  out.push(
    <Box key="fresh" flexDirection="column">
      <Button key="open-fresh" label={isReady ? 'See your handoff' : 'Continue in a new chat'} variant={isFreshTime(now) && !isReady ? 'primary' : 'secondary'}
        onPress={() => (isReady || k.handoff.status === 'writing' ? showHandoff($) : void startHandoff($))} />
    </Box>,
  )
  return out
}

// The Handoff tab: what a handoff is, the mascot writing it, then the document for a new chat.
async function handoffView($: any, e: any) {
  const { Box, Text, Button, Svg } = kit($, e)
  const now = await $.clock.now()
  const ho = k.handoff
  const show = k.blades.secrets ? mask : (x: string) => x
  const mascot = (mood: Mood, elapsed: number) => (Svg ? <Svg key="handoff-mascot" source={svgFrameAt(mood, elapsed).svg} alt="The mascot" width={88} height={80} /> : null)
  if (ho.status === 'writing') {
    const elapsed = now - ho.startedAt
    return [
      mascot('writing', elapsed),
      <Text key="ho-title"><Text color={ACCENT}>● </Text><Text bold>{ho.level === 'full' ? 'Writing the detailed handoff' : 'Writing your handoff'}</Text></Text>,
      <Text key="ho-sub" dimColor tabular>{`Reading ${ho.messages ?? 0} messages · ${Math.floor(elapsed / 1000)} s`}</Text>,
      Svg ? <Svg key="ho-bar" source={segmentsSvg(elapsed)} alt="Writing" height={8} /> : <Text key="ho-bar" color={ACCENT}>{segmentsText(elapsed)}</Text>,
      <Text key="ho-note" dimColor wrap="wrap">{ho.level === 'full' ? 'This reads every decision, file and dead end, so it takes a minute or two. You can keep working.' : "You can keep working. We'll tell you when it's ready."}</Text>,
    ]
  }
  if (ho.status === 'ready' && ho.note) return handoffReady($, e, now)
  if (ho.status === 'failed') return [
    mascot('error', now - k.moodAt),
    <Text key="ho-fail"><Text bold color={AMBER}>! </Text><Text bold>Couldn't write the handoff</Text></Text>,
    <Text key="ho-fail-note" dimColor wrap="wrap">Nothing was lost. Try again in a moment.</Text>,
    <Box key="ho-retry-row" flexDirection="row"><Button key="ho-retry" label="Try again" variant="primary" onPress={() => void startHandoff($, ho.level)} /></Box>,
  ]
  return [
    mascot('idle', now - k.moodAt),
    <Text key="ho-idle" bold>Continue in a new chat</Text>,
    <Text key="ho-idle-why" wrap="wrap">Long chats get slow and forgetful. A handoff is a short note that brings a new chat up to speed: the goal, where it stands and what's next.</Text>,
    k.contextPercent > 0 ? <Text key="ho-idle-full" dimColor>{`This chat is ${k.contextPercent}% full.`}</Text> : null,
    <Box key="ho-start-row" flexDirection="column"><Button key="ho-start" label="Write a handoff" variant="primary" onPress={() => void startHandoff($)} /></Box>,
    <Text key="ho-cost" dimColor wrap="wrap">About 20 seconds. Costs a fraction of a cent.</Text>,
  ]
}

// A row that folds open: a name, a short summary on the right, and an arrow.
function foldRow($: any, e: any, key: string, name: string, summary: string, isOpen: boolean, press: () => void, summaryColor?: string) {
  const { Box, Text, Button } = kit($, e)
  return (
    <Box key={`fold-${key}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
      <Box flexShrink={0}><Text bold={isOpen}>{name}</Text></Box>
      <Box flexDirection="row" gap="sm" alignItems="center" flexShrink={1} justifyContent="flex-end">
        <Box flexShrink={1}><Text dimColor={!summaryColor} color={summaryColor} wrap="truncate-end">{summary}</Text></Box>
        <Button key={`fold-${key}-btn`} label={isOpen ? '▾' : '▸'} variant="secondary" onPress={press} />
      </Box>
    </Box>
  )
}

const card = (Box: any, key: string, body: unknown, border = 'promptBorder') => (
  <Box key={key} flexDirection="column" gap="sm" borderStyle="round" borderColor={border} paddingX="md" paddingY="sm">{body}</Box>
)

function openOnly($: any, field: 'hoOpen' | 'settingsOpen' | 'expanded', id: string) {
  k[field] = k[field] === id ? '' : id
  $.ui.invalidate('ui.render')
}

// The Handoff tab, ready: what to do first, then the goal and the next step, the rest folded with counts.
function handoffReady($: any, e: any, now: number) {
  const { Box, Text, Button, Svg } = kit($, e)
  const ho = k.handoff
  const note = ho.note!
  const show = k.blades.secrets ? mask : (x: string) => x
  const sections = docSections(show(note.body ?? notePaste(note)))
  const goal = sections.find(x => /^goal$/i.test(x.name))
  const steps = sections.find(x => /^next steps?$/i.test(x.name))
  const rest = sections.filter(x => x !== goal && x !== steps && x.items.length > 0)
  const num = (n: string) => <Text bold color={GREEN}>{`${n}.`}</Text>
  const out: unknown[] = [
    card(Box, 'ho-ready', [
      <Box key="ho-ready-head" flexDirection="row" gap="md" alignItems="center">
        {Svg ? <Svg key="handoff-mascot" source={svgFrameAt('done', now - ho.startedAt).svg} alt="The mascot, done" width={56} height={51} /> : null}
        <Box flexDirection="column">
          <Text><Text bold color={GREEN}>✓ </Text><Text bold>Ready for a new chat</Text></Text>
          <Text dimColor>{`Written ${when(note.at, now)}${ho.file ? ' · saved in your project' : ''}`}</Text>
        </Box>
      </Box>,
      <Box key="ho-step-1" flexDirection="row" gap="sm" alignItems="center">{num('1')}<Text wrap="wrap">Open a new chat in this project.</Text></Box>,
      <Box key="ho-step-2" flexDirection="row" gap="sm" alignItems="center">{num('2')}<Text wrap="wrap">Type anything. Claude reads the handoff first.</Text></Box>,
      <Box key="ho-buttons" flexDirection="row" gap="sm">
        {e.surface !== 'terminal' ? <Button key="ho-copy" label="Copy" variant="primary" onPress={(press: any) => copyHandoff($, press.surface)} /> : null}
        {ho.level !== 'full' ? <Button key="ho-more" label="More details" variant="secondary" onPress={() => void startHandoff($, 'full')} /> : null}
        <Button key="ho-discard" label="Discard" variant="secondary" onPress={() => discardHandoff($)} />
      </Box>,
    ], GREEN),
  ]
  const doc: unknown[] = []
  if (goal?.items.length) doc.push(
    <Box key="ho-goal" flexDirection="column">
      <Text color={ACCENT}>Goal</Text>
      <Text bold wrap="wrap">{goal.items.map(i => i.text).join(' ')}</Text>
    </Box>)
  if (steps?.items.length) doc.push(
    <Box key="ho-next" flexDirection="column" borderStyle="round" borderColor={AMBER} paddingX="sm">
      <Text color={AMBER}>Next step</Text>
      <Text wrap="wrap">{steps.items[0]!.text}</Text>
      {steps.items.length > 1 ? <Text dimColor wrap="wrap">{`Then: ${steps.items.slice(1, 4).map(i => i.text).join(' · ')}`}</Text> : null}
    </Box>)
  for (const sec of rest) {
    const isOpen = k.hoOpen === sec.name
    const isFiles = /^files/i.test(sec.name)
    doc.push(foldRow($, e, `ho-${sec.name}`, sec.name.replace(/^Files changed$/i, 'Files'), sectionSummary(sec.name, sec.items), isOpen, () => openOnly($, 'hoOpen', sec.name)))
    if (!isOpen) continue
    const items = [...sec.items].sort((a, b) => (a.mark === 'open' ? 0 : 1) - (b.mark === 'open' ? 0 : 1))
    items.forEach((it, i) => doc.push(isFiles && fileItem(it.text).isFile
      ? <Box key={`ho-${sec.name}-${i}`} flexDirection="row" justifyContent="space-between" gap="sm">
          <Text bold wrap="truncate-middle">{fileItem(it.text).name}</Text>
          <Text dimColor wrap="wrap">{fileItem(it.text).what}</Text>
        </Box>
      : <Text key={`ho-${sec.name}-${i}`} wrap="wrap" dimColor={it.mark === 'done'}>
          {it.mark ? <Text color={it.mark === 'done' ? GREEN : AMBER}>{it.mark === 'done' ? '✓  ' : '○  '}</Text> : '–  '}{it.text}
        </Text>))
  }
  out.push(card(Box, 'ho-doc', doc))
  return out
}

// The Pins tab: one line per pin, one open at a time.
async function pinsList($: any, e: any) {
  const { Box, Text, Button, Svg } = kit($, e)
  const pins = await loadPins($)
  const now = await $.clock.now()
  const show = k.blades.secrets ? mask : (x: string) => x
  if (pins.length === 0) return [
    <Box key="pins-none" flexDirection="column" alignItems="center" gap="sm" borderStyle="dashed" borderColor="promptBorder" paddingX="md" paddingY="md">
      {Svg ? <Svg key="pins-mascot" source={svgFrameAt('idle', now - k.moodAt).svg} alt="The mascot" width={66} height={60} /> : null}
      <Text bold>Nothing pinned yet</Text>
      <Text dimColor wrap="wrap">Click Pin under any reply to keep it here. Plans you approve are pinned for you.</Text>
    </Box>,
  ]
  const rows: unknown[] = []
  pins.forEach((pin, n) => {
    const isPlan = pin.title.startsWith('Plan:')
    const kind = isPlan ? 'Plan · pinned for you' : pin.requestId ? 'Reply' : 'Your note'
    const isOpen = k.expanded === pin.id
    const canJump = e.surface === 'terminal' && !!pin.requestId && pin.sessionId === k.sessionId
    const text = cleanPin(show(pin.text))
    const title = isPlan ? cleanPin(show(pin.title.replace(/^Plan:\s*/, ''))) : titleOf(text) // cleaned first, then cut
    if (n > 0) rows.push(<Box key={`pin-gap-${pin.id}`} height={1} />)
    rows.push(
      <Box key={`pin-${pin.id}`} flexDirection="row" gap="sm" alignItems="center">
        <Text color={isPlan ? ACCENT : undefined} dimColor={!isPlan}>■</Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text bold={isOpen} wrap="truncate-end">{title}</Text>
          <Text dimColor>{`${kind} · ${when(pin.at, now)}`}</Text>
        </Box>
        <Button key={`pin-open-${pin.id}`} label={isOpen ? '▾' : '▸'} variant="secondary" onPress={() => openOnly($, 'expanded', pin.id)} />
      </Box>,
    )
    if (!isOpen) return
    rows.push(
      <Box key={`pin-body-${pin.id}`} flexDirection="column" gap="xs" paddingLeft="md">
        {text.split('\n').filter(l => l.trim()).slice(0, 40).map((l, i) => <Text key={`pin-${pin.id}-l${i}`} wrap="wrap">{l}</Text>)}
        <Box flexDirection="row" gap="sm">
          {canJump ? <Button key={`go-${pin.id}`} label="Go to message" variant="secondary" onPress={() => jumpTo($, pin)} /> : null}
          {e.surface !== 'terminal' ? <Button key={`copy-${pin.id}`} label="Copy" variant="secondary" onPress={(press: any) => copyPin($, pin, press.surface)} /> : null}
          <Button key={`unpin-${pin.id}`} label="Remove" variant="secondary" onPress={() => unpin($, pin.id)} />
        </Box>
      </Box>,
    )
  })
  return [card(Box, 'pins-list', rows), <Text key="pins-hint" dimColor wrap="wrap">Click Pin under any reply to keep it here.</Text>]
}

// The Settings tab, short: the four things people change as tiles, the rest folded by group.
async function settingsShort($: any, e: any) {
  const { Box, Text, Button } = kit($, e)
  const p = await load($)
  const tile = (key: string, label: string, value: string, controls: unknown, isOff = false) => (
    <Box key={`tile-${key}`} flexDirection="column" gap="xs" width="50%" borderStyle="round" borderColor="promptBorder" paddingX="md" paddingY="sm">
      <Text dimColor>{label}</Text>
      <Text size="title" bold tabular dimColor={isOff}>{value}</Text>
      <Box flexDirection="row" gap="sm">{controls}</Box>
    </Box>
  )
  const steps = (key: string, down: () => void, up: () => void) => [
    <Button key={`${key}-down`} label="−" variant="secondary" onPress={down} />,
    <Button key={`${key}-up`} label="+" variant="secondary" onPress={up} />,
  ]
  const tiles = [
    k.hasCost ? tile('usd', 'Daily budget', p.budgetUsd ? money(p.budgetUsd) : 'Off', steps('usd', () => stepBudget($, 'usd', -1), () => stepBudget($, 'usd', 1)), !p.budgetUsd) : null,
    tile('handoff', 'New chat at', `${k.handoffAt}% full`, steps('handoff', () => setHandoffAt($, k.handoffAt - 5), () => setHandoffAt($, k.handoffAt + 5))),
    tile('sound', 'Sound', k.sound.isOn ? `${Math.round(k.sound.volume * 100)}%` : 'Off', [
      ...steps('vol', () => quieter($), () => setSound($, { volume: step(k.sound.volume, 0.1), isOn: true })),
      <Button key="mute" label={k.sound.isOn ? 'Mute' : 'Unmute'} variant="secondary" onPress={() => setSound($, { isOn: !k.sound.isOn, ...(k.sound.volume === 0 ? { volume: 0.5 } : {}) })} />,
    ], !k.sound.isOn),
    k.limits.length ? tile('pct', 'Weekly share', p.budgetPct ? `${p.budgetPct}%` : 'Off', steps('pct', () => stepBudget($, 'pct', -5), () => stepBudget($, 'pct', 5)), !p.budgetPct) : null,
  ].filter(Boolean)
  const grid: unknown[] = []
  for (let i = 0; i < tiles.length; i += 2) grid.push(<Box key={`tiles-${i}`} flexDirection="row" gap="sm">{tiles.slice(i, i + 2)}</Box>)
  // A blade: a lamp that shows on or off at a glance, its name and line, and an On/Off button.
  const blade = (b: typeof BLADES[number]) => {
    const isOn = k.blades[b.key]
    return (
      <Box key={`row-${b.key}`} flexDirection="row" gap="sm" alignItems="center">
        <Text color={isOn ? GREEN : undefined} dimColor={!isOn}>{isOn ? '■' : '□'}</Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text dimColor={!isOn}>{b.name}</Text>
          <Text dimColor wrap="wrap">{b.about}</Text>
        </Box>
        <Button key={`toggle-${b.key}`} label={isOn ? 'On' : 'Off'} variant="secondary" dimColor={!isOn} onPress={() => toggleBlade($, b.key)} />
      </Box>
    )
  }
  const groups: { id: string; name: string; group: Group }[] = [
    { id: 'look', name: 'Mascot and strip', group: 'Mascot and sound' },
    { id: 'help', name: 'Help along the way', group: 'Help along the way' },
    { id: 'safety', name: 'Safety', group: 'Safety' },
  ]
  const list: unknown[] = []
  groups.forEach((g, i) => {
    const members = BLADES.filter(b => b.group === g.group)
    const on = members.filter(b => k.blades[b.key]).length
    const isOpen = k.settingsOpen === g.id
    if (i > 0) list.push(<Box key={`set-gap-${g.id}`} height={1} />)
    list.push(foldRow($, e, `set-${g.id}`, g.name, on === members.length ? 'All on' : `${on} of ${members.length} on`, isOpen, () => openOnly($, 'settingsOpen', g.id), on === members.length ? GREEN : undefined))
    if (isOpen) members.forEach(b => list.push(blade(b)))
  })
  const demos: [string, string][] = [['cache', 'Quick memory'], ['handoff', 'Handoff'], ['limits', 'Limits'], ['needs-you', 'Needs you'], ['budget', 'Budget'], ['recap', 'Recap']]
  const isDemoOpen = k.settingsOpen === 'demo'
  list.push(<Box key="set-gap-demo" height={1} />)
  list.push(foldRow($, e, 'set-demo', 'Try a feature', `${demos.length} demos`, isDemoOpen, () => openOnly($, 'settingsOpen', 'demo')))
  if (isDemoOpen) list.push(
    <Box key="demo-buttons" flexDirection="row" gap="sm" flexWrap="wrap">
      {demos.map(([id, name]) => <Button key={`demo-${id}`} label={name} variant="secondary" onPress={async () => $.ui.toast(await demo($, id))} />)}
    </Box>)
  return [
    ...grid,
    card(Box, 'set-groups', list),
    card(Box, 'set-off', [
      <Box key="set-off-row" flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
        <Box flexDirection="column" flexShrink={1}>
          <Text>{k.blades.all ? 'Turn Swiss Knife off' : 'Swiss Knife is off'}</Text>
          <Text dimColor wrap="wrap">{k.blades.all ? 'Hides everything and stops tracking' : 'Nothing is shown or tracked'}</Text>
        </Box>
        <Button key="toggle-all" label={k.blades.all ? 'Turn off' : 'Turn on'} variant="secondary" onPress={() => setAll($)} />
      </Box>,
    ], RED),
  ]
}

// The panel: the tab row, then the open tab.
async function paneView($: any, e: any, only?: Tab) {
  const { Box, Text } = kit($, e)
  if (!k.blades.all && (only ?? k.tab) !== 'settings') return <Box paddingX="md" paddingY="sm"><Text dimColor>Swiss Knife is off. Turn it on in Settings, or type /knife on</Text></Box>
  const tab = only ?? k.tab
  const body = tab === 'handoff' ? await handoffView($, e) : tab === 'pins' ? await pinsList($, e) : tab === 'settings' ? await settingsShort($, e) : await knifeView($, e)
  return (
    <Box flexDirection="column" gap="sm">
      {only ? <Text dimColor wrap="wrap">This tab now lives inside the Swiss Knife tab. You can close this one.</Text> : tabRow($, e)}
      <Box flexDirection="column" gap="md" paddingX="md" paddingBottom="md">{body}</Box>
    </Box>
  )
}

// Under each reply: what it used, and Pin.
async function replyChip($: any, e: any, drawn: unknown) {
  const { Box, Button, Text } = kit($, e)
  const id = e.requestId
  const isPinned = (await loadPins($)).some(x => x.id === id)
  const stat = k.replyUsage[replyKey(e.props.text)]
  const used = stat ? usageParts(stat) : []
  return (
    <Box key={`reply-${id}`} flexDirection="column">
      {drawn}
      <Box flexDirection="row" alignItems="center" gap="sm">
        {used.length > 0 ? (
          <Text>
            <Text dimColor>This reply  </Text>
            {used.join(' · ')}
          </Text>
        ) : null}
        {isPinned ? <Text color={ACCENT} bold>📌 Pinned</Text> : null}
        <Button key={`pin-${id}`} label={isPinned ? 'Unpin' : '📌 Pin'} variant="secondary" onPress={() => pinMessage($, id, e.props.text)} />
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const res = await next(e)
    k.cwd = await $.session.cwd()
    k.sessionId = await $.session.id()
    const now = await $.clock.now()
    k.moodAt = now
    k.blades = { ...k.blades, ...((await $.store.get('blades')) as Partial<Blades> | undefined) }
    k.sound = { ...DEFAULT_SOUND, ...((await $.store.get('sound')) as Partial<Sound> | undefined) }
    k.isBandFolded = ((await $.store.get('bandFolded')) as boolean | undefined) ?? false
    k.handoffAt = ((await $.store.get('handoffAt')) as number | undefined) ?? HANDOFF_AT
    k.cacheTtl = parseTtl(await $.settings.read({ key: 'promptCacheTtl' }).catch(() => undefined)) // the cache timer's clock
    const usage = await $.session.usage()
    k.hasCost = typeof usage.cost?.usd === 'number'
    k.lastUsd = usage.cost?.usd
    takeLimits($, usage.rateLimits as Window[], now)
    if (k.limits.length === 0) k.limits = ((await $.store.get('limits')) as Window[] | undefined) ?? [] // until Claude Code reports fresh ones
    k.lastWeekPct = (usage.rateLimits as Window[]).length ? windowOf(k.limits, WEEKLY)?.percentUsed : undefined
    k.lastFivePct = (usage.rateLimits as Window[]).length ? windowOf(k.limits, FIVE_HOUR)?.percentUsed : undefined
    k.replyUsage = ((await $.store.get(usageKey())) as Record<string, ReplyUsage> | undefined) ?? {}
    const saved = (await $.store.get(taskKey())) as { lastTask: typeof k.lastTask; changed: string[] } | undefined
    if (saved) { k.lastTask = saved.lastTask; k.changed = saved.changed ?? [] }
    if ((await $.session.messages()).length > 0) k.isFirstPrompt = false // a resumed session was coached already
    else { // a new chat, /clear included: nothing of the last chat carries over but the handoff note
      k.isFirstPrompt = true
      k.lastReplyAt = 0; k.contextPercent = 0; k.contextTokens = 0; k.hasWarnedHandoff = false
      if (!saved) k.changed = []
      await restoreModel($) // a session that crashed after a switch left the default changed
    }
    for (const c of [
      { name: 'report', description: 'Plain-English summary of this project: /report or /report week' },
      { name: 'handoff', description: 'Save where you are, then continue in a fresh session for less' },
      { name: 'pin', description: "Pin Claude's last reply, or your own text: /pin | /pin <text> | /pin off (removes all)" },
      { name: 'pins', description: 'Open the Pins tab' },
      { name: 'budget', description: "Today's spending limit for this project: /budget 5 | /budget off" },
      { name: 'knife', description: 'Swiss Knife settings: /knife show | off | on | sound | volume | handoff <percent> | secrets on | mascot/coach/guard/ping/cache/next off' },
    ]) await $.command.register(c).catch(() => undefined) // a name Claude Code already has is refused: carry on
    const p = await load($)
    const hasNote = !k.isFirstPrompt ? false : await takeNote($, now) // a resumed chat leaves the note for a new one
    if (!k.isFirstPrompt && k.handoff.status === 'idle') { // after a restart the Handoff tab shows the one this chat wrote
      const written = (await $.store.get(noteKey())) as Note | undefined
      if (written?.body) k.handoff = { status: 'ready', level: written.level ?? 'standard', startedAt: 0, note: written, file: noteFile(written) }
    }
    if (!hasNote && p.last && !saved?.lastTask) say($, `Last time, ${ago(now - p.last.at)}: ${oneLine(p.last.did || p.last.asked, 160)}`)
    k.model = await $.session.model()
    await track($)
    startTicker($)
    if (k.blades.all) void openTabs($)
    return res
  })

  on('session.end', async ($, e, next) => {
    await restoreModel($)
    // /clear goes on in this process with no session.start: start the new chat here.
    if (e.reason === 'clear') { await startOver($); return next(e) }
    k.timer?.cancel(); k.timer = null
    return next(e)
  })

  // Claude Code's own "Claude needs you" moments: permission prompts and the like (not the idle reminder).
  on('classic.Notification', async ($, e, next) => {
    const type = String((e as any).notification_type ?? '')
    if (!/idle/i.test(type)) await needsYou($, oneLine(String((e as any).message ?? 'Claude needs your OK'), 120))
    return next(e)
  })

  // The mascot always names the model the app runs. A switch the person makes is theirs to keep:
  // the coach's effort and the "put the default back" both step aside.
  // The plan's limits, as Claude Code measures them.
  on('session.measure', async ($, e, next) => {
    const res = await next(e)
    takeLimits($, (e as any).rateLimits, await $.clock.now())
    return res
  })

  // The mascot names the model each request of the main chat really goes to.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.model && e.model !== k.model) { k.model = e.model; $.ui.invalidate('ui.render') }
    return yield* next(e)
  })

  on('turn.start', async ($, e, next) => {
    startTicker($)
    if (!(e as any).agentId) {
      k.turnStartAt = await $.clock.now(); k.turnTools = 0; k.turnFiles = []
      k.lastFivePct ??= windowOf(k.limits, FIVE_HOUR)?.percentUsed
      k.lastWeekPct ??= windowOf(k.limits, WEEKLY)?.percentUsed
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const kind = (e as any).origin?.kind
    const isPerson = !kind || kind === 'composer' || kind === 'sdk' || kind === 'bridge'
    if (e.command || !isPerson || !k.blades.all) return next(e)
    await answered($)
    await track($, d => { d.prompts.push(oneLine(e.text, 200)) })
    k.isWorking = true
    k.action = 'Thinking'
    k.isHandedOff = false
    if (k.message) say($, '')
    if (k.nextStep) { k.nextStep = ''; $.ui.invalidate('ui.render') }
    await setMood($, 'thinking')
    if (k.isFirstPrompt) {
      k.isFirstPrompt = false
      if (k.note) { // a new session after a handoff: Claude reads the document with this first message
        const note = k.note, isStale = k.isNoteStale
        k.note = null
        await $.store.delete(noteKey())
        if (!isStale) { // an old one not taken up is dropped
          // The desktop app starts the session with the first message, so this is the first moment to say so.
          k.noteSent = note
          return next({ ...e, context: [...(e.context ?? []), noteContext(note)] })
        }
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // a problem in the mod never blocks your message

  // Guard: even where a rule or mode would allow it, a destructive command goes to the person.
  on('tool.check', async ($, e, next) => {
    const res = await next(e)
    if (!k.blades.all || !k.blades.guard || !SHELL_TOOLS.has(e.tool) || res.decision === 'deny') return res
    const reason = guardReason(String((e.input as any)?.command ?? ''))
    if (!reason) return res
    return { decision: 'ask', reason }
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (!k.blades.all) return next(e)
    const command = String((e as any).command ?? '')
    await track($)
    k.turnTools++
    // Questions and plan approvals wait for the person: ping them, and keep the plan in sight.
    const isQuestion = e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode'
    if (e.tool === 'ExitPlanMode' && typeof (e as any).plan === 'string') {
      const plan = makePin((e as any).plan, `Plan: ${titleOf((e as any).plan)}`, await $.clock.now())
      await savePins($, [plan, ...(await loadPins($))])
    }
    if (isQuestion) await needsYou($, e.tool === 'ExitPlanMode' ? 'Approve the plan to go on.' : 'Claude has a question for you.')
    else await setMood($, moodForTool(e.tool, command))
    k.action = actionText(e.tool, e as any)
    const res = await next(e)
    if (isQuestion) await answered($)
    if ((res as any).isError) await setMood($, 'error')
    else if (EDIT_TOOLS.has(e.tool)) {
      const file = String((e as any).file_path ?? (e as any).notebook_path ?? '')
      if (file) {
        const rel = relPath(k.cwd, file)
        k.changed = addChanged(k.changed, rel)
        void saveTask($)
        k.turnFiles = addChanged(k.turnFiles, rel)
        $.ui.invalidate('ui.render')
      }
    }
    return res
  }).catch(($, e, next) => next(e)) // the Guard decides at tool.check; a problem here never blocks a tool

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    if (!k.blades.all || (e as any).agentId) return res
    k.isWorking = false
    k.noteSent = null
    await answered($)
    const usage = await $.session.usage()
    const usd = usage.cost?.usd
    if (typeof usd === 'number') k.hasCost = true
    const u = e.usage
    // A stopped turn has no reply of its own: the last one in the chat belongs to an earlier task.
    const reply = e.isAborted ? undefined : [...(await $.session.messages())].reverse().find(m => m.role === 'assistant' && m.text.trim())
    const did = reply ? oneLine(reply.text, 200) : ''
    const now = await $.clock.now()
    let asked = ''
    const turnUsd = typeof usd === 'number' ? Math.max(0, usd - (k.lastUsd ?? usd)) : undefined
    await track($, (d, p) => {
      asked = d.prompts.at(-1) ?? ''
      if (typeof usd === 'number') d.usd += Math.max(0, usd - (k.lastUsd ?? usd))
      if (u) d.tokens += u.input_tokens + u.output_tokens + u.cache_creation_input_tokens
      if (did) d.done.push(did)
      p.last = { at: now, asked: d.prompts.at(-1) ?? '', did }
    })
    k.lastUsd = usd
    k.contextPercent = usage.context.percent ?? 0
    k.contextTokens = usage.context.tokens ?? 0
    k.lastReplyAt = now
    takeLimits($, usage.rateLimits as Window[], now)
    const weekNow = windowOf(k.limits, WEEKLY)?.percentUsed
    const used = usageDelta(k.lastWeekPct, weekNow)
    k.lastWeekPct = weekNow
    if (used > 0) await track($, d => { d.weekPct = (d.weekPct ?? 0) + used })
    // This answer's own cost, shown under it
    const fiveNow = windowOf(k.limits, FIVE_HOUR)?.percentUsed
    if (reply) {
      const r: ReplyUsage = {
        usd: turnUsd,
        five: k.lastFivePct !== undefined && fiveNow !== undefined ? usageDelta(k.lastFivePct, fiveNow) : undefined,
        week: k.lastWeekPct !== undefined && weekNow !== undefined ? used : undefined,
      }
      k.replyUsage[replyKey(reply.text)] = r
      const keys = Object.keys(k.replyUsage)
      if (keys.length > 300) delete k.replyUsage[keys[0]]
      await $.store.set(usageKey(), k.replyUsage)
    }
    k.lastFivePct = fiveNow
    if (shouldWarn(usage.context.percent, k.hasWarnedHandoff, k.handoffAt)) {
      k.hasWarnedHandoff = true
      $.ui.toast(warnText(usage.context.percent!))
    }
    // Only a finished answer is celebrated: a stopped or failed turn is not.
    const isDone = !e.isAborted && e.reason !== 'error'
    if (!isDone) await setMood($, e.reason === 'error' ? 'error' : restMood())
    else if (k.mood !== 'gag-tokens') await setMood($, 'done')
    if (isDone && k.turnStartAt && now - k.turnStartAt >= MIN_TASK_MS) void chime($, 'done')
    // The "Last task" report: the reply's first sentence now, Haiku's plain-English recap when it was real work.
    const took = k.turnStartAt ? now - k.turnStartAt : 0
    k.lastTask = { at: now, ms: took, usd: turnUsd, asked, summary: reply ? firstSentence(reply.text) : e.isAborted ? 'You stopped this task before Claude finished.' : '', files: [...k.turnFiles] }
    await saveTask($)
    k.isTaskOpen = false
    k.reportAt = now
    $.ui.invalidate('ui.render')
    if (k.blades.coach && !e.isAborted) void coachAfter($)
    if (did && (k.turnTools > 0 || took >= MIN_TASK_MS)) void recap($, asked, oneLine(reply!.text, 3000), took >= HARD_TASK_MS || k.turnTools >= HARD_TASK_TOOLS)
    return res
  })

  on('command.run', { command: 'knife' }, async ($, e) => {
    const [a = '', b = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (a === 'sound' && (b === 'on' || b === 'off')) {
      await setSound($, { isOn: b === 'on' })
      return { text: `Sound ${soundLabel(k.sound)}` }
    }
    if (a === 'volume') {
      const v = parseVolume(b)
      if (v === null) return { text: 'Use a number from 0 to 100, like /knife volume 40' }
      await setSound($, { volume: v, isOn: v > 0 })
      return { text: `Sound ${soundLabel(k.sound)}` }
    }
    if (a === 'handoff') {
      const t = parseThreshold(b)
      if (t === null) return { text: 'Use a percent from 20 to 95, like /knife handoff 50' }
      k.handoffAt = t
      k.hasWarnedHandoff = false
      await $.store.set('handoffAt', t)
      $.ui.invalidate('ui.render')
      return { text: `Handoff reminder at ${t}% of the chat.` }
    }
    if (a === 'settings') {
      await showSettings($)
      return { text: 'Settings tab open.' }
    }
    if (a === 'demo') return { text: await demo($, b) }
    if (a === 'show') {
      const opened = await $.ui.open({ id: PANE, title: 'Swiss Knife' })
      return { text: opened.isPlaced ? 'Swiss Knife panel is open.' : 'The panel will show when there is room for it.' }
    }
    if (a === 'off' || a === 'on') k.blades.all = a === 'on'
    else if ((a === 'mascot' || a === 'coach' || a === 'guard' || a === 'ping' || a === 'cache' || a === 'next' || a === 'secrets') && (b === 'off' || b === 'on')) k.blades[a] = b === 'on'
    await $.store.set('blades', k.blades)
    if (!k.blades.all) $.ui.status(undefined)
    else { k.lastActivity = undefined; await track($) }
    $.ui.invalidate('ui.render')
    const mark = (x: boolean) => (x ? 'on' : 'off')
    return {
      text:
        `Swiss Knife is ${mark(k.blades.all)}. Mascot ${mark(k.blades.mascot)}, model coach ${mark(k.blades.coach)}, guard ${mark(k.blades.guard)}, ` +
        `"needs you" alerts ${mark(k.blades.ping)}, cache timer ${mark(k.blades.cache)}, next-step suggestion ${mark(k.blades.next)}, ` +
        `hide secrets ${mark(k.blades.secrets)}, sound ${soundLabel(k.sound)}, handoff reminder at ${k.handoffAt}%.\n` +
        'Commands: /report [week], /handoff, /pin, /pins, /budget <dollars|off>, /knife <show | off | on | sound on/off | volume 0-100 | handoff <percent> | secrets on/off | mascot/coach/guard/ping/cache/next off>',
    }
  }).catch(() => ({ text: 'Swiss Knife: /knife hit a problem. Try again in a moment.' }))

  on('command.run', { command: 'pin' }, async ($, e) => {
    const arg = e.args.trim()
    if (/^(off|clear|none)$/i.test(arg)) {
      await savePins($, [])
      return { text: 'All pins removed.' }
    }
    const now = await $.clock.now()
    let pin: Pin
    if (arg) pin = makePin(arg, titleOf(arg), now)
    else {
      const reply = [...(await $.session.messages())].reverse().find(m => m.role === 'assistant' && m.text.trim())
      if (!reply) return { text: 'Nothing to pin yet. Pin text with /pin <text>, or hover over a reply and click 📌.' }
      pin = makePin(reply.text, titleOf(reply.text), now)
    }
    await savePins($, [pin, ...(await loadPins($))].slice(0, 30))
    await showPins($)
    return { text: `Pinned "${pin.title}". It's in the Pins tab. /pin off removes all pins.` }
  }).catch(() => ({ text: 'Swiss Knife: /pin hit a problem. Try again in a moment.' }))

  on('command.run', { command: 'pins' }, async $ => {
    await showPins($)
    return { text: 'Pins tab open.' }
  }).catch(() => ({ text: 'Swiss Knife: /pins hit a problem. Try again in a moment.' }))

  on('command.run', { command: 'budget' }, async ($, e) => {
    const p = await load($)
    const value = parseBudget(e.args)
    if (!e.args.trim()) {
      const parts = [p.budgetUsd && `${money(p.budgetUsd)} a day (API value)`, p.budgetPct && `${p.budgetPct}% of your weekly limit a week`].filter(Boolean)
      return { text: parts.length ? `${p.name}: ${parts.join(' and ')}.` : `${p.name} has no budget. Try /budget 20% (a share of your weekly limit) or /budget 5 (dollars a day).` }
    }
    if (value === null) return { text: 'Use /budget 20% (a share of your weekly limit), /budget 5 (dollars a day), or /budget off.' }
    if (value === 'off') { delete p.budgetUsd; delete p.budgetPct }
    else if (value.kind === 'pct') {
      if (k.limits.length === 0) return { text: 'Claude Code reports no plan limits here (pay-per-use?), so use a dollar budget: /budget 5' }
      p.budgetPct = value.value; delete p.pctWarned
    } else {
      if (!k.hasCost) return { text: 'Claude Code does not report costs here, so use a share of your limit: /budget 20%' }
      p.budgetUsd = value.value; delete p.budgetWarned
    }
    await $.store.set(projectKey(), p)
    await track($)
    if (value === 'off') return { text: `Budgets off for ${p.name}.` }
    return { text: value.kind === 'pct'
      ? `${p.name} may use ${value.value}% of your weekly limit a week. Warnings at 80% and 100% of that share.`
      : `${p.name}: warning at 80% and 100% of ${money(value.value)} a day (what the work would cost on the API).` }
  }).catch(() => ({ text: 'Swiss Knife: /budget hit a problem. Try again in a moment.' }))

  on('command.run', { command: 'report' }, async ($, e) => {
    const isWeek = /week/i.test(e.args)
    const now = await $.clock.now()
    const p = await load($)
    const d = sumDays(p, dayKey(isWeek ? now - 6 * 86400000 : now))
    const period = isWeek ? 'the last 7 days' : 'today'
    if (!d.prompts.length) return { text: `${p.name}, ${period}\nNothing tracked yet.` }
    const r = await $.model.complete({ model: 'haiku', system: REPORT_SYSTEM, prompt: reportPrompt(p.name, period, d) })
    const lines = r.isAnswered ? r.text.trim() : '• (The summary could not be written right now.)'
    return { text: `${p.name}, ${period}\n${lines}\nTime: ${fmtTime(d.ms)}   Cost: ${fmtSpend(d, k.hasCost)}` }
  }).catch(() => ({ text: 'Swiss Knife: /report hit a problem. Try again in a moment.' }))

  // Answers at once: the desktop app gives up on a command that waits for the note to be written.
  on('command.run', { command: 'handoff' }, async ($, e) => {
    if ((await $.session.messages()).length < 2) return { text: 'Nothing to hand off yet.' }
    void startHandoff($, 'standard', e.args)
    return { text: 'Writing your handoff in the Handoff tab…' }
  }).catch(() => ({ text: 'Swiss Knife: /handoff hit a problem. Try again in a moment.' }))

  // The panel: one app tab with its own tabs. The old separate tabs, should the app bring one back, show theirs.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => paneView($, e))
  on('ui.render', { component: 'Pane', requestId: HANDOFF_PANE }, async ($, e) => paneView($, e, 'handoff'))
  on('ui.render', { component: 'Pane', requestId: PINS_PANE }, async ($, e) => paneView($, e, 'pins'))
  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => paneView($, e, 'settings'))

  // The strip above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (!k.blades.all || !k.blades.strip || e.props.hasSurvey) { k.band = null; return rest }
    return stripView($, e, rest)
  })

  // Under each reply from Claude: what it used, and Pin.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(k.blades.all && k.blades.secrets ? ({ ...e, props: scrub(e.props) } as typeof e) : e)
    if (!k.blades.all || e.surface === 'terminal' || e.props.isSummary || !e.props.text.trim()) return drawn
    return replyChip($, e, drawn)
  })

  // Hide secrets while recording: keys, tokens, passwords and emails masked on screen; Claude still reads the real text.
  for (const component of MASKED.filter(c => c !== 'AssistantMessage')) {
    on('ui.render', { component }, async ($, e, next) =>
      k.blades.all && k.blades.secrets ? next({ ...e, props: scrub(e.props) } as typeof e) : next(e))
  }

  // Paste or type a key, a password or an email: the prompt box paints it as a grey bar before you send.
  // Only the screen changes; Claude still gets the real text.
  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    if (!k.blades.all || !k.blades.secrets) return r
    const ranges = secretRanges(r.text)
    if (ranges.length === 0) return r
    const paint = ranges.flatMap(([start, end]) => [
      { start, end: start, virtualText: '🔒', dimColor: true },
      { start, end, color: '#3A3833', backgroundColor: '#3A3833' },
    ])
    return { ...r, decorations: [...(r.decorations ?? []), ...paint] }
  }).catch(($, e, next) => next(e))

  // The Swiss Knife tab can't be closed: the app draws an X on every tab, so the mod refuses the close,
  // and reopens the tab right away should the app close it anyway. Pins and Settings close normally.
  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE || !k.blades.all || (e as any).origin?.kind === 'unload') return next(e)
    $.clock.after(250, () => { void showPane($).catch(() => undefined) })
  }).catch(($, e, next) => next(e))
}
