/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  waitForBody,
  assignRef,
  getRef,
  parseFragment,
  parseDocument
} from '../src/utils.js'

describe('DOM mutation capture utilities', () => {
  beforeEach(() => {
    if (!document.body) {
      const body = document.createElement('body')
      document.documentElement.appendChild(body)
    }
    document.body.innerHTML = ''
  })

  it('should wait for body to exist before capturing mutations', async () => {
    await expect(waitForBody()).resolves.toBeUndefined()
  })

  it('should assign trackable refs to DOM elements for mutation identification', () => {
    const parent = document.createElement('div')
    const child1 = document.createElement('span')
    const child2 = document.createElement('p')
    parent.appendChild(child1)
    parent.appendChild(child2)

    assignRef(parent)

    const parentRef = getRef(parent)
    const child1Ref = getRef(child1)
    const child2Ref = getRef(child2)

    // Each element should get unique ref
    expect(parentRef).toBeTruthy()
    expect(child1Ref).toBeTruthy()
    expect(child2Ref).toBeTruthy()
    expect(parentRef).not.toBe(child1Ref)
    expect(child1Ref).not.toBe(child2Ref)
  })

  it('should maintain stable refs across multiple assignments', () => {
    const div = document.createElement('div')
    assignRef(div)
    const firstRef = getRef(div)

    assignRef(div)
    const secondRef = getRef(div)

    expect(firstRef).toBe(secondRef)
  })

  it('should serialize DOM elements to transmittable VNode structure', () => {
    const button = document.createElement('button')
    button.id = 'submit'
    button.className = 'btn-primary'
    button.textContent = 'Submit'

    const vnode = parseFragment(button)

    // VNode should be serializable (has type and props)
    expect(vnode).toHaveProperty('type')
    expect(vnode).toHaveProperty('props')
    expect(JSON.stringify(vnode)).toBeTruthy()
  })

  it('should serialize complete document hierarchy for initial capture', () => {
    const div = document.createElement('div')
    div.innerHTML = '<header><h1>App</h1></header><main><p>Content</p></main>'

    const vnode = parseDocument(div)

    // Document parsing wraps in html element
    expect(vnode).toHaveProperty('type')
    expect(vnode).toHaveProperty('props')
    expect(JSON.stringify(vnode)).toBeTruthy()
  })

  it('should handle parsing errors without breaking mutation capture', () => {
    const fragmentResult = parseFragment(null as any)
    const documentResult = parseDocument(null as any)

    // Should return error containers instead of throwing
    expect(typeof fragmentResult).toBe('object')
    expect(typeof documentResult).toBe('object')

    if (typeof fragmentResult === 'object') {
      expect(fragmentResult.type).toBe('div')
      expect(fragmentResult.props.class).toBe('parseFragmentWrapper')
    }

    if (typeof documentResult === 'object') {
      expect(documentResult.type).toBe('div')
      expect(documentResult.props.class).toBe('parseDocument')
    }
  })

  it('should support complete mutation tracking workflow: assign ref → serialize → transmit', () => {
    // Simulate what happens in index.ts when MutationObserver detects changes
    const addedNode = document.createElement('article')
    addedNode.innerHTML = '<h2>New Section</h2><p>New content</p>'

    // Step 1: Assign ref so we can track this node
    assignRef(addedNode)
    const nodeRef = getRef(addedNode)

    // Step 2: Serialize for transmission to backend
    const serialized = parseFragment(addedNode)

    // Step 3: Verify we can identify and serialize the mutation
    expect(nodeRef).toBeTruthy()
    expect(serialized).toHaveProperty('type')
    expect(serialized).toHaveProperty('props')

    // The serialized VNode should be transmittable as JSON
    const json = JSON.stringify(serialized)
    expect(json).toBeTruthy()
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('should support mutation removal tracking via refs', () => {
    const target = document.createElement('div')
    const child = document.createElement('span')
    target.appendChild(child)

    assignRef(target)

    // When mutation observer detects removals, we can get refs
    const targetRef = getRef(target)
    const childRef = getRef(child)

    expect(targetRef).not.toBeNull()
    expect(childRef).not.toBeNull()
  })
})
