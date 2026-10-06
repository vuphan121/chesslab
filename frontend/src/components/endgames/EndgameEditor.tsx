'use client'

import { useEffect, useMemo, useState } from 'react'
import Square from '@/components/board/Square'
import Piece from '@/components/board/Piece'
import { useViewportWidth, clamp } from '@/hooks/useViewportWidth'
import type { Color, PieceType } from '@/lib/chess/types'
import { fetchTablebase, type TbResult } from '@/lib/endgame/tablebase'
import { groupsFor, type EndgameObjective, type EndgamePosition } from '@/lib/endgame/positions'
import {
  MAX_NAME_LENGTH,
  OBJECTIVES,
  boardToFen,
  buildCustomPosition,
  fenToBoard,
  newCustomId,
  parseBoardFen,
  validateSetup,
  verdictFor,
  type SetupPieces,
} from '@/lib/endgame/custom'

interface Props {
  initial: EndgamePosition | null
  positions: EndgamePosition[]
  onSave: (position: EndgamePosition, play: boolean) => void
  onCancel: () => void
}

type Tool = { kind: 'move' } | { kind: 'erase' } | { kind: 'piece'; color: Color; type: PieceType }

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']
const PIECE_ORDER: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p']
const PIECE_NAMES: Record<PieceType, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }
const NEW_CATEGORY = '__new__'
const CHECK_DELAY_MS = 500
const DEFAULT_PIECES: SetupPieces = { e1: { type: 'k', color: 'w' }, e8: { type: 'k', color: 'b' } }

