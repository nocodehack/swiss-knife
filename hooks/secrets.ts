// Hide secrets while recording: API keys, tokens, passwords and email addresses are masked in what
// Claude Code draws. Only the screen changes; Claude still reads the real text. Pure logic.

const SECRETS: RegExp[] = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, // Anthropic / OpenAI keys
  /\bapify_api_[A-Za-z0-9]{20,}/g, // Apify
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, // Stripe
  /\bwhsec_[A-Za-z0-9]{20,}/g, // Stripe webhook secret
  /\b(?:hf_[A-Za-z0-9]{30,}|npm_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_-]{20,}|sbp_[a-f0-9]{30,}|xai-[A-Za-z0-9]{30,})/g, // Hugging Face, npm, GitLab, Supabase, xAI
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // email addresses
  // Any other long random token: 32+ characters mixing lower case, upper case and digits
  // (git hashes and ids are lower case only, so they stay visible).
  /\b(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}/g,
]
// NAME_KEY=value, "password": "value", and the like: the value is masked, the name stays.
const ASSIGNMENT = /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD)[A-Za-z0-9_]*)(["']?\s*[=:]\s*["']?)([^\s"'`,]{6,})/gi

const dots = (s: string) => `${s.slice(0, 4)}${'•'.repeat(Math.min(12, Math.max(4, s.length - 4)))}`

export function mask(text: string): string {
  let out = text.replace(ASSIGNMENT, (_m, name: string, sep: string, value: string) => `${name}${sep}${dots(value)}`)
  for (const re of SECRETS) out = out.replace(re, m => dots(m))
  return out
}

export const hasSecret = (text: string) => mask(text) !== text

// The transcript pieces whose text the mask rewrites.
export const MASKED = ['UserMessage', 'AssistantMessage', 'ToolUse', 'ToolResult', 'CommandOutput'] as const

// Masks every string inside a component's props, keeping their shape (ids are left alone).
export function scrub(value: unknown): unknown {
  if (typeof value === 'string') return mask(value)
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) out[key] = /^(tool_use_id|id|requestId)$/.test(key) ? v : scrub(v)
    return out
  }
  return value
}

// Pulls "RECAP: ..." and "NEXT: ..." out of the recap model's answer.
export function parseRecap(text: string): { recap: string; next: string; report: string[] } {
  const recap = text.match(/RECAP:\s*([\s\S]*?)(?:\n\s*(?:NEXT|REPORT):|$)/i)?.[1]?.trim() ?? text.trim()
  const next = text.match(/NEXT:\s*(.+)/i)?.[1]?.trim() ?? ''
  const body = text.match(/REPORT:\s*([\s\S]*)$/i)?.[1] ?? ''
  const report = body.split('\n').map(l => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(l => l && !/^(RECAP|NEXT):/i.test(l))
  return { recap, next: /^(none|nothing|n\/a)\.?$/i.test(next) ? '' : next, report }
}

// Where the secrets are in a text, as [start, end) ranges: what the prompt box paints over.
export function secretRanges(text: string): [number, number][] {
  const out: [number, number][] = []
  for (const m of text.matchAll(new RegExp(ASSIGNMENT.source, 'gi'))) {
    const valueStart = m.index! + m[1]!.length + m[2]!.length
    out.push([valueStart, valueStart + m[3]!.length])
  }
  for (const re of SECRETS) for (const m of text.matchAll(new RegExp(re.source, 'g'))) out.push([m.index!, m.index! + m[0].length])
  out.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of out) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  return merged
}
