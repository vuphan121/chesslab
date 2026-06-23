import type { Analysis } from '@/lib/api/client'

interface Props {
  analysis: Analysis | null
  analyzing: boolean
  turn: 'w' | 'b'
  fullMove: number
  height: number
}

function scoreStr(score: number, mate: number): string {
  if (mate !== 0) return mate > 0 ? `#${mate}` : `#${mate}`
  const v = (Math.abs(score) / 100).toFixed(1)
  return score >= 0 ? `+${v}` : `-${v}`
}

function scoreColor(score: number, mate: number): string {
  if (mate !== 0) return mate > 0 ? '#4a90d9' : '#b71c1c'
  if (score > 20) return '#4a90d9'
  if (score < -20) return '#b71c1c'
  return '#555'
}

function formatMoves(moves: string[], turn: 'w' | 'b', fullMove: number): string {
  const parts: string[] = []
  let isWhite = turn === 'w'
  let num = fullMove

  for (let i = 0; i < Math.min(moves.length, 10); i++) {
    if (isWhite) {
      parts.push(`${num}. ${moves[i]}`)
    } else {
      parts.push(i === 0 ? `${num}... ${moves[i]}` : moves[i])
      num++
    }
    isWhite = !isWhite
  }
  return parts.join(' ')
}

export default function TopLines({ analysis, analyzing, turn, fullMove, height }: Props) {
  const score = analysis?.score ?? 0
  const mate = analysis?.mate ?? 0
  const depth = analysis?.depth ?? 0
  const lines = analysis?.lines ?? []
  const engineName = analysis?.engineName ?? 'Stockfish'

  return (
    <div
      style={{
        width: 440,
        height,
        backgroundColor: '#fff',
        borderRadius: 4,
        boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.07), inset 0 0 0 1px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 18px 12px',
          borderBottom: '1px solid #ebebeb',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: '-1px',
              color: scoreColor(score, mate),
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {scoreStr(score, mate)}
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              fontWeight: 500,
              color: analyzing ? '#7ecae8' : '#aaa',
              letterSpacing: '0.3px',
            }}
          >
            {analyzing ? 'analyzing…' : depth > 0 ? `depth ${depth}` : ''}
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#bbb', fontWeight: 500, letterSpacing: '0.2px' }}>
          {engineName}
        </div>
      </div>

      {/* Lines */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 12,
              padding: '10px 18px',
              borderBottom: i < lines.length - 1 ? '1px solid #f0f0f0' : undefined,
              alignItems: 'center',
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: scoreColor(line.score, line.mate),
                minWidth: 44,
                flexShrink: 0,
                fontVariantNumeric: 'tabular-nums',
                paddingTop: 1,
              }}
            >
              {scoreStr(line.score, line.mate)}
            </span>
            <span
              style={{
                fontSize: 12,
                color: '#444',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {formatMoves(line.moves, turn, fullMove)}
            </span>
          </div>
        ))}

        {lines.length === 0 && (
          <div style={{ padding: '16px 18px', fontSize: 12, color: '#bbb' }}>
            {analyzing ? 'Calculating…' : analysis === null ? 'Engine not available' : 'No moves'}
          </div>
        )}
      </div>
    </div>
  )
}
