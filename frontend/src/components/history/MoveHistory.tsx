'use client'

import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import type { MoveNode } from '@/lib/chess/types'
import { childrenOf, flatten } from '@/lib/chess/moveTree'

interface Props {
  moveTree: MoveNode
  currentNodeId: string
  onGotoNode: (id: string) => void
  onNavStart: () => void
  onNavPrev: () => void
  onNavNext: () => void
  onNavEnd: () => void
  onReset: () => void
}

// ── NavBtn ────────────────────────────────────────────────────────────────────

function NavBtn({
  label,
  disabled,
  onClick,
  title,
}: {
  label: ReactNode
  disabled?: boolean
  onClick: () => void
  title: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 30,
        height: 26,
        border: '1px solid #eae8e2',
        background: '#fff',
        borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? '#d6d3ca' : '#9a978f',
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
    </button>
  )
}

// ── MoveOrder ─────────────────────────────────────────────────────────────────

export default function MoveHistory({
  moveTree,
  currentNodeId,
  onGotoNode,
  onNavStart,
  onNavPrev,
  onNavNext,
  onNavEnd,
  onReset,
}: Props) {
  const currentRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [currentNodeId])

  const flat = flatten(moveTree)
  const currentNode = flat.get(currentNodeId)?.node
  const atRoot = currentNodeId === moveTree.id
  const atLeaf = currentNode ? childrenOf(currentNode).length === 0 : true

  // Render one move token: optional move number + SAN chip.
  const renderMove = (node: MoveNode, showNumber: boolean, variation: boolean): ReactNode => {
    const isWhite = node.ply % 2 === 1
    const moveNum = Math.ceil(node.ply / 2)
    const isCurrent = node.id === currentNodeId
    const numLabel = isWhite ? `${moveNum}.` : showNumber ? `${moveNum}…` : null

    return (
      <span key={node.id} style={{ whiteSpace: 'nowrap' }}>
        {numLabel && (
          <span
            className="mono"
            style={{ color: '#c0bdb4', fontSize: variation ? 11 : 12, marginRight: 1 }}
          >
            {numLabel}
          </span>
        )}
        <span
          ref={isCurrent ? currentRef : undefined}
          className="mono"
          onClick={() => onGotoNode(node.id)}
          style={{
            fontSize: variation ? 13 : 15,
            fontWeight: isCurrent ? 700 : variation ? 400 : 500,
            color: isCurrent ? '#1c1b18' : variation ? '#7a776f' : '#37352f',
            background: isCurrent ? '#d4eef9' : 'transparent',
            padding: '1px 5px',
            borderRadius: 5,
            cursor: 'pointer',
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => {
            if (!isCurrent) (e.currentTarget as HTMLElement).style.background = '#f4f3ee'
          }}
          onMouseLeave={(e) => {
            if (!isCurrent) (e.currentTarget as HTMLElement).style.background = 'transparent'
          }}
        >
          {node.san}
        </span>{' '}
      </span>
    )
  }

  // Render the main line from posNode onward, inlining any sidelines (in
  // parentheses) right after the move they branch from. Recurses for nesting.
  const renderContinuation = (
    posNode: MoveNode,
    forceNumberFirst: boolean,
    variation: boolean,
  ): ReactNode[] => {
    const out: ReactNode[] = []
    let node = posNode
    let forceNumber = forceNumberFirst
    while (true) {
      const kids = childrenOf(node)
      if (kids.length === 0) break
      const main = kids[0]
      out.push(renderMove(main, forceNumber, variation))

      const sidelines = kids.slice(1)
      for (const v of sidelines) {
        out.push(
          <span
            key={`var-${v.id}`}
            style={{ color: '#7a776f', display: 'inline' }}
          >
            {'( '}
            {renderMove(v, true, true)}
            {renderContinuation(v, false, true)}
            {') '}
          </span>,
        )
      }

      forceNumber = sidelines.length > 0
      node = main
    }
    return out
  }

  const hasMoves = childrenOf(moveTree).length > 0

  return (
    <div
      style={{
        flexShrink: 0,
        background: '#fff',
        borderRadius: 11,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid #efeee9',
        }}
      >
        <span className="lbl" style={{ color: '#b4b1a8' }}>
          Move order
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <NavBtn
            label={
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path
                  d="M2 7a5 5 0 1 1 1.5 3.5M2 7V4M2 7h3"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
            onClick={onReset}
            title="Reset — clear all moves"
          />
          <span style={{ width: 4 }} />
          <NavBtn label="⟨⟨" disabled={atRoot} onClick={onNavStart} title="Start" />
          <NavBtn label="⟨" disabled={atRoot} onClick={onNavPrev} title="Previous" />
          <NavBtn label="⟩" disabled={atLeaf} onClick={onNavNext} title="Next" />
          <NavBtn label="⟩⟩" disabled={atLeaf} onClick={onNavEnd} title="End" />
        </div>
      </div>

      {/* Move list */}
      <div
        style={{
          padding: '10px 16px 12px',
          height: 132,
          overflow: 'auto',
          lineHeight: 2,
        }}
      >
        {hasMoves ? (
          <Fragment>{renderContinuation(moveTree, false, false)}</Fragment>
        ) : (
          <span style={{ fontSize: 12, color: '#bbb' }}>No moves yet</span>
        )}
      </div>
    </div>
  )
}
