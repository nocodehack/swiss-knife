import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'swiss-knife', component: 'Pane', requestId: 'swiss-knife',
  props: { title: 'Swiss Knife', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const BAND = {
  plugin: 'swiss-knife', component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 120, scroll: { offset: 0, bodyRows: 30 } },
} as const

// The engine beneath the mod: an empty store, a fixed clock, a chat of two messages.
function engine(on: any, extra: { messages?: unknown[]; doc?: string } = {}) {
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('store.delete', () => ({ value: undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', () => ({ value: { code: 0, stdout: '', stderr: '' } }))
  on('env.get', () => ({ value: 'Windows_NT' }))
  // The engine's own band above the prompt: nothing of its own to show.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('session.messages', () => ({ value: extra.messages ?? [{ role: 'user', text: 'make the hours bold' }, { role: 'assistant', text: 'Done.' }] }))
  if (extra.doc) on('model.complete', () => ({ value: { isAnswered: true, text: extra.doc } }))
}

test('the panel opens on Swiss Knife and its tabs switch, on every surface', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Today$/ }))?.text).toBe('Today')
    expect((await ui.find({ type: 'Text', text: /^time worked$/ }))?.text).toBe('time worked')
    await ui.press({ key: 'sound' })
    expect((await ui.find({ type: 'Text', text: /^Volume/ }))?.text).toMatch(/^Volume/)
    await ui.press({ key: 'sound' }) // closed again for the next surface
    await ui.press({ key: 'tab-settings' })
    expect((await ui.find({ type: 'Text', text: /^New chat at$/ }))?.text).toBe('New chat at')
    expect((await ui.find({ type: 'Text', text: /^Safety$/ }))?.text).toBe('Safety')
    await ui.press({ key: 'fold-set-safety-btn' })
    expect((await ui.find({ type: 'Text', text: /^Guard$/ }))?.text).toBe('Guard')
    await ui.press({ key: 'fold-set-safety-btn' })
    expect((await ui.find({ type: 'Text', text: /^Turn Swiss Knife off$/ }))?.text).toBe('Turn Swiss Knife off')
    await ui.press({ key: 'tab-pins' })
    expect((await ui.find({ type: 'Text', text: /Nothing pinned yet/ }))?.text).toBe('Nothing pinned yet')
    await ui.press({ key: 'tab-handoff' })
    expect((await ui.find({ type: 'Text', text: /^Continue in a new chat$/ }))?.text).toBe('Continue in a new chat')
    await ui.press({ key: 'tab-knife' })
    await ui.unmount()
  }
})

const DOC = `## Goal
Make the opening hours bold.

## Where it stands
Hours are bold in the footer.

## Files changed
- index.html: <strong> around the hours

## Decisions
None.

## Next steps
1. Check the page in the browser`

test('/handoff writes the document and the Handoff tab shows it', async ($, on) => {
  engine(on, { doc: DOC })
  const r = await $.command.run({ command: 'handoff', args: '' })
  expect(r.text).toContain('Handoff tab')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Ready for a new chat/ }))?.text).toBe('✓ Ready for a new chat')
    expect((await ui.find({ type: 'Text', text: /opening hours bold/ }))?.text).toBe('Make the opening hours bold.')
    expect((await ui.find({ type: 'Text', text: /Check the page/ }))?.text).toBe('Check the page in the browser')
    await ui.press({ key: 'fold-ho-Files changed-btn' })
    expect((await ui.find({ type: 'Text', text: /^index\.html$/ }))?.text).toBe('index.html')
    await ui.press({ key: 'fold-ho-Files changed-btn' })
    await ui.unmount()
  }
  // The strip says the handoff is ready.
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ type: 'Text', text: /Handoff ready/ }))?.text).toContain('Handoff ready')
  await band.unmount()
})

test('the strip: ready with the meter, then Claude needs you in red', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /^Ready/ }))?.text).toMatch(/^Ready · .* today/)
    await ui.unmount()
  }
  await $.command.run({ command: 'knife', args: 'demo needs-you' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Claude needs you/ }))?.text).toMatch(/^● Claude needs you · waiting 0:00$/)
  expect((await ui.find({ type: 'Text', text: /Answer in the chat/ }))?.text).toBe('It wants your OK to go on. Answer in the chat.')
  await ui.press({ key: 'fold-band' })
  expect((await ui.find({ type: 'Text', text: /Claude needs you/ }))?.text).toContain('Claude needs you')
  await ui.unmount()
})

test('the strip: the recap demo gives Done, and a budget alert then wins', async ($, on) => {
  engine(on)
  await $.command.run({ command: 'knife', args: 'demo recap' })
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^✓ Done/ }))?.text).toMatch(/^✓ Done · 2m 14s/)
  await ui.unmount()
  await $.command.run({ command: 'knife', args: 'demo budget' })
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Over today/ }))?.text).toBe("! Over today's budget: $5.40 of $5 (demo).")
  await ui.unmount()
})

test('the Pins tab lists a pin on one line and opens it', async ($, on) => {
  engine(on)
  await $.command.run({ command: 'pin', args: 'Client wants the **menu** page live by [Friday](x.md).' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-pins' })
    expect((await ui.find({ type: 'Text', text: /^Your note/ }))?.text).toMatch(/^Your note · /)
    const open = await ui.find({ type: 'Button', text: /▸/ })
    await ui.press({ key: (open as any).key })
    expect((await ui.find({ type: 'Text', text: /live by Friday\.$/ }))?.text).toBe('Client wants the menu page live by Friday.')
    await ui.press({ key: (open as any).key })
    await ui.press({ key: 'tab-knife' })
    await ui.unmount()
  }
})

test('a reply gets the Pin button under it', async ($, on) => {
  engine(on)
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>reply</Text> })
  const ui = await $.ui.mount({
    plugin: 'swiss-knife', component: 'AssistantMessage', requestId: 'r1', surface: 'desktop',
    props: { text: 'Added the footer.', isFirstOfReply: true } as any,
  })
  expect(await ui.find({ key: 'pin-r1' })).toBeTruthy()
  await ui.unmount()
})
