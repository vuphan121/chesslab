'use client'

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { MoveNode } from '@/lib/chess/types'
import { childrenOf, flatten } from '@/lib/chess/moveTree'
import { evalFen, type FenEval } from '@/lib/api/client'
import { toFigurine } from '@/lib/chess/figurine'



function formatMoveEval(e: FenEval): string {
  if (e.mate !== 0) return `#${e.mate}`
  const v = (Math.abs(e.score) / 100).toFixed(1)
  return e.score >= 0 ? `+${v}` : `−${v}`
}

interface Props {
  openingName: string
  openingEco?: string
  moveTree: MoveNode
  currentNodeId: string
  onGotoNode: (id: string) => void
  onNavStart: () => void
  onNavPrev: () => void
  onNavNext: () => void
  onNavEnd: () => void
  onReset: () => void
  onLoadPgn: (pgn: string) => Promise<void>
}



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



export default function MoveHistory({
  openingName,
  openingEco,
  moveTree,
  currentNodeId,
  onGotoNode,
  onNavStart,
  onNavPrev,
  onNavNext,
  onNavEnd,
  onReset,
  onLoadPgn,
}: Props) {
  const currentRef = useRef<HTMLSpanElement | null>(null)
  const [pgnInput, setPgnInput] = useState('')
  const [pgnError, setPgnError] = useState<string | null>(null)
  const [pgnLoading, setPgnLoading] = useState(false)

  const handleLoadPgn = async () => {
    const pgn = pgnInput.trim()
    if (!pgn || pgnLoading) return
    setPgnLoading(true)
    setPgnError(null)
    try {
      await onLoadPgn(pgn)
    } catch (err) {
      setPgnError(err instanceof Error ? err.message : 'Failed to load PGN.')
    } finally {
      setPgnLoading(false)
    }
  }

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [currentNodeId])




  const [evals, setEvals] = useState<Record<string, FenEval>>({})
  const evalsRef = useRef(evals)
  evalsRef.current = evals

  useEffect(() => {

    const fens: string[] = []
    let n: MoveNode | undefined = moveTree
    while (n) {
      const kids = childrenOf(n)
      if (kids.length === 0) break
      n = kids[0]
      if (n) fens.push(n.fen)
    }
    const missing = fens.filter((f) => !(f in evalsRef.current))
    if (missing.length === 0) return

    let cancelled = false
    ;(async () => {
      for (const fen of missing) {
        if (cancelled) return
        try {
          const e = await evalFen(fen)
          if (!cancelled) setEvals((prev) => ({ ...prev, [fen]: e }))
        } catch {

        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [moveTree])

  const flat = flatten(moveTree)
  const currentNode = flat.get(currentNodeId)?.node
  const atRoot = currentNodeId === moveTree.id
  const atLeaf = currentNode ? childrenOf(currentNode).length === 0 : true


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




  const renderCell = (node: MoveNode | null): ReactNode => {
    if (!node) return <span style={{ flex: 1 }} />
    const isCurrent = node.id === currentNodeId
    const e = evals[node.fen]
    return (
      <span
        ref={isCurrent ? currentRef : undefined}
        onClick={() => onGotoNode(node.id)}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 6,
          padding: '2px 8px',
          borderRadius: 5,
          cursor: 'pointer',
          background: isCurrent ? '#4a90d9' : 'transparent',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(el) => {
          if (!isCurrent) (el.currentTarget as HTMLElement).style.background = '#f4f3ee'
        }}
        onMouseLeave={(el) => {
          if (!isCurrent) (el.currentTarget as HTMLElement).style.background = 'transparent'
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 15,
            fontWeight: isCurrent ? 700 : 500,
            color: isCurrent ? '#fff' : '#37352f',
          }}
        >
          {toFigurine(node.san)}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 12,
            color: isCurrent ? 'rgba(255,255,255,0.85)' : '#a3a099',
          }}
        >
          {e ? formatMoveEval(e) : ''}
        </span>
      </span>
    )
  }





  const renderRows = (): ReactNode[] => {
    const rows: ReactNode[] = []
    let node = moveTree
    let pending: { num: number; white: MoveNode | null; black: MoveNode | null } | null = null

    const flush = () => {
      if (!pending) return
      const { num, white, black } = pending
      rows.push(
        <div key={`row-${(white ?? black)!.id}`} style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
          <span
            className="mono"
            style={{
              width: 26,
              flexShrink: 0,
              color: '#c0bdb4',
              fontSize: 12,
              textAlign: 'right',
              alignSelf: 'center',
            }}
          >
            {white ? `${num}.` : `${num}…`}
          </span>
          {renderCell(white)}
          {renderCell(black)}
        </div>,
      )
      pending = null
    }

    while (true) {
      const kids = childrenOf(node)
      if (kids.length === 0) break
      const main = kids[0]
      const isWhite = main.ply % 2 === 1
      const num = Math.ceil(main.ply / 2)

      if (isWhite) {
        flush()
        pending = { num, white: main, black: null }
      } else if (pending && pending.white) {
        pending.black = main
      } else {
        flush()
        pending = { num, white: null, black: main }
      }

      const sidelines = kids.slice(1)
      if (sidelines.length > 0) {
        flush()
        for (const v of sidelines) {
          rows.push(
            <div
              key={`var-${v.id}`}
              style={{
                paddingLeft: 34,
                color: '#7a776f',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {'( '}
              {renderMove(v, true, true)}
              {renderContinuation(v, false, true)}
              {') '}
            </div>,
          )
        }
      }

      node = main
    }
    flush()
    return rows
  }



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
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        borderRadius: 11,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
        overflow: 'hidden',
      }}
    >
      {}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          padding: '14px 16px 12px',
          borderBottom: '1px solid #efeee9',
        }}
      >
        <span
          className="serif"
          style={{ fontSize: 19, fontWeight: 500, letterSpacing: '-0.2px', lineHeight: 1.25 }}
        >
          {openingName}
        </span>
        {openingEco && (
          <span
            className="mono"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#2f6db0',
              background: '#ecf3fb',
              padding: '2px 7px',
              borderRadius: 5,
              flexShrink: 0,
            }}
          >
            {openingEco}
          </span>
        )}
      </div>

      {}
      <div
        style={{
          flexShrink: 0,
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

      {}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: '10px 16px 12px',
          overflow: 'auto',
          lineHeight: 1.6,
          fontSize: 15,
        }}
      >
        {hasMoves ? (
          <Fragment>{renderRows()}</Fragment>
        ) : (
          <span style={{ fontSize: 12, color: '#bbb' }}>No moves yet</span>
        )}
      </div>

      {}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 16px 12px',
          borderTop: '1px solid #efeee9',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <textarea
          value={pgnInput}
          onChange={(e) => setPgnInput(e.target.value)}
          placeholder=""
          rows={2}
          style={{
            resize: 'vertical',


            fontSize: 16,
            fontFamily: 'var(--font-mono, monospace)',
            padding: '6px 8px',
            border: '1px solid #eae8e2',
            borderRadius: 6,
            color: '#37352f',
            background: '#fbfaf7',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleLoadPgn}
            disabled={!pgnInput.trim() || pgnLoading}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 12px',
              border: '1px solid #eae8e2',
              borderRadius: 6,
              background: '#fff',
              color: pgnInput.trim() && !pgnLoading ? '#37352f' : '#c0bdb4',
              cursor: pgnInput.trim() && !pgnLoading ? 'pointer' : 'default',
            }}
          >
            {pgnLoading ? 'Loading…' : 'Load PGN'}
          </button>
          {pgnError && (
            <span style={{ fontSize: 11, color: '#c0392b', flex: 1 }}>{pgnError}</span>
          )}
        </div>
      </div>
    </div>
  )
}
