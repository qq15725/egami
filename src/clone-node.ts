import type { Context } from './context'
import { cloneElement } from './clone-element'
import { copyCssStyles } from './copy-css-styles'
import { copyInputValue } from './copy-input-value'
import { copyPseudoClass } from './copy-pseudo-class'
import {
  isCommentNode,
  isElementNode,
  isHTMLElementNode,
  isScriptElement,
  isSlotElement,
  isStyleElement,
  isSVGElementNode,
  isTextNode,
  isVideoElement,
  splitFontFamily,
} from './utils'

const excludeParentNodes = new Set([
  'symbol', // test/fixtures/svg.symbol.html
])

async function appendChildNode<T extends Node>(
  node: T,
  cloned: T,
  child: ChildNode,
  context: Context,
): Promise<void> {
  if (isElementNode(child) && (isStyleElement(child) || isScriptElement(child)))
    return

  if (context.filter && !context.filter(child))
    return

  if (
    excludeParentNodes.has(cloned.nodeName)
    || excludeParentNodes.has(child.nodeName)
  ) {
    context.currentParentNodeStyle = undefined
  }
  else {
    context.currentParentNodeStyle = context.currentNodeStyle
  }

  const childCloned = await cloneNode(child, context)

  if (context.isEnable('restoreScrollPosition')) {
    restoreScrollPosition(node, childCloned)
  }

  cloned.appendChild(childCloned)
}

async function cloneChildNodes<T extends Node>(
  node: T,
  cloned: T,
  context: Context,
): Promise<void> {
  const firstChild = (
    isElementNode(node)
      ? node.shadowRoot?.firstChild
      : undefined
  ) ?? node.firstChild

  for (let child = firstChild; child; child = child.nextSibling) {
    if (isCommentNode(child))
      continue
    if (
      isElementNode(child)
      && isSlotElement(child)
      && typeof child.assignedNodes === 'function'
    ) {
      const nodes = child.assignedNodes()
      for (let i = 0; i < nodes.length; i++) {
        await appendChildNode(node, cloned, nodes[i] as ChildNode, context)
      }
    }
    else {
      await appendChildNode(node, cloned, child, context)
    }
  }
}

function restoreScrollPosition<T extends Node>(
  node: T,
  chlidCloned: T,
): void {
  if (!isHTMLElementNode(node) || !isHTMLElementNode(chlidCloned))
    return

  const { scrollTop, scrollLeft } = node

  if (!scrollTop && !scrollLeft) {
    return
  }

  const { transform } = chlidCloned.style
  const matrix = new DOMMatrix(transform)

  const { a, b, c, d } = matrix
  matrix.a = 1
  matrix.b = 0
  matrix.c = 0
  matrix.d = 1
  matrix.translateSelf(-scrollLeft, -scrollTop)
  matrix.a = a
  matrix.b = b
  matrix.c = c
  matrix.d = d
  chlidCloned.style.transform = matrix.toString()
}

function applyCssStyleWithOptions(
  cloned: HTMLElement | SVGElement,
  context: Context,
): void {
  const { backgroundColor, width, height, style: styles } = context
  const clonedStyle = cloned.style
  if (backgroundColor)
    clonedStyle.setProperty('background-color', backgroundColor, 'important')
  if (width)
    clonedStyle.setProperty('width', `${width}px`, 'important')
  if (height)
    clonedStyle.setProperty('height', `${height}px`, 'important')
  if (styles) {
    for (const name in styles) clonedStyle[name] = styles[name]!
  }
}

/** @example "'{ */
// eslint-disable-next-line regexp/strict
const NORMAL_ATTRIBUTE_RE = /^[\w-:]+$/

export async function cloneNode<T extends Node>(
  node: T,
  context: Context,
  isRoot = false,
): Promise<Node> {
  const { ownerDocument, ownerWindow, fontFamilies } = context

  if (ownerDocument && isTextNode(node)) {
    return ownerDocument.createTextNode(node.data)
  }

  if (
    ownerDocument
    && ownerWindow
    && isElementNode(node)
    && (isHTMLElementNode(node) || isSVGElementNode(node))
  ) {
    const cloned = await cloneElement(node, context)

    if (context.isEnable('removeAbnormalAttributes')) {
      const names = cloned.getAttributeNames()
      for (let len = names.length, i = 0; i < len; i++) {
        const name = names[i]
        if (!NORMAL_ATTRIBUTE_RE.test(name)) {
          cloned.removeAttribute(name)
        }
      }
    }

    const style
      = context.currentNodeStyle
      = copyCssStyles(node, cloned, isRoot, context)

    if (isRoot)
      applyCssStyleWithOptions(cloned, context)

    let copyScrollbar = false
    if (context.isEnable('copyScrollbar')) {
      const overflow = [
        style.get('overflow-x')?.[0],
        style.get('overflow-y')?.[1],
      ]
      copyScrollbar = (overflow.includes('scroll'))
      || (
        (overflow.includes('auto') || overflow.includes('overlay'))
        && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)
      )
    }

    copyPseudoClass(node, cloned, copyScrollbar, context)

    copyInputValue(node, cloned)

    splitFontFamily(style.get('font-family')?.[0])
      ?.forEach(val => fontFamilies.add(val))

    if (!isVideoElement(node)) {
      await cloneChildNodes(node, cloned, context)
    }

    return cloned
  }

  const cloned = node.cloneNode(false)

  await cloneChildNodes(node, cloned, context)

  return cloned
}
