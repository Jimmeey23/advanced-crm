import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const GAP = 8
const HIDE_DELAY = 140
// Above every overlay (modals z-90, drawers z-80, dropdowns z-50, charts z-30).
const Z_INDEX = 2147483000

function computePos(anchor, side) {
  const r = anchor.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  let x = Math.round(r.left + r.width / 2)
  let y = side === 'top' ? Math.round(r.top - GAP) : Math.round(r.bottom + GAP)

  // Keep the popover fully inside the viewport (flip side when it would overflow).
  if (side === 'bottom' && y + 300 > vh - 12) side = 'top'
  if (side === 'top' && y - 300 < 12) side = 'bottom'
  y = side === 'top' ? Math.round(r.top - GAP) : Math.round(r.bottom + GAP)

  const half = 170
  x = Math.max(half + 12, Math.min(x, vw - half - 12))
  return { x, y, side }
}

export default function Tip({ content, children, side = 'bottom' }) {
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const visible = useRef(false)
  const sideRef = useRef(side)
  const hideTimer = useRef(null)

  const update = useCallback(() => {
    if (!visible.current || !ref.current) return
    const p = computePos(ref.current, sideRef.current)
    if (!p) return
    sideRef.current = p.side
    setPos(prev => (prev && prev.x === p.x && prev.y === p.y && prev.side === p.side ? prev : p))
  }, [])

  const show = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    visible.current = true
    update()
  }, [update])

  const hide = useCallback(() => {
    hideTimer.current = setTimeout(() => {
      visible.current = false
      setPos(null)
    }, HIDE_DELAY)
  }, [])

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
          <div className="card !rounded-xl px-3 py-2.5 shadow-2xl tip-pop" style={{ maxWidth: 330, background: 'var(--tt-bg)', animation: 'fadeIn .12s ease' }}>
            {content}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
