// The Settings tab: every blade with a plain-English line, grouped the way people look for them. Pure data.

export type BladeKey = 'mascot' | 'coach' | 'guard' | 'ping' | 'cache' | 'next' | 'secrets' | 'strip'

export type Group = 'Mascot and sound' | 'Help along the way' | 'Safety'

export const BLADES: { key: BladeKey; group: Group; name: string; about: string }[] = [
  { key: 'mascot', group: 'Mascot and sound', name: 'Mascot', about: 'Shows what Claude is doing' },
  { key: 'strip', group: 'Mascot and sound', name: 'Strip above the prompt', about: 'Status and one alert where you type' },
  { key: 'coach', group: 'Help along the way', name: 'Model tips', about: 'When another model fits better' },
  { key: 'cache', group: 'Help along the way', name: 'Quick memory timer', about: 'Before replies start to cost more' },
  { key: 'guard', group: 'Safety', name: 'Guard', about: 'Asks before anything that destroys work' },
  { key: 'ping', group: 'Safety', name: 'Ping me', about: 'Chime and notice when Claude needs you' },
  { key: 'secrets', group: 'Safety', name: 'Hide secrets', about: 'Keys, passwords and emails greyed out on screen' },
]

// What /knife demo can stage, so features that need a long chat can be seen (and filmed) in seconds.
export const DEMOS: Record<string, string> = {
  'needs-you': 'Claude waiting for your answer',
  handoff: 'the chat at 74% full',
  cache: 'the quick memory running out in 4 minutes',
  'cache-gone': 'the quick memory gone',
  limits: 'plan limits near the cap, with a forecast',
  budget: 'today\'s budget passed',
  recap: 'a last-task report and a next-step suggestion',
}
