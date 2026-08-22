import type { ReactNode } from 'react'
import type { Color } from '@/lib/chess/types'
import PageSwitcher from './PageSwitcher'
import { clearToken } from '@/lib/auth/token'

interface Props {
  turn?: Color
  isBookMove?: boolean


  right?: ReactNode
}

export default function TopBar({ turn, isBookMove, right }: Props) {
  return (
    <div
      className="flex-wrap"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 18,
        padding: 0,
        minHeight: 42,
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', padding: '2px 0' }}>
        <span style={{ fontWeight: 600, fontSize: 17, letterSpacing: '-0.3px' }}>
          Chess<span style={{ color: '#2f6db0' }}>lab</span>
        </span>
      </div>

      <PageSwitcher />

      <div className="gap-2 sm:gap-[9px]" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
        {right !== undefined ? (
          right
        ) : isBookMove ? (
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
        {right === undefined && turn && (
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
        )}
        <button
          onClick={() => clearToken()}
          title="Sign out"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#a3a099',
            background: 'transparent',
            border: 'none',
            padding: '6px 4px',
            cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
