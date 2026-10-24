// Model coach: after each reply, the model that fits where the chat is going. It only advises: the person
// switches in the app's own model menu, so what the app shows is always what runs. Pure logic.

export type Size = 'small' | 'medium' | 'big' | 'unsure'
export type Effort = 'low' | 'medium' | 'high'

const SMALL = /\b(rename|typo|spelling|fix (a|the|this) (typo|comma|link)|change (the )?(colou?r|text|title|font|wording)|what is|what does|explain this line|format|translate|list the files|add a comment)\b/i
const BIG = /\b(build|implement|design|refactor|architecture|migrate|from scratch|whole|entire|full|app|website|system|integrat|investigate)\w*/i

export function sizeByRules(prompt: string): Size {
  const t = prompt.trim()
  if (t.length > 500 || BIG.test(t)) return 'big'
  if (SMALL.test(t) || t.length < 50) return 'small'
  return 'unsure'
}

export const SIZE_SYSTEM =
  'Classify the request someone gave a coding assistant. Reply with one word: ' +
  'SMALL (a quick edit, a question, a tiny fix), MEDIUM (a feature or fix in a few files) ' +
  'or BIG (needs planning, many files, or hard debugging).'

export const sizeOf = (reply: string): 'small' | 'medium' | 'big' =>
  /small/i.test(reply) ? 'small' : /medium/i.test(reply) ? 'medium' : 'big'

export const tier = (model: string): 'fast' | 'mid' | 'top' =>
  /haiku/i.test(model) ? 'fast' : /sonnet/i.test(model) ? 'mid' : 'top'
export const label = (model: string) =>
  /haiku/i.test(model) ? 'Haiku' : /sonnet/i.test(model) ? 'Sonnet' : /fable/i.test(model) ? 'Fable' : /opus/i.test(model) ? 'Opus' : model

export type Advice = { family: 'haiku' | 'sonnet' | 'opus'; effort: Effort; why: string }

// The model and effort that fit a task of this size.
export function advise(size: 'small' | 'medium' | 'big'): Advice {
  if (size === 'small') return { family: 'haiku', effort: 'low', why: 'This looks like a small task: Haiku on low effort does it for a fraction of the price.' }
  if (size === 'medium') return { family: 'sonnet', effort: 'medium', why: 'This looks like a medium task: Sonnet on medium effort is fast and good enough.' }
  return { family: 'opus', effort: 'high', why: 'This looks like a big task: Opus on high effort plans it better and gets it right first time.' }
}

// The same version of another family: claude-opus-5-5 → claude-haiku-5-5; an alias stays an alias.
export const sameVersion = (current: string, family: string) =>
  /opus|sonnet|haiku|fable/i.test(current) && /^claude-/.test(current) ? current.replace(/opus|sonnet|haiku|fable/i, family) : family


// Prompts the coach should never hold: commands, and text that is clearly not a task.
export const isCoachable = (text: string) => text.trim().length > 0 && !/^\s*[/!#]/.test(text)

export const DIRECTION_SYSTEM =
  'Below is the end of a conversation between a person and a coding assistant. Judge the work that comes next ' +
  '(their latest request and what will follow from it). Reply with one word: SMALL (quick edits, questions, tiny fixes), ' +
  'MEDIUM (a feature or fix across a few files) or BIG (planning, many files, hard debugging).'

// The coach's line, or '' when the model in use already fits. A big chat pays once to switch.
export function coachLine(size: 'small' | 'medium' | 'big', current: string, contextTokens = 0): string {
  const now = tier(current)
  const cost = contextTokens >= 50_000 ? ' Switching re-reads this chat once.' : ''
  const how = ` Switch in the model menu.${cost}`
  if (size === 'small' && now !== 'fast') return `Small edits now. Haiku would do this for less.${how}`
  if (size === 'medium' && now === 'top') return `Everyday work now. Sonnet is fast and good enough.${how}`
  if (size === 'medium' && now === 'fast') return `This needs more than Haiku. Sonnet fits better.${how}`
  if (size === 'big' && now !== 'top') return `This is getting complex. Opus plans it better.${how}`
  return ''
}
