import type { Color } from '@/lib/chess/types'

interface Props {
  turn: Color
  isBookMove: boolean
}

export default function TopBar({ turn, isBookMove }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 22,
        background: '#fff',
        borderRadius: 11,
        padding: '16px 22px',
        marginBottom: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <span style={{ fontWeight: 600, fontSize: 17, letterSpacing: '-0.3px' }}>
          Chess<span style={{ color: '#2f6db0' }}>lab</span>
        </span>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9 }}>
        {isBookMove ? (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12,
              fontWeight: 600,
              color: 'oklch(0.48 0.11 155)',
              background: 'oklch(0.955 0.038 155)',
              padding: '6px 13px',
              borderRadius: 8,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'oklch(0.58 0.13 155)',
              }}
            />
            Book move
          </span>
        ) : (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#6a675f',
              background: '#f0efe9',
              padding: '6px 13px',
              borderRadius: 8,
            }}
          >
            Deviation
          </span>
        )}
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#6a675f',
            background: '#f0efe9',
            padding: '6px 13px',
            borderRadius: 8,
          }}
        >
          {turn === 'w' ? 'White to move' : 'Black to move'}
        </span>
      </div>
    </div>
  )
}
