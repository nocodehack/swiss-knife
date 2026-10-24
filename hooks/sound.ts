// Sound: a chime when Claude finishes a task. Pure logic.

export type Sound = { isOn: boolean; volume: number } // volume 0 to 1
export const DEFAULT_SOUND: Sound = { isOn: true, volume: 0.6 }
export const MIN_TASK_MS = 10_000 // quick answers stay quiet; a chime is for work you waited on

export const step = (volume: number, by: number) => Math.round(Math.max(0, Math.min(1, volume + by)) * 10) / 10

export function parseVolume(text: string): number | null {
  const n = Number(text.trim().replace(/%$/, ''))
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) / 100 : null
}

// Windows has no player for $.audio, so the mod asks Windows' own media player, at the chosen volume.
export const windowsPlay = (file: string, volume: number) => [
  'powershell', '-NoProfile', '-NonInteractive', '-Command',
  `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; ` +
    `$p.Open([uri]'${file.replace(/'/g, "''")}'); $p.Volume = ${volume.toFixed(2)}; Start-Sleep -Milliseconds 250; ` +
    `$p.Play(); Start-Sleep -Milliseconds 1400; $p.Close()`,
]

export const soundLabel = (s: Sound) => (s.isOn ? `🔔 ${Math.round(s.volume * 100)}%` : '🔕 off')
