'use client'

import Image from 'next/image'
import { useState } from 'react'
import TopBar from '@/components/layout/TopBar'
import { pieceImagePath, useUserSettings } from '@/components/settings/UserSettingsProvider'
import type { PieceTheme } from '@/lib/api/client'
import { refreshOfflineData } from '@/lib/offline/refresh'

const THEMES: { id: PieceTheme; name: string; description: string }[] = [
  { id: 'classic', name: 'Classic', description: 'The original Chesslab piece set' },
  { id: 'glass', name: 'Glass', description: 'Chess.com’s translucent glass set' },
]

const PREVIEW_PIECES = ['wk.png', 'wq.png', 'wn.png', 'bp.png', 'br.png']

export default function SettingsPage() {
  const { settings, savePieceTheme } = useUserSettings()
  const [saving, setSaving] = useState<PieceTheme | null>(null)
  const [message, setMessage] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState('')

  const refreshOffline = async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMessage('')
    try {
      await refreshOfflineData()
      setRefreshMessage('Up to date. Close and reopen the app to use the newest version.')
    } catch {
      setRefreshMessage('Could not reach the server. Your saved data is unchanged.')
    } finally {
      setRefreshing(false)
    }
  }

  const chooseTheme = async (theme: PieceTheme) => {
    if (theme === settings.pieceTheme || saving) return
    setSaving(theme)
    setMessage('')
    try {
      await savePieceTheme(theme)
      setMessage('Saved to your account')
    } catch {
      setMessage('Could not save your setting. Please try again.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <main className="min-h-screen bg-[#e8e8e6] pb-6 sm:pb-10">
      <TopBar right={<span />} />
      <div style={{ width: 'min(1120px, calc(100vw - 32px))', margin: '0 auto' }}>

        <section
          style={{
            width: 'min(760px, 100%)',
            margin: '32px auto 0',
            background: '#fff',
            borderRadius: 14,
            padding: 'clamp(22px, 5vw, 42px)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
          }}
        >
          <p className="lbl" style={{ color: '#2f6db0', marginBottom: 8 }}>Settings</p>
          <h1 className="serif" style={{ fontSize: 32, fontWeight: 500, color: '#213744' }}>Piece style</h1>
          <p style={{ color: '#77736b', fontSize: 14, marginTop: 7, lineHeight: 1.55 }}>
            Choose the pieces shown on every Chesslab board. This preference follows your account.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: 14,
              marginTop: 26,
            }}
          >
            {THEMES.map((theme) => {
              const selected = settings.pieceTheme === theme.id
              return (
                <button
                  key={theme.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={saving !== null}
                  onClick={() => chooseTheme(theme.id)}
                  style={{
                    textAlign: 'left',
                    padding: 0,
                    overflow: 'hidden',
                    borderRadius: 12,
                    border: selected ? '2px solid #4a90d9' : '1px solid #ddd9d0',
                    background: '#faf9f6',
                    cursor: saving ? 'wait' : 'pointer',
                    boxShadow: selected ? '0 0 0 3px rgba(74,144,217,0.12)' : 'none',
                  }}
                >
                  <span
                    style={{
                      minHeight: 118,
                      padding: '18px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'linear-gradient(135deg, #d7e8f3 0 50%, #82a9c1 50% 100%)',
                    }}
                  >
                    {PREVIEW_PIECES.map((filename) => (
                      <Image
                        key={filename}
                        src={pieceImagePath(theme.id, filename)}
                        alt=""
                        width={62}
                        height={62}
                        draggable={false}
                        style={{ width: 62, height: 62, marginLeft: -7, filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.22))' }}
                      />
                    ))}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 16px' }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        border: selected ? '5px solid #4a90d9' : '2px solid #bbb7ae',
                        background: '#fff',
                        flex: '0 0 auto',
                      }}
                    />
                    <span>
                      <span style={{ display: 'block', color: '#2f2d29', fontWeight: 650, fontSize: 15 }}>{theme.name}</span>
                      <span style={{ display: 'block', color: '#8a867e', fontSize: 12, marginTop: 2 }}>{theme.description}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <div aria-live="polite" style={{ minHeight: 20, marginTop: 16, fontSize: 12, color: message.startsWith('Could') ? '#b3483f' : '#4d8062' }}>
            {saving ? 'Saving…' : message}
          </div>
        </section>

        <section
          style={{
            width: 'min(760px, 100%)',
            margin: '18px auto 0',
            background: '#fff',
            borderRadius: 14,
            padding: 'clamp(22px, 5vw, 42px)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
          }}
        >
          <button
            type="button"
            onClick={refreshOffline}
            disabled={refreshing}
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#fff',
              background: '#1c1b18',
              border: 'none',
              borderRadius: 999,
              padding: '13px 24px',
              cursor: refreshing ? 'wait' : 'pointer',
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh offline data'}
          </button>
          <div aria-live="polite" style={{ minHeight: 20, marginTop: 14, fontSize: 12, color: refreshMessage.startsWith('Could') ? '#b3483f' : '#4d8062' }}>
            {refreshMessage}
          </div>
        </section>

        <p className="mono" style={{ width: 'min(760px, 100%)', margin: '14px auto 0', fontSize: 12, color: '#8a867e' }}>
          Build {process.env.NEXT_PUBLIC_BUILD_ID}
        </p>
      </div>
    </main>
  )
}
