import type { ReactNode } from 'react'
import PageSwitcher from './PageSwitcher'
import { clearToken } from '@/lib/auth/token'

interface Props {
  leftExtra?: ReactNode
  right?: ReactNode
}

export default function TopBar({ leftExtra, right }: Props) {
  return (
    <div
      className="topbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        width: '100%',
        background: '#fff',
        boxShadow: '0 1px 0 rgba(28,27,24,0.07), 0 4px 16px rgba(28,27,24,0.03)',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', padding: '2px 0' }}>
        <span style={{ fontWeight: 600, fontSize: 17, letterSpacing: '-0.3px' }}>
          Chess<span style={{ color: '#2f6db0' }}>lab</span>
        </span>
      </div>

      {leftExtra}

      <PageSwitcher />

      <div className="gap-2 sm:gap-[9px]" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
        {right}
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
