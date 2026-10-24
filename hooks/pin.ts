// Pin and changed files: keep the plan in sight, and show what Claude touched. Pure logic.

// A pin: where it came from (a message drawn in this session can be scrolled back to), a title and the text.
export type Pin = { id: string; at: number; title: string; text: string; requestId?: string; sessionId?: string }

export const PINS_MAX = 30

export const PIN_MAX = 1500

// Markdown to plain lines for the panel: headings, bullets and emphasis marks dropped.
export function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export function makePin(text: string, title: string, at: number, from?: { requestId: string; sessionId: string }): Pin {
  const t = plain(text)
  return { id: from?.requestId ?? `pin-${at}`, at, title, text: t.length > PIN_MAX ? `${t.slice(0, PIN_MAX - 1)}…` : t, ...from }
}

// A title for a pinned message: its first heading or first words.
export function titleOf(text: string): string {
  const first = plain(text).split('\n').find(l => l.trim()) ?? 'Pinned message'
  const t = first.replace(/^•\s*/, '').trim()
  return t.length > 48 ? `${t.slice(0, 47)}…` : t
}

// Adds a pin on top, or takes it off when it is already there (the pin button toggles).
export function togglePin(pins: Pin[], pin: Pin): Pin[] {
  return pins.some(p => p.id === pin.id) ? pins.filter(p => p.id !== pin.id) : [pin, ...pins].slice(0, PINS_MAX)
}

// A changed file as a person reads it: the path inside the project, forward slashes.
export function relPath(cwd: string, file: string): string {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = norm(cwd), f = norm(file)
  return f.toLowerCase().startsWith(base.toLowerCase() + '/') ? f.slice(base.length + 1) : f.split('/').slice(-2).join('/')
}

export const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

export function addChanged(list: string[], file: string): string[] {
  return [file, ...list.filter(f => f !== file)].slice(0, 50)
}

export const changedLine = (list: string[]) =>
  list.length === 0 ? '' : `${list.length} file${list.length === 1 ? '' : 's'} changed`
