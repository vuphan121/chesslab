interface Props {
  score: number // centipawns, positive = white advantage
  mate: number  // 0 = none; >0 = white mates; <0 = black mates
  height: number
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
        width: 14,
        height,
        borderRadius: 3,
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
        backgroundColor: '#333',
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: `${whitePct}%`,
          backgroundColor: '#f0ead6',
          transition: 'height 0.35s ease',
        }}
      />
    </div>
  )
}
