import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const GAP = 10
const HIDE_DELAY = 120
// Above every overlay (modals z-90, drawers z-80, dropdowns z-50, charts z-30).
const Z_INDEX = 2147483000

// Only one Tip may be visible at a time. Tracking the active instance's own
// forced-close lets a newly hovered Tip kill the previous one instantly
// instead of waiting out its HIDE_DELAY — that overlap is what caused two
// tooltips to render at once when the pointer moved quickly between cells.
let activeCloseTip = null

function computePos(anchor, side) {
  const r = anchor.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  let x = Math.round(r.left + r.width / 2)
  let y = side === 'top' ? Math.round(r.top - GAP) : Math.round(r.bottom + GAP)

  // Keep the popover fully inside the viewport (flip side when it would overflow).
  if (side === 'bottom' && y + 260 > vh - 16) side = 'top'
  if (side === 'top' && y - 260 < 16) side = 'bottom'
  y = side === 'top' ? Math.round(r.top - GAP) : Math.round(r.bottom + GAP)

  const half = 170
  x = Math.max(half + 16, Math.min(x, vw - half - 16))
  return { x, y, side }
}

function moveTitleToData(el) {
  if (!el) return () => {}
  let node = el
  // If the wrapper itself has no title, look for a titled child (common for icon buttons).
  if (!node.title) {
    const titled = node.querySelector?.('[title]')
    if (titled) node = titled
  }
  if (!node?.title) return () => {}
  const original = node.title
  node.setAttribute('data-tip-title', original)
  node.removeAttribute('title')
  return () => {
    node.setAttribute('title', original)
    node.removeAttribute('data-tip-title')
  }
}

export default function Tip({ content, children, side = 'bottom' }) {
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const visible = useRef(false)
  const sideRef = useRef(side)
  const hideTimer = useRef(null)
  const restoreTitle = useRef(null)

  const update = useCallback(() => {
    if (!visible.current || !ref.current) return
    const p = computePos(ref.current, sideRef.current)
    if (!p) return
    sideRef.current = p.side
    setPos(prev => (prev && prev.x === p.x && prev.y === p.y && prev.side === p.side ? prev : p))
  }, [])

  const closeNow = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
    visible.current = false
    setPos(null)
    if (restoreTitle.current) {
      restoreTitle.current()
      restoreTitle.current = null
    }
  }, [])

  const show = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (activeCloseTip && activeCloseTip !== closeNow) activeCloseTip()
    activeCloseTip = closeNow
    if (!restoreTitle.current) restoreTitle.current = moveTitleToData(ref.current)
    visible.current = true
    update()
  }, [update, closeNow])

  const hide = useCallback(() => {
    hideTimer.current = setTimeout(() => {
      if (activeCloseTip === closeNow) activeCloseTip = null
      closeNow()
    }, HIDE_DELAY)
  }, [closeNow])

  useEffect(() => () => { if (activeCloseTip === closeNow) activeCloseTip = null }, [closeNow])

  // While visible, keep the popover glued to its anchor even when an ancestor
  // scroll container moves underneath. Capture-phase scroll on document catches
  // scrolls that don't bubble (overflow-x / overflow-y containers).
  useEffect(() => {
    if (!visible.current) return
    update()
    document.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      document.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [pos, update])

  return (
    <>
      <span
        ref={ref}
        className="inline-flex"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {pos && createPortal(
        <div
          className="fixed pointer-events-none"
          style={{
            left: 0,
            top: 0,
            zIndex: Z_INDEX,
            transform: `translate(${pos.x}px, ${pos.y}px) translate(-50%, ${pos.side === 'top' ? '-100%' : '0'})`
          }}
        >
          <div className="tip-content" data-side={pos.side}>
            {content}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
