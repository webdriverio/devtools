import { test, expect } from 'vitest'
import { h, render } from 'preact'
import type { VNode } from 'preact'

interface SanitizedVNode {
  type: string
  props: Record<string, any> & {
    children?: SanitizedVNode | SanitizedVNode[]
  }
}

function transform (node: SanitizedVNode): VNode<{}> {
  if (typeof node !== 'object') {
    return node as VNode<{}>
  }

  const { children, ...props } = node.props
  const childrenRequired = children || []
  const c = Array.isArray(childrenRequired) ? childrenRequired : [childrenRequired]
  return h(node.type as string, props, ...c.map(transform)) as VNode<{}>
}

test('should be able serialize DOM', async () => {
  await import('../src/index.ts')
  expect(window.errors).toEqual([])
  expect(window.changes.length).toBe(1)
  expect(window.changes).toMatchSnapshot()
})

test('should be able to parse serialized DOM and render it', () => {
  const stage = document.createDocumentFragment()
  const [initial] = window.changes
  render(transform(initial.addedNodes[0]), stage)
  expect(document.documentElement.outerHTML)
    .toBe((stage.childNodes[0] as HTMLElement).outerHTML)
})

test('should be able to properly serialize changes', async () => {
  const change = document.createElement('div')
  change.setAttribute('id', 'change')
  change.appendChild(document.createTextNode('some '))
  const bold = document.createElement('i')
  bold.appendChild(document.createTextNode('real'))
  change.appendChild(bold)
  change.appendChild(document.createTextNode(' change'))
  document.body.appendChild(change)

  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(window.changes.length).toBe(2)
  const [, vChange] = window.changes
  const stage = document.createDocumentFragment()
  render(transform(vChange.addedNodes[0].props.children), stage)
  expect((stage.childNodes[0] as HTMLElement).outerHTML).toMatchSnapshot()
})
