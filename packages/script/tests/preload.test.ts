// import { test, expect } from 'vitest'
// import { h, render } from 'preact'
// import type { VNode as PreactVNode } from 'preact'

// function transform (node: SimplifiedVNode | string): PreactVNode<{}> | string {
//   if (typeof node !== 'object') {
//     return node
//   }

//   const { children, ...props } = node.props
//   const childrenRequired = children || []
//   const c = Array.isArray(childrenRequired) ? childrenRequired : [childrenRequired]
//   return h(node.type as string, props, ...c.map(transform)) as PreactVNode<{}>
// }

// test('should be able serialize DOM', async () => {
//   await import('../src/index.ts')
//   expect(window.wdioCaptureErrors).toEqual([])
//   expect(window.wdioDOMChanges.length).toBe(1)
//   expect(window.wdioDOMChanges).toMatchSnapshot()
// })

// test('should be able to parse serialized DOM and render it', () => {
//   const stage = document.createDocumentFragment()
//   const [initial] = window.wdioDOMChanges
//   render(transform(initial.addedNodes[0]), stage)
//   expect(document.documentElement.outerHTML)
//     .toBe((stage.childNodes[0] as HTMLElement).outerHTML)
// })

// test('should be able to properly serialize changes', async () => {
//   const change = document.createElement('div')
//   change.setAttribute('id', 'change')
//   change.appendChild(document.createTextNode('some '))
//   const bold = document.createElement('i')
//   bold.appendChild(document.createTextNode('real'))
//   change.appendChild(bold)
//   change.appendChild(document.createTextNode(' change'))
//   document.body.appendChild(change)

//   await new Promise((resolve) => setTimeout(resolve, 10))
//   expect(window.wdioDOMChanges.length).toBe(2)
//   const [, vChange] = window.wdioDOMChanges
//   const stage = document.createDocumentFragment()
//   render(transform((vChange.addedNodes[0] as SimplifiedVNode).props.children as SimplifiedVNode), stage)
//   expect((stage.childNodes[0] as HTMLElement).outerHTML).toMatchSnapshot()
// })
