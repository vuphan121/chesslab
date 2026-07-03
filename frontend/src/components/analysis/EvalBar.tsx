interface Props {
  score: number // centipawns, positive = white advantage
  mate: number // 0 = none; >0 = white mates; <0 = black mates
  height: number
}

function readout(score: number, mate: number): string {
  if (mate !== 0) return `#${mate}`
  const v = (Math.abs(score) / 100).toFixed(1)
  return score >= 0 ? `+${v}` : `-${v}`
}

export default function EvalBar({ score, mate, height }: Props) {
  let whitePct: number
  if (mate !== 0) {
    whitePct = mate > 0 ? 97 : 3
  } else {
    whitePct = Math.min(97, Math.max(3, 50 + 50 * Math.tanh(score / 400)))
  }

  return (
    <div
      style={{
        width: 15,
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
          bottom: 0,
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
      <div
        className="mono"
        style={{
          position: 'absolute',
          bottom: 4,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 8,
          fontWeight: 700,
          color: '#37383a',
        }}
      >
        {readout(score, mate)}
      </div>
    </div>
  )
}
