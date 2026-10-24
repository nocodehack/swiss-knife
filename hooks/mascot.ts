// Mascot: which animation fits what Claude is doing, and how a frame becomes terminal cells. Pure logic.
import { FRAMES, PALETTE, WIDTH, HEIGHT, type Frame } from './frames'
import { ANIM } from './svgs'

export type Mood =
  | 'greeting' | 'idle' | 'thinking' | 'reading' | 'writing' | 'running-commands' | 'testing'
  | 'searching-web' | 'error' | 'done' | 'asleep' | 'context-nearly-full' | 'waiting-for-you'
  | 'compacting' | 'gag-tokens' | 'gag-dance' | 'asleep-nightcap'

export const COLUMNS = WIDTH
export const ROWS = HEIGHT / 2

// Animations that play once and hold their last frame; the rest loop.
const ONCE = new Set<Mood>(['greeting', 'done'])

// The animation for a tool Claude is about to use.
export function moodForTool(tool: string, command = ''): Mood {
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(tool)) return 'reading'
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) return 'writing'
  if (/^(WebSearch|WebFetch)$/.test(tool)) return 'searching-web'
  if (/^(Bash|PowerShell)$/.test(tool))
    return /\b(test|tests|pytest|jest|vitest|mocha|spec|plugin test|validate|lint|check)\b/i.test(command) ? 'testing' : 'running-commands'
  return 'thinking'
}

// The frame to show `elapsed` ms after the mood started.
export function frameAt(mood: Mood, elapsed: number): { index: number; frame: Frame } {
  const frames = FRAMES[mood] ?? FRAMES['idle']!
  const total = frames.reduce((n, f) => n + f.ms, 0)
  let t = ONCE.has(mood) ? Math.min(elapsed, total - 1) : elapsed % total
  for (let i = 0; i < frames.length; i++) {
    if (t < frames[i]!.ms) return { index: i, frame: frames[i]! }
    t -= frames[i]!.ms
  }
  return { index: frames.length - 1, frame: frames[frames.length - 1]! }
}

// The desktop picture `elapsed` ms after the mood started: the app shows SVG as a still image,
// so the mod flips single-frame pictures itself, with the artist's timings.
export function svgFrameAt(mood: Mood, elapsed: number): { index: number; svg: string } {
  const a = ANIM[mood] ?? ANIM['idle']!
  const total = a.seq.reduce((n, [, ms]) => n + ms, 0)
  let t = ONCE.has(mood) || !a.loop ? Math.min(elapsed, total - 1) : elapsed % total
  for (let i = 0; i < a.seq.length; i++) {
    const [frame, ms] = a.seq[i]!
    if (t < ms) return { index: i, svg: a.frames[frame]! }
    t -= ms
  }
  const [frame] = a.seq[a.seq.length - 1]!
  return { index: a.seq.length - 1, svg: a.frames[frame]! }
}

// How long a play-once animation runs before the mascot settles.
export const playLength = (mood: Mood) => (FRAMES[mood] ?? []).reduce((n, f) => n + f.ms, 0)

const DEFAULT = 0x01000000 // the terminal's own color
const UPPER = 0x2580 // ▀ top half in the foreground color
const LOWER = 0x2584 // ▄ bottom half in the foreground color
const KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const colorOf = (c: string) => (c === '.' ? DEFAULT : PALETTE[KEYS.indexOf(c)] ?? DEFAULT)

// Two pixel rows per terminal row: a half block, top pixel as foreground, bottom as background.
export function toCells(px: string[]): Uint32Array {
  const out = new Uint32Array(COLUMNS * ROWS * 3)
  let o = 0
  for (let r = 0; r < ROWS; r++) {
    const top = px[r * 2]!, bottom = px[r * 2 + 1]!
    for (let c = 0; c < COLUMNS; c++) {
      const t = colorOf(top[c]!), b = colorOf(bottom[c]!)
      if (t === DEFAULT && b === DEFAULT) out.set([0x20, DEFAULT, DEFAULT], o)
      else if (t === DEFAULT) out.set([LOWER, b, DEFAULT], o)
      else out.set([UPPER, t, b], o)
      o += 3
    }
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Standard padded base64 of the cells' little-endian bytes (no btoa in the mod's sandbox).
export function toBase64(words: Uint32Array): string {
  const bytes = new Uint8Array(words.length * 4)
  words.forEach((w, i) => { bytes[i * 4] = w & 255; bytes[i * 4 + 1] = (w >>> 8) & 255; bytes[i * 4 + 2] = (w >>> 16) & 255; bytes[i * 4 + 3] = (w >>> 24) & 255 })
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    s += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    s += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return s
}

const cache = new Map<string, string>()
export function cellsFor(mood: Mood, index: number, frame: Frame): string {
  const key = `${mood}:${index}`
  let cells = cache.get(key)
  if (!cells) cache.set(key, (cells = toBase64(toCells(frame.px))))
  return cells
}
