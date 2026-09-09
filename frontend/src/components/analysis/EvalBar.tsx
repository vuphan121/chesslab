interface Props {
  score: number
  mate: number
  height: number
  /** Board orientation. When true, White's fill grows from the top (Black at bottom), Lichess-style. */
  flipped?: boolean
  /** Show the numeric readout on the bar. Off when there's no real analysis yet. */
  hasEval?: boolean
}

function label(score: number, mate: number): string {
  if (mate !== 0) return `M${Math.abs(mate)}`
  const abs = Math.abs(score) / 100
  return abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)
}

export default function EvalBar({ score, mate, height, flipped = false, hasEval = true }: Props) {
  let whitePct: number
  if (mate !== 0) {
    whitePct = mate > 0 ? 97 : 3
  } else {
    whitePct = Math.min(97, Math.max(3, 50 + 50 * Math.tanh(score / 400)))
  }

  const whiteBetter = mate !== 0 ? mate > 0 : score >= 0
  // The number sits at the end of the bar the winning side occupies.
  const numberAtBottom = whiteBetter !== flipped

  return (
    <div
      style={{
        width: 22,
        height,
        borderRadius: 4,
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
        backgroundColor: '#37383a',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          [flipped ? 'top' : 'bottom']: 0,
          left: 0,
          right: 0,
          height: `${whitePct}%`,
          backgroundColor: '#f1f1ee',
          transition: 'height 0.35s ease',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          height: 1,
          background: 'rgba(0,0,0,0.22)',
        }}
      />
      {hasEval && (
        <span
          className="mono"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            [numberAtBottom ? 'bottom' : 'top']: 2,
            textAlign: 'center',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '-0.3px',
            lineHeight: 1,
            color: whiteBetter ? '#3d3d3a' : '#e9e9e6',
            pointerEvents: 'none',
          }}
        >
          {label(score, mate)}
        </span>
      )}
    </div>
  )
}
