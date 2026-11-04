// A captured document's own `<base href>`, read off its serialized tree, so the trace writer and the player resolve its URLs alike.

interface VNodeLike {
  type?: unknown
  props?: { href?: unknown; children?: unknown }
}

function childrenOf(node: VNodeLike): unknown[] {
  const children = node.props?.children
  if (children === undefined || children === null) {
    return []
  }
  return Array.isArray(children) ? children : [children]
}

/** The URL a document's relative URLs resolve against: its first http(s) `<base href>` outside `<body>`, else the document URL. */
export function documentBaseUrl(
  root: unknown,
  documentUrl: string | undefined
): string | undefined {
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (typeof node !== 'object' || node === null) {
      continue
    }
    const vnode = node as VNodeLike
    if (vnode.type === 'base' && typeof vnode.props?.href === 'string') {
      try {
        const base = new URL(vnode.props.href, documentUrl)
        // A trace is untrusted: only a web base may steer the replay's URLs.
        return base.protocol === 'http:' || base.protocol === 'https:'
          ? base.href
          : documentUrl
      } catch {
        return documentUrl
      }
    }
    if (vnode.type !== 'body') {
      const children = childrenOf(vnode)
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i])
      }
    }
  }
  return documentUrl
}
