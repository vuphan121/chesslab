'use client'

import { useState, type FormEvent } from 'react'
import { login } from '@/lib/api/client'
import { setToken } from '@/lib/auth/token'





export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username || !password || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const { token } = await login(username, password)
      setToken(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#e8e8e6] px-4">
      <div
        style={{
          width: 'min(360px, 100%)',
          background: '#fff',
          borderRadius: 11,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
          padding: '28px 28px 24px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <span style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-0.3px' }}>
            Chess<span style={{ color: '#2f6db0' }}>lab</span>
          </span>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="lbl" style={{ color: '#b4b1a8' }} htmlFor="login-username">
              Username
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                fontSize: 16,
                padding: '10px 12px',
                border: '1px solid #eae8e2',
                borderRadius: 8,
                background: '#fbfaf7',
                color: '#37352f',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="lbl" style={{ color: '#b4b1a8' }} htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                fontSize: 16,
                padding: '10px 12px',
                border: '1px solid #eae8e2',
                borderRadius: 8,
                background: '#fbfaf7',
                color: '#37352f',
              }}
            />
          </div>

          {error && <p style={{ fontSize: 12, color: '#c0392b', margin: 0 }}>{error}</p>}

          <button
            type="submit"
            disabled={submitting || !username || !password}
            style={{
              marginTop: 4,
              fontSize: 13,
              fontWeight: 600,
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: submitting || !username || !password ? '#a9c9e8' : '#4a90d9',
              color: '#fff',
              cursor: submitting || !username || !password ? 'default' : 'pointer',
            }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}
