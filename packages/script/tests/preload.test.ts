import { test, expect } from 'vitest'

// function transform (node: SanitizedVNode): VNode<{}> {
//   if (typeof node !== 'object') {
//     return node as VNode<{}>
//   }

//   const { children, ...props } = node.props
//   const childrenRequired = children || []
//   const c = Array.isArray(childrenRequired) ? childrenRequired : [childrenRequired]
//   return h(node.type as string, props, ...c.map(transform)) as VNode<{}>
// }

test('should be able to render vdom', async () => {
  await import('../src/index.ts')
  expect(window.errors).toEqual([])
  expect(window.changes).toMatchSnapshot()
})
