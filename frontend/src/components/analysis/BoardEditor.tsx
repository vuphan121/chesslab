'use client'

import { useMemo, useState } from 'react'
import Square from '@/components/board/Square'
import Piece from '@/components/board/Piece'
import { useViewportWidth, clamp } from '@/hooks/useViewportWidth'
import type { Color, PieceType } from '@/lib/chess/types'
import {
  EDITOR_FILES,
  EDITOR_RANKS,
  START_PLACEMENT,
  availableCastling,
  fenToSetup,
  placementToPieces,
  setupToFen,
  validateSetup,
  type EditorPieces,
} from '@/lib/chess/boardEditor'

interface Props {
  initialFen: string
  error: string | null
  onApply: (fen: string) => void
  onCancel: () => void
}

type Tool = { kind: 'move' } | { kind: 'erase' } | { kind: 'piece'; color: Color; type: PieceType }

const PIECE_ORDER: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p']
const CASTLING_LABELS: [string, string][] = [['K', 'White O-O'], ['Q', 'White O-O-O'], ['k', 'Black O-O'], ['q', 'Black O-O-O']]

export default function BoardEditor({ initialFen, error, onApply, onCancel }: Props) {
  const viewportWidth = useViewportWidth() ?? 375
  const squareSize = clamp(Math.floor(Math.min(viewportWidth - 32, 560) / 8), 34, 70)
  const start = useMemo(() => fenToSetup(initialFen) ?? { pieces: placementToPieces(START_PLACEMENT), turn: 'w' as Color, castling: 'KQkq' }, [initialFen])

  const [pieces, setPieces] = useState<EditorPieces>(start.pieces)
  const [turn, setTurn] = useState<Color>(start.turn)
  const [castling, setCastling] = useState(start.castling)
  const [flipped, setFlipped] = useState(false)
  const [tool, setTool] = useState<Tool>({ kind: 'move' })
  const [selected, setSelected] = useState<string | null>(null)
  const [fenDraft, setFenDraft] = useState<string | null>(null)

  const fen = setupToFen({ pieces, turn, castling })
  const errors = useMemo(() => validateSetup({ pieces, turn, castling }), [pieces, turn, castling])
  const available = availableCastling(pieces)
  const files = flipped ? [...EDITOR_FILES].reverse() : EDITOR_FILES
  const ranks = flipped ? [...EDITOR_RANKS].reverse() : EDITOR_RANKS

  const place = (square: string, piece: { color: Color; type: PieceType } | null) => {
    setFenDraft(null)
    setPieces((current) => {
      const next = { ...current }
      if (piece) next[square] = piece
      else delete next[square]
      return next
    })
  }

  const movePiece = (from: string, to: string) => {
    if (from === to) return
    setFenDraft(null)
    setPieces((current) => {
      if (!current[from]) return current
      const next = { ...current }
      next[to] = current[from]
      delete next[from]
      return next
    })
  }

  const clickSquare = (square: string) => {
    if (tool.kind === 'erase') {
      place(square, null)
      return
    }
    if (tool.kind === 'piece') {
      const existing = pieces[square]
      const same = existing && existing.color === tool.color && existing.type === tool.type
      place(square, same ? null : { color: tool.color, type: tool.type })
      return
    }
    if (selected && selected !== square && pieces[selected]) {
      movePiece(selected, square)
      setSelected(null)
      return
    }
    setSelected(pieces[square] && selected !== square ? square : null)
  }

  const onDrop = (square: string, data: string) => {
    if (data.startsWith('new:')) place(square, { color: data[4] as Color, type: data[5] as PieceType })
    else if (data.startsWith('move:')) movePiece(data.slice(5), square)
    setSelected(null)
  }

  const changeFen = (text: string) => {
    const parsed = fenToSetup(text)
    if (!parsed || Object.keys(parsed.pieces).length === 0) {
      setFenDraft(text)
      return
    }
    setFenDraft(null)
    setPieces(parsed.pieces)
    setTurn(parsed.turn)
    setCastling(parsed.castling)
    setSelected(null)
  }

  const toggleCastling = (right: string) => {
    setCastling((current) => (current.includes(right) ? current.replace(right, '') : current + right))
  }

  const paletteRow = (color: Color) => (
    <div style={{ display: 'flex', gap: 4 }}>
      {PIECE_ORDER.map((type) => {
        const active = tool.kind === 'piece' && tool.color === color && tool.type === type
        return (
          <button
            key={type}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', `new:${color}${type}`)}
            onClick={() => { setTool(active ? { kind: 'move' } : { kind: 'piece', color, type }); setSelected(null) }}
            aria-label={`${color === 'w' ? 'White' : 'Black'} ${type}`}
            aria-pressed={active}
            style={{ width: squareSize, height: squareSize, border: active ? '2px solid #4a90d9' : '1px solid #eae8e2', background: active ? '#e8f3fd' : '#fff', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
          >
            <Piece piece={{ color, type }} size={squareSize * 0.8} />
          </button>
        )
      })}
    </div>
  )

  const blocked = errors.length > 0

  return (
    <div style={{ width: '100%', maxWidth: 980, margin: '24px auto 0', padding: '0 clamp(12px, 4vw, 24px)' }}>
      <h1 className="serif" style={{ fontSize: 24, fontWeight: 400, margin: '0 0 14px' }}>Board editor</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ width: squareSize * 8 }}>
          <div style={{ marginBottom: 6 }}>{paletteRow(flipped ? 'w' : 'b')}</div>
          <div style={{ borderRadius: 4, overflow: 'hidden', boxShadow: '0 6px 28px rgba(30,50,70,0.16)', display: 'inline-flex', flexDirection: 'column', userSelect: 'none' }}>
            {ranks.map((rank) => (
              <div key={rank} style={{ display: 'flex' }}>
                {files.map((file) => {
                  const square = `${file}${rank}`
                  const piece = pieces[square]
                  return (
                    <div
                      key={square}
                      data-square={square}
                      onClick={() => clickSquare(square)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); onDrop(square, e.dataTransfer.getData('text/plain')) }}
                      style={{ position: 'relative', width: squareSize, height: squareSize, cursor: 'pointer' }}
                    >
                      <Square
                        square={square}
                        piece={null}
                        squareSize={squareSize}
                        spriteCol={EDITOR_FILES.indexOf(file)}
                        spriteRow={EDITOR_RANKS.indexOf(rank)}
                        isSelected={selected === square}
                        isLegalMove={false}
                        isLastMove={false}
                        isCheck={false}
                        rankLabel={file === files[0] ? rank : undefined}
                        fileLabel={rank === ranks[ranks.length - 1] ? file : undefined}
                      />
                      {piece && (
                        <div
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', `move:${square}`)}
                          onDragEnd={(e) => { if (e.dataTransfer.dropEffect === 'none') place(square, null) }}
                          style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, cursor: 'grab' }}
                        >
                          <Piece piece={piece} size={squareSize * 0.9} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 6 }}>{paletteRow(flipped ? 'b' : 'w')}</div>
          <p style={{ fontSize: 11, color: '#8b887f', margin: '8px 0 0' }}>
            Drag a piece onto the board, drag a board piece to move it, or drop it outside the board to remove it. You can also click a piece type, then click squares.
          </p>
        </div>

        <div style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button onClick={() => { setTool({ kind: 'move' }); setSelected(null) }} aria-pressed={tool.kind === 'move'} style={{ ...smallButton, ...(tool.kind === 'move' ? smallActive : null) }}>Move pieces</button>
            <button onClick={() => { setTool({ kind: 'erase' }); setSelected(null) }} aria-pressed={tool.kind === 'erase'} style={{ ...smallButton, ...(tool.kind === 'erase' ? smallActive : null) }}>Erase</button>
            <button onClick={() => { setPieces(placementToPieces(START_PLACEMENT)); setTurn('w'); setCastling('KQkq'); setFenDraft(null) }} style={smallButton}>Starting position</button>
            <button onClick={() => { setPieces({}); setCastling(''); setSelected(null); setFenDraft(null) }} style={smallButton}>Clear board</button>
            <button onClick={() => setFlipped((value) => !value)} style={smallButton}>Flip board</button>
          </div>

          <div>
            <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 6 }}>Side to move</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([['w', 'White'], ['b', 'Black']] as [Color, string][]).map(([value, label]) => (
                <button key={value} onClick={() => setTurn(value)} aria-pressed={turn === value} style={{ ...smallButton, ...(turn === value ? smallActive : null) }}>{label}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 6 }}>Castling</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {CASTLING_LABELS.map(([right, label]) => {
                const enabled = available.includes(right)
                return (
                  <label key={right} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: enabled ? '#37352f' : '#b4b1a8' }}>
                    <input type="checkbox" disabled={!enabled} checked={enabled && castling.includes(right)} onChange={() => toggleCastling(right)} />
                    {label}
                  </label>
                )
              })}
            </div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, color: '#77746c' }}>
            FEN
            <input
              value={fenDraft ?? fen}
              onChange={(e) => changeFen(e.target.value)}
              spellCheck={false}
              aria-label="FEN"
              style={{ padding: '7px 9px', border: `1px solid ${fenDraft !== null ? '#d88' : '#dedbd3'}`, borderRadius: 7, fontSize: 12, fontFamily: 'monospace' }}
            />
          </label>

          {(blocked || error) && (
            <ul role="alert" style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#b1453b' }}>
              {errors.map((message) => <li key={message}>{message}</li>)}
              {error && <li>{error}</li>}
            </ul>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={blocked} onClick={() => onApply(fen)} style={{ ...primaryButton, opacity: blocked ? 0.5 : 1, cursor: blocked ? 'default' : 'pointer' }}>Analyze this position</button>
            <button onClick={onCancel} style={smallButton}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const smallButton: React.CSSProperties = { border: '1px solid #eae8e2', background: '#fff', borderRadius: 7, padding: '6px 11px', fontSize: 12, fontWeight: 600, color: '#6a675f', cursor: 'pointer' }
const smallActive: React.CSSProperties = { background: '#e8f3fd', borderColor: '#bcd8f1', color: '#2f6db0' }
const primaryButton: React.CSSProperties = { border: 'none', background: '#4a90d9', color: '#fff', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600 }
