import { test, expect } from 'claude-code/testing'
import {
  workedMs, fmtTime, fmtSpend, statusText, projectName, sumDays, reportPrompt, budgetWarning, parseBudget, isWork, ago, IDLE_MS,
  type Project,
} from './meter'
import { sizeByRules, sizeOf, advise, sameVersion, isCoachable, label, coachLine } from './coach'
import { danger } from './guard'
import { shouldWarn, parseNote, noteContext, conversationText, parseDoc, sectionOf, noteFile, loadingBar, handoffSystem, notePaste } from './handoff'
import { moodForTool, frameAt, svgFrameAt, playLength, toCells, toBase64, COLUMNS, ROWS } from './mascot'
import { FRAMES } from './frames'
import { ANIM } from './svgs'

// ── Meter ──
test('counts working time but not breaks', () => {
  expect(workedMs(undefined, 1000)).toBe(0)
  expect(workedMs(0, 5 * 60000)).toBe(5 * 60000)
  expect(workedMs(0, IDLE_MS + 1)).toBe(0)
})

test('formats the meter line, with a budget when there is one', () => {
  const d = { ms: 42 * 60000, usd: 0.31, tokens: 0, prompts: [], done: [] }
  expect(fmtTime(72 * 60000)).toBe('1h 12m')
  expect(fmtSpend({ usd: 0, tokens: 186_400 }, false)).toBe('186k tokens')
  expect(statusText('bakery-site', d, true)).toBe('bakery-site · 0h 42m today · $0.31')
  expect(statusText('bakery-site', d, true, 5)).toBe('bakery-site · 0h 42m today · $0.31 of $5')
  expect(projectName('D:\\work\\bakery-site')).toBe('bakery-site')
  expect(projectName('/Users/sam/travel-blog/')).toBe('travel-blog')
})

test('the report reads what was asked and what Claude said it did', () => {
  const p: Project = { name: 'bakery-site', days: {
    '2026-10-20': { ms: 60000, usd: 0.1, tokens: 10, prompts: ['fix the typo'], done: ['There was no typo; the heading is spelled correctly.'] },
    '2026-10-01': { ms: 999999, usd: 9, tokens: 9, prompts: ['old work'], done: ['old'] },
  } }
  const w = sumDays(p, '2026-10-16')
  expect(w.ms).toBe(60000)
  const text = reportPrompt(p.name, 'this week', w)
  expect(text).toContain('- fix the typo')
  expect(text).toContain('no typo')
  expect(text).not.toContain('old work')
  expect(isWork('/report')).toBe(false)
  expect(isWork('C:/Program Files/Git/report')).toBe(false)
})

// ── Budget ──
test('budget warns once at 80% and once at 100% each day', () => {
  const p: Project = { name: 'bakery-site', days: {}, budgetUsd: 5 }
  expect(budgetWarning(p, '2026-10-23', 1)).toBe(null)
  expect(budgetWarning(p, '2026-10-23', 4.1)).toContain('80%')
  expect(budgetWarning(p, '2026-10-23', 4.5)).toBe(null)
  expect(budgetWarning(p, '2026-10-23', 5.2)).toContain('Over today')
  expect(budgetWarning(p, '2026-10-23', 6)).toBe(null)
  expect(budgetWarning(p, '2026-10-24', 4.2)).toContain('80%') // a new day warns again
  expect(parseBudget('5')).toEqual({ kind: 'usd', value: 5 })
  expect(parseBudget('$2.50')).toEqual({ kind: 'usd', value: 2.5 })
  expect(parseBudget('20%')).toEqual({ kind: 'pct', value: 20 })
  expect(parseBudget('150%')).toBe(null)
  expect(parseBudget('off')).toBe('off')
  expect(parseBudget('lots')).toBe(null)
})

