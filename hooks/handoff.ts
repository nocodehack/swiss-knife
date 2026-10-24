// Handoff: before the conversation gets too long, write a handoff document and carry on in a new session.
// Pure logic.

export const HANDOFF_AT = 70 // default percent of the context window; /knife handoff <percent> changes it

// A note older than this is not attached by itself: the new session asks first.
export const STALE_MS = 3 * 86_400_000

// `standard` is quick (Haiku); `full` is the detailed rewrite (Sonnet) for those who want everything.
export type HandoffLevel = 'standard' | 'full'

// goal, done and next are the short version for the panel and the prompt box; body is the whole document.
export type Note = { at: number; goal: string; done: string; next: string; body?: string; level?: HandoffLevel }

export const shouldWarn = (percent: number | undefined, hasWarned: boolean, at = HANDOFF_AT) =>
  !hasWarned && typeof percent === 'number' && percent >= at

export const warnText = (percent: number) =>
  `This chat is ${percent}% full. A new chat keeps answers sharp.`

const HINTS: Record<string, string> = {
  'Goal': 'one sentence: what you are building, in plain words, no quotes from the chat',
  'Where it stands': 'at most 4 bullets, each starting "[open]" or "[done]"; open ones first',
  'Files changed': 'one bullet per file: the path inside the project (index.html, css/form.css, never a full drive path), a colon, then what changed in it',
  'Decisions': 'one bullet per choice made: the choice, then why, so the next chat does not undo it',
  'Tried and did not work': 'dead ends, so they are not repeated',
  'Your preferences': 'what you asked for, liked or disliked along the way',
  'Running things': 'servers, ports, watchers, and the commands to start them',
  'Open questions': 'what still needs you to decide',
  'Next steps': 'numbered, in order; the first one is one sentence, concrete and ready to do',
}

export const SECTIONS: Record<HandoffLevel, string[]> = {
  standard: ['Goal', 'Where it stands', 'Files changed', 'Decisions', 'Next steps'],
  full: ['Goal', 'Where it stands', 'Files changed', 'Decisions', 'Tried and did not work', 'Your preferences', 'Running things', 'Open questions', 'Next steps'],
}

export const handoffSystem = (level: HandoffLevel) =>
  'Someone is moving their work to a brand-new Claude Code chat that will not see this conversation. ' +
  'Write the handoff document that chat will rely on, in Markdown, with exactly these sections in this order:\n' +
  SECTIONS[level].map(s => `## ${s}\n(${HINTS[s]})`).join('\n') +
  '\nRules: say "you" for the person and "Claude" for the assistant, never "the person", "the user" or "the assistant". ' +
  'Be specific: real names, values and file names inside the project. Leave out shell commands such as rm -rf unless the next chat needs them. ' +
  'Keep every line under 120 characters. Write "None." under a section with nothing in it. ' +
  'No title, no preamble, no closing remarks. ' +
  'Write the content in the language the person writes in, but keep the section headings and the [open]/[done] marks exactly as given, in English. ' +
  (level === 'full' ? 'Be thorough: this document replaces the whole conversation; Where it stands may have more than 4 bullets.' : 'Keep it tight: about 250 words.')

// What the writer reads: the project, the files the mod saw change, and the conversation.
export function handoffInput(messages: { role: string; text: string }[], files: string[], project: string, level: HandoffLevel): string {
  const chat = level === 'full' ? conversationText(messages, 200, 3000) : conversationText(messages, 60, 1200)
  const cap = level === 'full' ? 300_000 : 80_000
  return `Project: ${project}\nFiles changed in this chat: ${files.length ? files.join(', ') : 'none tracked'}\n\nConversation:\n${chat.slice(-cap)}`
}

// The text under one "## Section" heading.
export function sectionOf(md: string, name: string): string {
  const lines = md.split('\n')
  const start = lines.findIndex(l => l.replace(/^#+\s*/, '').trim().toLowerCase() === name.toLowerCase() && /^#{1,3}\s/.test(l))
  if (start < 0) return ''
  const end = lines.findIndex((l, i) => i > start && /^#{1,3}\s/.test(l))
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
}

const firstLine = (s: string) =>
  s.split('\n').map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim()).find(l => l && l !== 'None.') ?? ''

// The writer's Markdown as a note, or null when it is not a handoff document.
export function parseDoc(text: string, at: number, level: HandoffLevel): Note | null {
  const body = text.trim().replace(/^```\w*\n/, '').replace(/\n```$/, '').trim()
  const goal = firstLine(sectionOf(body, 'Goal'))
  if (!goal) return null
  return { at, goal, done: firstLine(sectionOf(body, 'Where it stands')), next: firstLine(sectionOf(body, 'Next steps')), body, level }
}

// The older short note, still read from what earlier versions saved.
export function parseNote(text: string, at: number): Note | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Partial<Note>
    if (typeof j.goal !== 'string' || !j.goal.trim()) return null
    return { at, goal: j.goal.trim(), done: String(j.done ?? '').trim(), next: String(j.next ?? '').trim() }
  } catch {
    return null
  }
}

const DONT_EDIT = '(Files in .claude/handoffs are snapshots Swiss Knife writes only when the person asks for a handoff. Do not edit or update them.)'

// What Claude reads with the first prompt of the new session (the person never sees it twice).
export const noteContext = (n: Note) =>
  n.body
    ? `Handoff document from the previous session in this project. Continue from it:\n\n${n.body}\n\n${DONT_EDIT}`
    : `Handoff note from the previous session in this project:\nGoal: ${n.goal}\nDone: ${n.done}\nNext: ${n.next}\n${DONT_EDIT}`

// What the Copy button puts on the clipboard, to paste into any session.
export const notePaste = (n: Note) => `Continue where my last session stopped. Here is the handoff:\n\n${n.body ?? noteContext(n)}`

export const conversationText = (messages: { role: string; text: string }[], count = 16, chars = 700) =>
  messages
    .filter(m => m.text.trim() !== '')
    .slice(-count)
    .map(m => `[${m.role === 'user' ? 'person' : 'assistant'}] ${m.text.slice(0, chars)}`)
    .join('\n')

// Where the document is kept in the project: out of the way, one file per handoff.
export function noteFile(n: Note): string {
  const d = new Date(n.at)
  const p = (x: number) => String(x).padStart(2, '0')
  const slug = n.goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'handoff'
  return `.claude/handoffs/${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${slug}.md`
}

// The note as a file, so it survives a new laptop, another tool, or a lost session.
export const noteMarkdown = (n: Note, project: string) =>
  `# Handoff: ${project}

_Saved ${new Date(n.at).toLocaleString('en-GB')} by Swiss Knife${n.level === 'full' ? ' (detailed)' : ''}. A snapshot: do not edit it._

${n.body ?? `**Goal:** ${n.goal}\n\n**Done:** ${n.done}\n\n**Next:** ${n.next}`}
`

// The loading bar under the writing mascot: a block sliding along.
export function loadingBar(elapsedMs: number, width = 14): string {
  const pos = Math.floor(elapsedMs / 120) % (width * 2 - 2)
  const at = pos < width ? pos : width * 2 - 2 - pos
  return Array.from({ length: width }, (_, i) => (Math.abs(i - at) <= 1 ? '▰' : '▱')).join('')
}

export function parseThreshold(text: string): number | null {
  const n = Number(text.trim().replace(/%$/, ''))
  return Number.isInteger(n) && n >= 20 && n <= 95 ? n : null
}
