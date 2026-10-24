// Guard: spots commands that destroy work, and says why in plain English. Pure logic.

// The command as the shell runs it: quoted text and heredoc bodies blanked out,
// so a command that only mentions "rm -rf" (in a message or a script body) is not caught.
export function shellOnly(command: string): string {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(\n|$)/g, ' ')
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

// Folders that are safe to wipe: they are rebuilt automatically.
const REBUILT = /^(\.\/)?(node_modules|dist|build|out|\.next|\.nuxt|coverage|\.cache|__pycache__|\.pytest_cache|tmp)\/?$/

type Rule = { test: (cmd: string) => boolean; why: string }

const RULES: Rule[] = [
  {
    // rm with both -r and -f, unless every target is a folder that gets rebuilt anyway
    test: cmd => [...cmd.matchAll(/\brm\s+((?:-\w+\s+|--[\w-]+\s+)+)([^;&|\n]*)/g)].some(m => {
      const flags = m[1]!
      const isRecursive = /-\w*r|--recursive/i.test(flags)
      const isForced = /-\w*f|--force/.test(flags)
      const targets = m[2]!.trim().split(/\s+/).filter(Boolean)
      return isRecursive && isForced && !(targets.length > 0 && targets.every(t => REBUILT.test(t)))
    }),
    why: 'deletes a folder and everything in it, with no recycle bin',
  },
  {
    test: cmd => /\bRemove-Item\b[^;|\n]*-Recurse/i.test(cmd) || /\b(rd|rmdir)\s+\/s\b/i.test(cmd) || /\bdel\s+[^\n]*\/s\b/i.test(cmd),
    why: 'deletes a folder and everything in it, with no recycle bin',
  },
  { test: cmd => /\bgit\s+reset\s+--hard\b/.test(cmd), why: 'throws away every change you have not saved in git' },
  { test: cmd => /\bgit\s+clean\s+-\w*f/.test(cmd), why: 'deletes every new file git is not tracking yet' },
  { test: cmd => /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/.test(cmd), why: 'throws away every change you have not saved in git' },
  { test: cmd => /\bgit\s+push\b[^;&|\n]*(--force\b|\s-f\b)/.test(cmd), why: 'overwrites the online copy of your project, which can erase other work' },
  { test: cmd => /\b(mkfs|format\s+[a-z]:|diskpart)\b/i.test(cmd) || /\bdd\b[^\n]*\bof=\/dev\//.test(cmd), why: 'wipes a whole drive' },
  { test: cmd => /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i.test(cmd), why: 'deletes data from a database for good' },
  { test: cmd => /\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|Invoke-Expression)\b/i.test(cmd), why: 'runs a script from the internet without showing it to you first' },
]

// What gets deleted, as a person says it: "the junk folder", "these 3 folders", "everything in this folder".
function targetOf(cmd: string): string {
  const rm = /\brm\s+(?:(?:-\w+|--[\w-]+)\s+)+([^;&|\n]*)/.exec(cmd)
  const ps = /\bRemove-Item\b(?:\s+-(?:Path|LiteralPath))?\s+([^\s;|]+)/i.exec(cmd) ?? /\b(?:rd|rmdir)\s+\/s\s+(?:\/q\s+)?([^\s;&|]+)/i.exec(cmd)
  const targets = (rm?.[1] ?? ps?.[1] ?? '').trim().split(/\s+/).filter(t => t && !t.startsWith('-'))
  if (targets.length === 0) return 'this folder'
  if (targets.some(t => t === '*' || t === '.' || t === './*' || t === '/')) return 'everything in this folder'
  if (targets.length > 1) return `these ${targets.length} folders`
  const name = targets[0]!.replace(/["']/g, '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || targets[0]!
  return /^[~$%]/.test(name) ? `the folder ${name}` : `the ${name} folder`
}

// The question the person sees in Claude Code's permission prompt, in plain English.
export function explain(command: string): string | null {
  const cmd = shellOnly(command)
  const why = danger(command)
  if (!why) return null
  const sure = "Allow it only if you're sure."
  if (why.startsWith('deletes a folder')) return `Delete ${targetOf(cmd)} for good? This skips the Recycle Bin, so you can't get it back. ${sure}`
  if (why.includes('not saved in git')) return `Throw away your unsaved changes? Every change not saved in git is lost for good. ${sure}`
  if (why.includes('git is not tracking')) return `Delete the new files git isn't tracking yet? They can't be brought back. ${sure}`
  if (why.includes('online copy')) return `Overwrite the online copy of your project? This can erase work saved there. ${sure}`
  if (why.includes('drive')) return `Wipe a whole drive? Everything on it is lost. ${sure}`
  if (why.includes('database')) return `Delete data from the database for good? Only a backup brings it back. ${sure}`
  return `Run a script from the internet without seeing it first? Allow it only if you trust where it comes from.`
}

// Why this command is dangerous, or null when it is not.
export function danger(command: string): string | null {
  const cmd = shellOnly(command)
  return RULES.find(r => r.test(cmd))?.why ?? null
}

export const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