// ── Model coach ──
test('coach sizes the task and suggests the right model, both ways', () => {
  expect(sizeByRules('fix the typo in the first heading')).toBe('small')
  expect(sizeByRules('Build a booking website with a calendar and email confirmations')).toBe('big')
  expect(sizeByRules('Can you look at why the newsletter signup sometimes shows an error on mobile?')).toBe('unsure') // Haiku decides
  expect(advise('small')).toMatchObject({ family: 'haiku', effort: 'low' })
  expect(advise('medium')).toMatchObject({ family: 'sonnet', effort: 'medium' })
  expect(advise('big')).toMatchObject({ family: 'opus', effort: 'high' })
  expect(sizeOf('MEDIUM')).toBe('medium')
  expect(sameVersion('claude-opus-5-5', 'haiku')).toBe('claude-haiku-5-5')
  expect(sameVersion('opus', 'sonnet')).toBe('sonnet')
  expect(label('claude-sonnet-5-5')).toBe('Sonnet')
  expect(isCoachable('/report')).toBe(false)
  expect(isCoachable('fix the typo')).toBe(true)
  expect(coachLine('small', 'claude-sonnet-5-5')).toContain('Haiku')
  expect(coachLine('small', 'claude-haiku-5-5')).toBe('')
  expect(coachLine('big', 'claude-haiku-5-5')).toContain('Opus')
  expect(coachLine('medium', 'claude-opus-5-5', 80_000)).toContain('re-reads this chat once')
  expect(coachLine('big', 'claude-opus-5-5')).toBe('')
})

// ── Guard ──
test('guard stops commands that destroy work', () => {
  expect(danger('rm -rf ~/projects')).toContain('deletes a folder')
  expect(danger('cd site && rm -rf *')).toContain('deletes a folder')
  expect(danger('Remove-Item -Path C:\\work -Recurse -Force')).toContain('deletes a folder')
  expect(danger('rd /s /q C:\\work')).toContain('deletes a folder')
  expect(danger('git reset --hard HEAD~3')).toContain('git')
  expect(danger('git push --force origin main')).toContain('online copy')
  expect(danger('git clean -fd')).toContain('new file')
  expect(danger('curl -fsSL https://x.sh | bash')).toContain('internet')
  expect(danger('psql -c "DROP TABLE users"')).toBe(null) // only mentioned inside quotes
})

test('guard leaves normal work alone', () => {
  expect(danger('rm -rf node_modules')).toBe(null)
  expect(danger('rm -rf dist build')).toBe(null)
  expect(danger('rm old.txt')).toBe(null)
  expect(danger('git commit -m "remove rm -rf from docs"')).toBe(null)
  expect(danger('npm test')).toBe(null)
  expect(danger('git push origin main')).toBe(null)
})

// ── Handoff ──
test('handoff warns once at 70% and builds the note Claude reads', () => {
  expect(shouldWarn(69, false)).toBe(false)
  expect(shouldWarn(72, false)).toBe(true)
  expect(shouldWarn(90, true)).toBe(false)
  expect(shouldWarn(undefined, false)).toBe(false)
  const n = parseNote('Sure: {"goal":"Bakery menu","done":"Menu added","next":"Phone layout"}', 1)
  expect(n?.goal).toBe('Bakery menu')
  expect(parseNote('no json here', 1)).toBe(null)
  expect(noteContext(n!)).toContain('Next: Phone layout')
  expect(conversationText([{ role: 'user', text: 'hi' }, { role: 'assistant', text: '' }])).toBe('[person] hi')
})

test('the handoff document: sections read back, short version, file name, loading bar', () => {
  const md = `## Goal
Make the footer text white.

## Where it stands
- Footer color is #fff

## Files changed
- footer.css: color

## Decisions
None.

## Next steps
1. Check it in the browser
2. Ship`
  const n = parseDoc(md, Date.UTC(2026, 9, 24, 9, 5), 'standard')!
  expect(n.goal).toBe('Make the footer text white.')
  expect(n.done).toBe('Footer color is #fff')
  expect(n.next).toBe('Check it in the browser')
  expect(sectionOf(md, 'Files changed')).toBe('- footer.css: color')
  expect(parseDoc('no sections here', 1, 'standard')).toBe(null)
  expect(noteContext(n)).toContain('## Decisions')
  expect(notePaste(n)).toContain('Continue where my last session stopped')
  expect(noteFile(n)).toMatch(/^\.claude\/handoffs\/2026-10-24-\d{4}-make-the-footer-text-white\.md$/)
  expect(handoffSystem('full')).toContain('## Tried and did not work')
  expect(handoffSystem('standard')).not.toContain('## Open questions')
  expect(loadingBar(0)).toHaveLength(14)
  expect(loadingBar(0)).not.toBe(loadingBar(600))
})