export default function EndgameEditor({ initial, positions, onSave, onCancel }: Props) {
  const viewportWidth = useViewportWidth() ?? 375
  const squareSize = clamp(Math.floor(Math.min(viewportWidth - 32, 480) / 8), 30, 60)

  const start = useMemo(() => (initial ? fenToBoard(initial.fens[0]) : { pieces: DEFAULT_PIECES, turn: 'w' as Color }), [initial])
  const groups = useMemo(() => groupsFor(positions), [positions])

  const [pieces, setPieces] = useState<SetupPieces>(start.pieces)
  const [turn, setTurn] = useState<Color>(start.turn)
  const [flipped, setFlipped] = useState(false)
  const [tool, setTool] = useState<Tool>({ kind: 'move' })
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState(initial?.name ?? '')
  const [group, setGroup] = useState(initial?.group ?? groups[0].key)
  const [newGroup, setNewGroup] = useState('')
  const [objective, setObjective] = useState<EndgameObjective>(initial?.objective ?? 'checkmate')
  const [randomize, setRandomize] = useState(initial?.randomize ?? false)
  const [fenDraft, setFenDraft] = useState<string | null>(null)
  const [checked, setChecked] = useState<{ fen: string; tb: TbResult | null } | null>(null)

  const fen = boardToFen(pieces, turn)
  const errors = useMemo(() => validateSetup(pieces, turn, objective), [pieces, turn, objective])
  const hasErrors = errors.length > 0

  useEffect(() => {
    if (hasErrors) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      fetchTablebase(fen).then(
        (tb) => !cancelled && setChecked({ fen, tb }),
        () => !cancelled && setChecked({ fen, tb: null }),
      )
    }, CHECK_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [fen, hasErrors])

  const verdict = useMemo(() => {
    if (hasErrors) return null
    if (!checked || checked.fen !== fen) return { ok: false, pending: true, text: 'Checking with the tablebase…' }
    if (!checked.tb) return { ok: true, pending: false, text: 'Could not reach the tablebase to check this. You can still save it.' }
    return { ...verdictFor(objective, turn, checked.tb), pending: false }
  }, [hasErrors, checked, fen, objective, turn])

  const chosenGroup = group === NEW_CATEGORY
    ? (groups.find((g) => g.label.toLowerCase() === newGroup.trim().toLowerCase())?.key ?? newGroup.trim())
    : group
  const canSave = name.trim().length > 0 && chosenGroup.length > 0 && !hasErrors && !!verdict && verdict.ok && !verdict.pending

  const files = flipped ? [...FILES].reverse() : FILES
  const ranks = flipped ? [...RANKS].reverse() : RANKS

  const clickSquare = (square: string) => {
    setFenDraft(null)
    if (tool.kind === 'erase') {
      setPieces((current) => {
        const next = { ...current }
        delete next[square]
        return next
      })
      return
    }
    if (tool.kind === 'piece') {
      const { color, type } = tool
      setPieces((current) => {
        const existing = current[square]
        const next = { ...current }
        if (existing && existing.color === color && existing.type === type) delete next[square]
        else next[square] = { color, type }
        return next
      })
      return
    }
    if (selected && selected !== square && pieces[selected]) {
      setPieces((current) => {
        const next = { ...current }
        next[square] = current[selected]
        delete next[selected]
        return next
      })
      setSelected(null)
      return
    }
    setSelected(pieces[square] && selected !== square ? square : null)
  }

  const chooseTool = (next: Tool) => {
    setTool(next)
    setSelected(null)
  }

  const save = (play: boolean) => {
    if (!canSave) return
    onSave(
      buildCustomPosition({
        id: initial?.id ?? newCustomId(),
        name,
        group: chosenGroup,
        fen,
        objective,
        randomize,
      }),
      play,
    )
  }

  const changeFen = (text: string) => {
    const parsed = parseBoardFen(text)
    if (!parsed) {
      setFenDraft(text)
      return
    }
    setFenDraft(null)
    setPieces(parsed.pieces)
    setTurn(parsed.turn)
    setSelected(null)
  }

  const paletteRow = (color: Color) => (
    <div style={{ display: 'flex', gap: 4 }}>
      {PIECE_ORDER.map((type) => {
        const active = tool.kind === 'piece' && tool.color === color && tool.type === type
        return (
          <button
            key={type}
            className="tap"
            onClick={() => chooseTool(active ? { kind: 'move' } : { kind: 'piece', color, type })}
            aria-label={`${color === 'w' ? 'White' : 'Black'} ${type}`}
            aria-pressed={active}
            style={{ ...paletteButton(squareSize), ...(active ? paletteActive : null) }}
          >
            <Piece piece={{ color, type }} size={squareSize * 0.8} />
          </button>
        )
      })}
    </div>
  )

  return (
    <div style={{ width: '100%', maxWidth: 980, margin: '24px auto 0', padding: '0 clamp(12px, 4vw, 24px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button className="tap" onClick={onCancel} aria-label="Back to your positions" style={backButton}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M6.5 1.5L2.5 5L6.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <h1 className="serif" style={{ fontSize: 24, fontWeight: 400, margin: 0 }}>{initial ? 'Edit position' : 'New position'}</h1>
      </div>

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
                      onClick={() => clickSquare(square)}
                      data-square={square}
                      role="button"
                      aria-label={piece ? `${square} ${piece.color === 'w' ? 'white' : 'black'} ${PIECE_NAMES[piece.type]}` : `${square} empty`}
                      style={{ position: 'relative', width: squareSize, height: squareSize, cursor: 'pointer' }}
                    >
                      <Square
                        square={square}
                        piece={null}
                        squareSize={squareSize}
                        spriteCol={FILES.indexOf(file)}
                        spriteRow={RANKS.indexOf(rank)}
                        isSelected={selected === square}
                        isLegalMove={false}
                        isLastMove={false}
                        isCheck={false}
                        rankLabel={file === files[0] ? rank : undefined}
                        fileLabel={rank === ranks[ranks.length - 1] ? file : undefined}
                      />
                      {piece && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 10 }}>
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            <button className="tap" onClick={() => chooseTool({ kind: 'move' })} aria-pressed={tool.kind === 'move'} style={{ ...smallButton, ...(tool.kind === 'move' ? smallActive : null) }}>
              Move pieces
            </button>
            <button className="tap" onClick={() => chooseTool({ kind: 'erase' })} aria-pressed={tool.kind === 'erase'} style={{ ...smallButton, ...(tool.kind === 'erase' ? smallActive : null) }}>
              Erase
            </button>
            <button className="tap" onClick={() => { setPieces({}); setSelected(null) }} style={smallButton}>Clear board</button>
            <button className="tap" onClick={() => setFlipped((f) => !f)} style={smallButton}>Flip board</button>
          </div>
        </div>

        <div style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={fieldLabel}>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Position name"
              aria-label="Position name"
              style={inputStyle}
            />
          </label>

          <label style={fieldLabel}>
            Category
            <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Category" style={inputStyle}>
              {groups.map((g) => (
                <option key={g.key} value={g.key}>{g.label}</option>
              ))}
              <option value={NEW_CATEGORY}>New category…</option>
            </select>
          </label>
          {group === NEW_CATEGORY && (
            <input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Category name"
              aria-label="New category name"
              style={inputStyle}
            />
          )}

          <div style={fieldLabel}>
            Side to move
            <div style={{ display: 'flex', gap: 6 }}>
              {(['w', 'b'] as Color[]).map((color) => (
                <button
                  key={color}
                  className="tap"
                  onClick={() => setTurn(color)}
                  aria-pressed={turn === color}
                  style={{ ...smallButton, flex: 1, ...(turn === color ? smallActive : null) }}
                >
                  {color === 'w' ? 'White' : 'Black'}
                </button>
              ))}
            </div>
          </div>

          <label style={fieldLabel}>
            Objective
            <select value={objective} onChange={(e) => setObjective(e.target.value as EndgameObjective)} aria-label="Objective" style={inputStyle}>
              {OBJECTIVES.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#37352f' }}>
            <input type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} />
            Randomly mirror and swap colours each time
          </label>

          <label style={fieldLabel}>
            FEN
            <input
              value={fenDraft ?? fen}
              onChange={(e) => changeFen(e.target.value)}
              spellCheck={false}
              aria-label="FEN"
              aria-invalid={fenDraft !== null}
              style={{ ...inputStyle, fontFamily: 'var(--font-mono, monospace)', fontSize: 12, ...(fenDraft !== null ? { borderColor: '#b34343' } : null) }}
            />
          </label>

          <div aria-live="polite" style={{ minHeight: 40, fontSize: 13 }}>
            {errors.map((e) => (
              <div key={e} style={{ color: '#b34343', fontWeight: 600 }}>{e}</div>
            ))}
            {verdict && (
              <div style={{ color: verdict.pending ? '#a3a099' : verdict.ok ? '#2f6db0' : '#b34343', fontWeight: 600 }}>{verdict.text}</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="tap"
              onClick={() => save(false)}
              disabled={!canSave}
              style={{ ...primaryButton, opacity: canSave ? 1 : 0.45, cursor: canSave ? 'pointer' : 'default' }}
            >
              Save position
            </button>
            <button className="tap" onClick={() => save(true)} disabled={!canSave} style={{ ...smallButton, opacity: canSave ? 1 : 0.45, cursor: canSave ? 'pointer' : 'default' }}>
              Save and play
            </button>
            <button className="tap" onClick={onCancel} style={smallButton}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const backButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  fontSize: 13,
  fontWeight: 600,
  color: '#6a675f',
  background: '#f0efe9',
  border: 'none',
  padding: '0 12px',
  borderRadius: 8,
  cursor: 'pointer',
}

function paletteButton(squareSize: number): React.CSSProperties {
  return {
    width: squareSize,
    height: squareSize,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fbfaf7',
    border: '1px solid #eae8e2',
    borderRadius: 8,
    cursor: 'pointer',
  }
}

const paletteActive: React.CSSProperties = { background: '#e8f3fd', border: '1px solid #4a90d9' }

const smallButton: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid #d9d6cf',
  background: '#fbfaf7',
  color: '#37352f',
  cursor: 'pointer',
}

const smallActive: React.CSSProperties = { background: '#e8f3fd', border: '1px solid #4a90d9', color: '#2f6db0' }

const primaryButton: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '9px 18px',
  borderRadius: 8,
  border: 'none',
  background: '#4a90d9',
  color: '#fff',
}

const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: '#6a675f' }

const inputStyle: React.CSSProperties = {
  border: '1px solid #d9d6cf',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 14,
  background: '#fbfaf7',
  color: '#37352f',
  outlineColor: '#4a90d9',
}
