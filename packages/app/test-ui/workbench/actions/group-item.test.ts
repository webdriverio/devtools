import '@components/workbench/actionItems/group.js'
import type { GroupItem } from '@components/workbench/actionItems/group.js'

import { mount, settle } from '../../support/mount.js'
import { shadow, shadowAll, text } from '../../support/queries.js'

const TAG = 'wdio-devtools-group-item'
const LABEL = 'span.label'
const BADGE = '.ml-auto'
const CHEVRON = 'icon-mdi-chevron-right'

const STEP = {
  callId: 'step-7',
  title: 'Given I open the login page',
  startTime: 1000,
  endTime: 1600,
  children: []
}

describe('wdio-devtools-group-item', () => {
  it('renders no row without a group', async () => {
    const el = await mount<GroupItem>(TAG, {})

    expect(shadowAll(el, 'button').length).toBe(0)
  })

  it('renders the group title', async () => {
    const el = await mount<GroupItem>(TAG, { group: { ...STEP } })

    expect(text(shadow(el, LABEL))).toBe('Given I open the login page')
  })

  it("shows the group's own span as its duration", async () => {
    const el = await mount<GroupItem>(TAG, { group: { ...STEP } })

    // Derived from the step, so a row measuring it the wrong way round — or from
    // the wrong end — fails here rather than only in the rendered text.
    expect(el.duration).toBe(STEP.endTime - STEP.startTime)
    expect(text(shadow(el, BADGE))).toBe('600ms')
    expect(shadow(el, BADGE)?.classList.contains('text-chartsYellow')).toBe(
      true
    )
  })

  it('renders a zero-length group as 0ms', async () => {
    const el = await mount<GroupItem>(TAG, {
      group: { ...STEP, endTime: STEP.startTime }
    })

    expect(text(shadow(el, BADGE))).toBe('0ms')
    expect(shadow(el, BADGE)?.classList.contains('text-chartsGreen')).toBe(true)
  })

  it('derives the duration from the group even when a duration prop is supplied', async () => {
    const el = await mount<GroupItem>(TAG, {
      group: { ...STEP },
      duration: 9999
    })

    expect(text(shadow(el, BADGE))).toBe('600ms')
  })

  it('leaves the chevron unrotated when collapsed', async () => {
    const el = await mount<GroupItem>(TAG, { group: { ...STEP } })

    expect(el.hasAttribute('expanded')).toBe(false)
    expect(shadow(el, CHEVRON)?.classList.contains('rotate-90')).toBe(false)
  })

  it('rotates the chevron when expanded', async () => {
    const el = await mount<GroupItem>(TAG, {
      group: { ...STEP },
      expanded: true
    })

    expect(el.hasAttribute('expanded')).toBe(true)
    expect(shadow(el, CHEVRON)?.classList.contains('rotate-90')).toBe(true)
  })

  it('rotates the chevron after the expanded state flips', async () => {
    const el = await mount<GroupItem>(TAG, { group: { ...STEP } })

    el.expanded = true
    await settle(el)

    expect(shadow(el, CHEVRON)?.classList.contains('rotate-90')).toBe(true)
  })

  it('leaves a passing group unmarked', async () => {
    const el = await mount<GroupItem>(TAG, { group: { ...STEP } })

    expect(el.hasAttribute('failed')).toBe(false)
    expect(shadow(el, LABEL)?.classList.contains('text-chartsRed')).toBe(false)
  })

  it('marks the row failed and reddens the title for a failed group', async () => {
    const el = await mount<GroupItem>(TAG, {
      group: { ...STEP, title: 'Then I see the dashboard', failed: true }
    })

    expect(el.hasAttribute('failed')).toBe(true)
    expect(shadow(el, LABEL)?.classList.contains('text-chartsRed')).toBe(true)
  })

  it("emits group-toggle with the group's callId when clicked", async () => {
    const el = await mount<GroupItem>(TAG, { group: { ...STEP } })
    const received: CustomEvent<{ callId?: string; expanded: boolean }>[] = []
    const listener = (event: Event) => received.push(event as CustomEvent)

    el.addEventListener('group-toggle', listener)
    try {
      shadow(el, 'button')?.dispatchEvent(new MouseEvent('click'))
    } finally {
      el.removeEventListener('group-toggle', listener)
    }

    expect(received.length).toBe(1)
    expect(received[0]?.detail.callId).toBe('step-7')
    expect(received[0]?.bubbles).toBe(true)
    expect(received[0]?.composed).toBe(true)
  })

  it('reports the collapsed state in the toggle event of a collapsed group', async () => {
    const el = await mount<GroupItem>(TAG, { group: { ...STEP } })
    const received: CustomEvent<{ expanded: boolean }>[] = []
    const listener = (event: Event) => received.push(event as CustomEvent)

    el.addEventListener('group-toggle', listener)
    try {
      shadow(el, 'button')?.dispatchEvent(new MouseEvent('click'))
    } finally {
      el.removeEventListener('group-toggle', listener)
    }

    expect(received[0]?.detail.expanded).toBe(false)
  })

  it('reports the expanded state in the toggle event of an expanded group', async () => {
    const el = await mount<GroupItem>(TAG, {
      group: { ...STEP },
      expanded: true
    })
    const received: CustomEvent<{ expanded: boolean }>[] = []
    const listener = (event: Event) => received.push(event as CustomEvent)

    el.addEventListener('group-toggle', listener)
    try {
      shadow(el, 'button')?.dispatchEvent(new MouseEvent('click'))
    } finally {
      el.removeEventListener('group-toggle', listener)
    }

    expect(received[0]?.detail.expanded).toBe(true)
  })

  // Groups auto-expand when they failed or hold the active command, so an
  // expanded row that reflowed would be a step nobody clicked taking two lines.
  it('does not reflow the title of a group that was expanded for it', async () => {
    const el = await mount<GroupItem>(TAG, {
      group: { ...STEP, failed: true },
      expanded: true
    })

    expect(el.hasAttribute('revealed')).toBe(false)
  })

  it('reflows the title on click and folds it back on a second click', async () => {
    const el = await mount<GroupItem>(TAG, { group: { ...STEP } })

    shadow(el, 'button')?.dispatchEvent(new MouseEvent('click'))
    await settle(el)
    expect(el.hasAttribute('revealed')).toBe(true)

    shadow(el, 'button')?.dispatchEvent(new MouseEvent('click'))
    await settle(el)
    expect(el.hasAttribute('revealed')).toBe(false)
  })

  it('does not toggle its own expanded state when clicked', async () => {
    const el = await mount<GroupItem>(TAG, { group: { ...STEP } })

    shadow(el, 'button')?.dispatchEvent(new MouseEvent('click'))
    await settle(el)

    expect(el.expanded).toBe(false)
    expect(el.hasAttribute('expanded')).toBe(false)
  })
})