// ── Mascot ──
test('mascot picks the animation for what Claude is doing', () => {
  expect(moodForTool('Read')).toBe('reading')
  expect(moodForTool('Edit')).toBe('writing')
  expect(moodForTool('WebSearch')).toBe('searching-web')
  expect(moodForTool('Bash', 'npm test')).toBe('testing')
  expect(moodForTool('Bash', 'ls -la')).toBe('running-commands')
  expect(moodForTool('mcp__x__y')).toBe('thinking')
})

test('mascot frames: loops, plays once, and encodes to cells', () => {
  expect(frameAt('idle', 0).index).toBe(0)
  expect(frameAt('idle', playLength('idle') + 1).index).toBe(0) // looped back
  expect(frameAt('done', 10 * playLength('done')).index).toBe(FRAMES['done']!.length - 1) // held on the last frame
  const words = toCells(FRAMES['idle']![0]!.px)
  expect(words.length).toBe(COLUMNS * ROWS * 3)
  expect(toBase64(Uint32Array.of(0x2588, 0xff8800, 0x01000000))).toBe('iCUAAACI/wAAAAAB')
  expect(Object.keys(ANIM).length).toBeGreaterThan(10)
  const all = Object.values(ANIM).flatMap(a => a.frames)
  expect(all.every(f => f.length <= 131072 && !f.includes('<script') && !f.includes('<style') && !f.includes('var('))).toBe(true)
  expect(all.every(f => (f.match(/class="cm-frame /g) ?? []).length <= 1)).toBe(true) // one pose per picture

})

test('ago reads like a person', () => {
  expect(ago(5 * 60000)).toBe('5 min ago')
  expect(ago(3 * 3600000)).toBe('3 h ago')
  expect(ago(50 * 3600000)).toBe('2 days ago')
})

// ── Dashboard ──
import { bar, moodWords } from './dashboard'
test('dashboard bars and words', () => {
  expect(bar(0.5, 8)).toBe('████░░░░')
  expect(bar(2, 4)).toBe('████')
  expect(bar(NaN, 4)).toBe('░░░░')
  expect(moodWords('asleep')).toBe('on a break')
})

test('desktop mascot flips one frame at a time, and done stops on its last frame', () => {
  const first = svgFrameAt('thinking', 0), later = svgFrameAt('thinking', 450)
  expect(first.index).toBe(0)
  expect(later.index).toBeGreaterThan(0)
  const done = ANIM['done']!
  expect(svgFrameAt('done', 60_000).index).toBe(done.seq.length - 1)
})

import { cardSvg, gauge, wrap } from './dashboard'
test('the card fills the panel, draws no dot at 0%, and says when to hand off', () => {
  const c = { mascot: '', mood: 'idle' as const, name: 'bakery', model: 'Opus', todayTime: '0h 00m', todaySpend: '$0.00', weekTime: '0h 00m', weekSpend: '$0.00', contextPercent: 0, handoffAt: 70 }
  const empty = cardSvg(c)
  expect(empty).toContain('width="100%"')
  expect(empty).toContain('hand off at 70%')
  expect(gauge(0, 0, 0, '0%', 'Chat', '')).not.toContain('#8DBF8B') // no coloured arc at 0
  const full = cardSvg({ ...c, contextPercent: 75, alerts: [{ tone: 'warn', text: 'This chat is 75% full. /handoff now to save tokens.' }] })
  expect(full).toContain('hand off now')
  expect(full).toContain('/handoff now to')
  expect(full).not.toMatch(/TODAY|THIS WEEK/) // sentence case, no shouting labels
  expect(cardSvg({ ...c, limits: { five: { percent: 41, reset: '16:40' } } })).toContain('resets 16:40')
  expect(wrap('one two three four five six', 9, 2)).toEqual(['one two', 'three…'])
})

import { addSample, runsOutAt, limitWarning, fmtReset, windowOf } from './limits'
test('plan limits: pace forecast, resets and one warning per level', () => {
  const t0 = Date.parse('2026-10-23T14:00:00Z')
  const reset = new Date(t0 + 3 * 3600_000).toISOString()
  let s = addSample([], { at: t0, percent: 40 })
  s = addSample(s, { at: t0 + 30 * 60_000, percent: 55 })
  const w = { kind: 'five_hour', percentUsed: 55, resetsAt: reset }
  expect(runsOutAt(s, w)).toBe(t0 + 30 * 60_000 + 90 * 60_000) // 15% per half hour: 45% left = 90 min
  expect(runsOutAt(s, { ...w, resetsAt: new Date(t0 + 60 * 60_000).toISOString() })).toBe(null) // resets first
  expect(addSample(s, { at: t0 + 40 * 60_000, percent: 2 })).toEqual([{ at: t0 + 40 * 60_000, percent: 2 }]) // a drop is a new window: the pace starts over
  const shown = {}
  expect(limitWarning({ ...w, percentUsed: 81 }, shown)).toContain('81%')
  expect(limitWarning({ ...w, percentUsed: 85 }, shown)).toBe(null)
  expect(limitWarning({ ...w, percentUsed: 96 }, shown)).toContain('96%')
  expect(fmtReset(undefined, t0)).toBe('')
  expect(windowOf([w], 'five_hour')).toEqual(w)
})

import { makePin, relPath, addChanged, plain, titleOf, togglePin } from './pin'
import { parseThreshold, noteMarkdown } from './handoff'
test('pin, changed files and handoff settings', () => {
  expect(plain('## Plan\n- **Add** the form\n- Test it')).toBe('Plan\n• Add the form\n• Test it')
  expect(makePin('x'.repeat(2000), 'the plan', 1).text.length).toBe(1500)
  expect(relPath('D:\\work\\bakery', 'D:\\work\\bakery\\css\\menu.css')).toBe('css/menu.css')
  expect(relPath('/home/sam/blog', '/etc/hosts')).toBe('etc/hosts')
  expect(addChanged(['a', 'b'], 'b')).toEqual(['b', 'a'])
  expect(titleOf('## Contact form plan\n- add fields')).toBe('Contact form plan')
  const a = makePin('Hello', 'Hello', 1, { requestId: 'r1', sessionId: 's1' })
  expect(a.id).toBe('r1')
  expect(togglePin([], a)).toEqual([a])
  expect(togglePin([a], a)).toEqual([]) // the same button unpins
  expect(parseThreshold('50')).toBe(50)
  expect(parseThreshold('5')).toBe(null)
  expect(noteMarkdown({ at: 0, goal: 'Menu', done: 'Form', next: 'Test' }, 'bakery')).toContain('**Next:** Test')
})

import { fmtDuration, firstSentence } from './meter'
test('the last-task report: durations, first sentences and the card block', () => {
  expect(fmtDuration(45_000)).toBe('45s')
  expect(fmtDuration(134_000)).toBe('2m 14s')
  expect(fmtDuration(3_900_000)).toBe('1h 05m')
  expect(firstSentence('**Done.** I added the form. Then more.')).toBe('Done.')
  const svg = cardSvg({ mascot: '', mood: 'done', name: 'bakery', model: 'Opus', todayTime: '0h 05m', todaySpend: '$0.40', weekTime: '0h 05m', weekSpend: '$0.40', contextPercent: 10, handoffAt: 70,
    lastTask: { took: '2m 14s, $0.12', asked: 'add a contact form', summary: 'Added a contact form under the address.', files: ['index.html'] } })
  expect(svg).toContain('Last task')
  expect(svg).toContain('2m 14s, $0.12')
  expect(svg).toContain('Files changed (1)')
  expect(svg).not.toContain('Pinned')
})

import { cardParts } from './dashboard'
test('last task report: shown in full, files listed, a new report fades in', () => {
  const base = { mascot: '', mood: 'done' as const, name: 'bakery', model: 'Opus', todayTime: '0h 05m', todaySpend: '$0.40', weekTime: '0h 05m', weekSpend: '$0.40', contextPercent: 10, handoffAt: 70 }
  const long = 'Restyled the contact form into a clean white card with softer edges and spacing. I checked how it looks on both desktop and phone screens, and the button now matches the menu.'
  const full = cardParts({ ...base, lastTask: { took: '45s', asked: 'make it nicer', summary: long, report: ['Left to check: the phone menu.'], files: ['index.html', 'css/form.css'] } }).whole
  expect(full).toContain('the menu.')
  expect(full).toContain('Left to check')
  expect(full).toContain('Files changed (2)')
  expect(full).toContain('css/form.css')
  expect(cardParts({ ...base, lastTask: { took: '5s', asked: 'hi', summary: 'Hello.', files: [] } }).whole).toContain('No files changed')
  expect(cardParts({ ...base, lastTask: { took: '5s', asked: 'hi', summary: 'Hello.', files: [], age: 0 } }).whole).toContain('opacity="0.00"')
  expect(cardParts({ ...base, lastTask: { took: '5s', asked: 'hi', summary: 'Hello.', files: [], age: 5000 } }).whole).not.toContain('<g opacity=')
})

import { mask, scrub, parseRecap } from './secrets'
import { cacheTtlMs, cacheState, cacheText, parseTtl } from './cache'
test('hide secrets: keys, tokens, passwords and emails are masked, ids kept', () => {
  expect(mask('key sk-ant-abcdefghijklmnopqrstuv here')).not.toContain('abcdefghijklmnop')
  expect(mask('APIFY_TOKEN=apify_api_AAAAAAAAAAAAAAAAAAAAAAAA')).not.toContain('AAAAAAAAAAAA')
  expect(mask('"password": "hunter2secret"')).not.toContain('hunter2secret')
  expect(mask('mail me at sam@example.com')).not.toContain('sam@example.com')
  expect(mask('nothing secret here')).toBe('nothing secret here')
  const fakeStripe = ['sk', 'live', '51Nx7aB2eY1RzLMpQ9f8gH6jK4mN2pQ5rT7vW9xZ0a'].join('_') // built here so secret scanners don't flag a fake key
  expect(mask(`my key is ${fakeStripe}`)).not.toContain('51Nx7aB2eY1R')
  const fakeEleven = ['sk', '0123456789abcdef'.repeat(3)].join('_')
  expect(mask(`key ${fakeEleven}`)).not.toContain('0123456789abcdef')
  expect(mask(`api_${'a1b2c3d4'.repeat(5)}`)).not.toContain('a1b2c3d4a1b2c3d4')
  expect(mask('token Xk9fQ2mLp8Rt4Wz7Bv3Nc6Hd1Js5Gy0Ae end')).not.toContain('Xk9fQ2mLp8Rt4Wz7')
  expect(mask('commit 3f9a2c1b7e8d4f6a0b5c9e2d1a7f3b8c4e6d0a9f')).toBe('commit 3f9a2c1b7e8d4f6a0b5c9e2d1a7f3b8c4e6d0a9f')
  expect(mask('see src/components/FooterSection.tsx')).toBe('see src/components/FooterSection.tsx')
  const s = scrub({ tool_use_id: 'toolu_sam@example.com', text: 'sam@example.com' }) as any
  expect(s.tool_use_id).toBe('toolu_sam@example.com')
  expect(s.text).not.toContain('sam@example.com')
})

test('cache timer: quiet early, a countdown near the end, a warning after', () => {
  const ttl = cacheTtlMs(true)
  expect(ttl).toBe(3_600_000)
  expect(cacheTtlMs(false)).toBe(300_000)
  expect(cacheTtlMs(false, parseTtl('1h'))).toBe(3_600_000) // an API user who set promptCacheTtl
  expect([parseTtl('5m'), parseTtl('300'), parseTtl(undefined), parseTtl('soon')]).toEqual([300_000, 300_000, null, null])
  expect(cacheState(1000, 1000 + 10 * 60_000, ttl, 50_000)).toBe(null) // 50 min left: quiet
  const near = cacheState(1000, 1000 + 55 * 60_000, ttl, 50_000)!
  expect(cacheText(near, 50_000)).toContain('ends in 5 min')
  const gone = cacheState(1000, 1000 + 61 * 60_000, ttl, 50_000)!
  expect(gone.isExpired).toBe(true)
  expect(cacheText(gone, 50_000)).toContain('ran out')
  expect(cacheText(gone, 50_000, true)).toContain('uses more of your limits')
  expect(cacheText(gone, 50_000)).toContain('costs more')
  expect(cacheState(1000, 1000 + 61 * 60_000, ttl, 30_000)).toBe(null) // under 50k: a re-read is cheap, no warning
})

test('next step: the recap model gives a recap and a suggestion', () => {
  expect(parseRecap('RECAP: Added the form.\nNEXT: make the form send emails')).toEqual({ recap: 'Added the form.', next: 'make the form send emails', report: [] })
  expect(parseRecap('RECAP: Added the form.\nNEXT: none\nREPORT:\n- Added a form.\n- Left to check: sending.').report).toEqual(['Added a form.', 'Left to check: sending.'])
  expect(parseRecap('RECAP: Answered a question.\nNEXT: none').next).toBe('')
  expect(parseRecap('Just a sentence.').recap).toBe('Just a sentence.')
})

import { secretRanges } from './secrets'
import { BLADES, DEMOS } from './settings'
test('the prompt box finds pasted secrets to paint over', () => {
  const t = 'my key is sk-ant-abcdefghijklmnopqrstuv and mail sam@example.com'
  const r = secretRanges(t)
  expect(r.length).toBe(2)
  expect(t.slice(r[0]![0], r[0]![1])).toBe('sk-ant-abcdefghijklmnopqrstuv')
  expect(t.slice(r[1]![0], r[1]![1])).toBe('sam@example.com')
  const a = 'API_KEY=supersecret123'
  const [[s0, e0]] = secretRanges(a) as [number, number][]
  expect(a.slice(s0, e0)).toBe('supersecret123')
  expect(secretRanges('fix the typo')).toEqual([])
  expect(BLADES.length).toBe(7)
  expect(Object.keys(DEMOS)).toContain('cache')
})

import { money } from './meter'
test('budget amounts read like money', () => {
  expect(money(5)).toBe('$5')
  expect(money(1.5)).toBe('$1.50')
  expect(statusText('bakery2', { ms: 0, usd: 1.39, tokens: 0, prompts: [], done: [] }, true, 1.5)).toBe('bakery2 · 0h 00m today · $1.39 of $1.50')
})

import { usageDelta, pctWarning, fmtPct } from './meter'
test('usage share: rises count, a reset counts from zero, warnings once a week', () => {
  expect(usageDelta(undefined, 10)).toBe(0)
  expect(usageDelta(10, 13)).toBe(3)
  expect(usageDelta(90, 2)).toBe(2) // the window reset
  expect(fmtPct(0.4)).toBe('<1%')
  const p: Project = { name: 'bakery2', days: {}, budgetPct: 20 }
  expect(pctWarning(p, 'w1', 10)).toBe(null)
  expect(pctWarning(p, 'w1', 17)).toContain('80%')
  expect(pctWarning(p, 'w1', 18)).toBe(null)
  expect(pctWarning(p, 'w1', 21)).toContain('used its 20% share')
  expect(statusText('bakery2', { ms: 0, usd: 1.39, tokens: 0, prompts: [], done: [] }, true, undefined, true)).toBe('bakery2 · 0h 00m today · worth $1.39')
})

import { strip, clock, actionText, spendText, waitingText, docLine, barSvg } from './ui'
import { explain } from './guard'
test('the strip: one status, the alert that wins, one action', () => {
  const base = { now: 100_000, meta: 'bakery2 · 1h 12m today · $3.61', alerts: [] }
  expect(strip(base).folded).toBe('Ready · bakery2 · 1h 12m today · $3.61')
  const wait = strip({ ...base, waiting: { since: 88_000, text: 'It has a question. Answer in the chat.' } })
  expect([wait.title, wait.meta, wait.isUrgent]).toEqual(['Claude needs you', 'waiting 0:12', true])
  const work = strip({ ...base, working: { action: 'Writing index.html', since: 58_000 }, alerts: [{ kind: 'budget', level: 'urgent', text: 'Over today\'s budget: $11.20 of $10.' }] })
  expect([work.title, work.meta, work.detailGlyph]).toEqual(['Writing index.html', '0:42', '!'])
  const full = strip({ ...base, alerts: [{ kind: 'chat-full', level: 'warn', text: 'This chat is 72% full.' }] })
  expect(full.actions[0]).toEqual({ key: 'fresh-chat', label: 'Continue in a new chat', isPrimary: true })
  const done = strip({ ...base, done: { at: 90_000, took: '1m 20s · $0.04', summary: 'Added the footer.' }, next: 'Check it in the browser' })
  expect([done.title, done.detail, done.actions.length]).toEqual(['Done', 'Added the footer.', 0])
  expect(strip({ ...base, done: { at: 0, took: '1s', summary: 'x' }, now: 20 * 60_000 }).title).toBe('Ready') // done fades after 10 min
  const tip = strip({ ...base, alerts: [{ kind: 'tip', level: 'info', text: 'Small edits now.' }] })
  expect([tip.detailGlyph, tip.detail]).toEqual(['Tip', 'Small edits now.'])
  const stale = strip({ ...base, note: { goal: 'Add a footer', at: 0, isStale: true, isSent: false } })
  expect(stale.actions.map(a => a.label)).toEqual(['Continue it', 'Start fresh'])
  expect(strip({ ...base, note: { goal: 'Add a footer', at: 0, isStale: false, isSent: true } }).title).toBe('Continuing:')
  expect(strip({ ...base, isAsleep: true }).title).toBe('On a break')
})

test('small formats read like a person', () => {
  expect(clock(42_000)).toBe('0:42')
  expect(clock(3_723_000)).toBe('1:02:03')
  expect(actionText('Edit', { file_path: 'C:\\site\\index.html' })).toBe('Writing index.html')
  expect(actionText('Bash', { command: 'npm test' })).toBe('Testing')
  expect(spendText(3.61, true, true)).toBe('worth $3.61')
  expect(spendText(3.61, true, false, 10)).toBe('$3.61 of $10')
  expect(spendText(0.004, true, false)).toBe('under 1¢')
  expect(waitingText('Claude needs your permission to use Bash')).toContain('wants your OK')
  expect(docLine('## Goal')).toEqual({ kind: 'heading', text: 'Goal' })
  expect(docLine('- **index.html**: bold')).toEqual({ kind: 'text', text: '– index.html: bold' })
  expect(barSvg(0.96)).toContain('#E0524A')
})

test('guard asks in plain English, naming what goes', () => {
  expect(explain('rm -rf junk')).toBe("Delete the junk folder for good? This skips the Recycle Bin, so you can't get it back. Allow it only if you're sure.")
  expect(explain('cd site && rm -rf *')).toContain('everything in this folder')
  expect(explain('Remove-Item -Path C:\\work\\old -Recurse -Force')).toContain('the old folder')
  expect(explain('rm -rf a b c')).toContain('these 3 folders')
  expect(explain('git reset --hard')).toContain('unsaved changes')
  expect(explain('git push --force origin main')).toContain('online copy')
  expect(explain('rm -rf node_modules')).toBe(null)
})

import { volumeBarsSvg, reportLine } from './ui'
test('the volume bars fill from the bottom in Claude orange, and none when muted', () => {
  const lit = (svg: string) => (svg.match(/fill="#DD775B"/g) ?? []).length
  expect(lit(volumeBarsSvg(0.6, true))).toBe(6)
  expect(reportLine('Left to check: the phone menu.')).toEqual({ isTodo: true, lead: 'Still needed:', text: 'the phone menu.' })
  expect(reportLine('Added a form.').isTodo).toBe(false)
  expect(lit(volumeBarsSvg(1, true))).toBe(10)
  expect(lit(volumeBarsSvg(1, false))).toBe(0)
})
