'use client'

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { MoveNode } from '@/lib/chess/types'
import { activeLine } from '@/lib/chess/moveTree'
import type { FenEval } from '@/lib/api/client'
import { lookupEval } from '@/lib/lichess/lookup'
import { MoveEvaluator } from '@/lib/engine/moveEval'
import { toFigurine } from '@/lib/chess/figurine'

function formatMoveEval(e: FenEval): string {
  if (e.mate !== 0) return `#${e.mate}`
  if (e.tablebaseCategory) {
    switch (e.tablebaseCategory) {
      case 'win':
      case 'syzygy-win':
        return 'TB+'
      case 'loss':
      case 'syzygy-loss':
        return 'TB−'
      case 'cursed-win':
        return 'TB+*'
      case 'blessed-loss':
        return 'TB−*'
      case 'maybe-win':
        return 'TB+?'
      case 'maybe-loss':
        return 'TB−?'
      case 'unknown':
        return 'TB?'
      default:
        return 'TB='
    }
  }
  const v = (Math.abs(e.score) / 100).toFixed(1)
  return e.score >= 0 ? `+${v}` : `−${v}`
}

interface Props {
  openingName: string
  moveTree: MoveNode
  currentNodeId: string
  onGotoNode: (id: string) => void
  onLoadPgn: (pgn: string) => Promise<void>
  engineEnabled?: boolean
  engineBusy?: boolean
}

export default function MoveHistory({
  openingName,
  moveTree,
  currentNodeId,
  onGotoNode,
  onLoadPgn,
  engineEnabled = true,
  engineBusy = false,
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
    const el = currentRef.current
    let box: HTMLElement | null = el?.parentElement ?? null
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement
    if (!el || !box) return
    const elRect = el.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    if (elRect.top < boxRect.top) box.scrollTop -= boxRect.top - elRect.top
    else if (elRect.bottom > boxRect.bottom) box.scrollTop += elRect.bottom - boxRect.bottom
  }, [currentNodeId])

  const [evals, setEvals] = useState<Record<string, FenEval>>({})
  const evalsRef = useRef(evals)

  useEffect(() => {
    evalsRef.current = evals
  }, [evals])

  const evaluatorRef = useRef<MoveEvaluator | null>(null)
  const attemptedRef = useRef(new Set<string>())
  const busyRef = useRef(engineBusy)

  useEffect(() => {
    busyRef.current = engineBusy
  }, [engineBusy])

  useEffect(() => {
    return () => {
      evaluatorRef.current?.dispose()
      evaluatorRef.current = null
    }
  }, [])

  useEffect(() => {
    const fens = activeLine(moveTree, currentNodeId).map((n) => n.fen)
    const missing = fens.filter((f) => !(f in evalsRef.current) && !attemptedRef.current.has(f))
    if (missing.length === 0) return

    let cancelled = false
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    ;(async () => {
      const unresolved: string[] = []
      const cloudResults: Record<string, FenEval> = {}
      const queue = [...missing]
      const worker = async () => {
        for (let fen = queue.shift(); fen !== undefined; fen = queue.shift()) {
          if (cancelled) return
          let e: FenEval | null = null
          try {
            e = await lookupEval(fen)
          } catch {
          }
          if (cancelled) return
          if (e) {
            attemptedRef.current.add(fen)
            cloudResults[fen] = e
          } else {
            unresolved.push(fen)
          }
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()])
      if (cancelled) return
      if (Object.keys(cloudResults).length > 0) {
        setEvals((prev) => ({ ...prev, ...cloudResults }))
      }
      if (!engineEnabled) return
      let localResults: Record<string, FenEval> = {}
      const flushLocalResults = () => {
        if (cancelled || Object.keys(localResults).length === 0) return
        const batch = localResults
        localResults = {}
        setEvals((prev) => ({ ...prev, ...batch }))
      }
      for (const fen of unresolved) {
        if (cancelled) return
        while (busyRef.current && !cancelled) await pause(400)
        if (cancelled) return
        const evaluator = (evaluatorRef.current ??= new MoveEvaluator())
        try {
          const e = await evaluator.evaluate(fen)
          if (cancelled) return
          attemptedRef.current.add(fen)
          if (e) {
            localResults[fen] = e
            if (Object.keys(localResults).length >= 2) flushLocalResults()
          }
        } catch {
        }
      }
      flushLocalResults()
    })()
    return () => {
      cancelled = true
      evaluatorRef.current?.cancel()
    }
  }, [moveTree, currentNodeId, engineEnabled])

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
          padding: '6px 8px',
          borderRadius: 6,
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
            fontSize: 14,
            fontWeight: isCurrent ? 700 : 400,
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
    let pending: { num: number; white: MoveNode | null; black: MoveNode | null } | null = null

    const flush = () => {
      if (!pending) return
      const { num, white, black } = pending
      rows.push(
        <div
          key={`row-${(white ?? black)!.id}`}
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: 4,
            padding: '0 6px',
            background: rows.length % 2 === 0 ? '#fbfaf7' : 'transparent',
          }}
        >
          <span
            className="mono"
            style={{
              width: 34,
              flexShrink: 0,
              color: '#b4b1a8',
              fontSize: 11,
              textAlign: 'right',
              alignSelf: 'center',
              paddingRight: 8,
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

    for (const move of line) {
      const num = Math.ceil(move.ply / 2)
      if (move.ply % 2 === 1) {
        flush()
        pending = { num, white: move, black: null }
      } else if (pending && pending.white) {
        pending.black = move
      } else {
        flush()
        pending = { num, white: null, black: move }
      }
    }
    flush()
    return rows
  }

  const line = activeLine(moveTree, currentNodeId)

  const hasMoves = line.length > 0

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
          display: openingName ? 'flex' : 'none',
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
      </div>

      {}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: '6px 0',
          overflow: 'auto',
          lineHeight: 1.6,
          fontSize: 15,
        }}
      >
        {hasMoves && <Fragment>{renderRows()}</Fragment>}
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
