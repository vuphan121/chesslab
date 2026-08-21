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
    <main className="relative isolate flex min-h-[100svh] items-center justify-center overflow-hidden px-6 py-10 sm:px-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-cover bg-[position:65%_center] sm:bg-center"
        style={{ backgroundImage: "url('/login-background.png')" }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(110deg,rgba(246,241,227,0.24),rgba(246,241,227,0.04)_55%,rgba(22,54,79,0.16))]"
      />
      <div
        style={{
          width: 'min(330px, 100%)',
        }}
      >
        <div style={{ marginBottom: 22 }}>
          <span style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-0.3px' }}>
            Chess<span style={{ color: '#2f6db0' }}>lab</span>
          </span>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="lbl" style={{ color: '#294b60', textShadow: '0 1px 8px rgba(255,255,255,0.5)' }} htmlFor="login-username">
              Username
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="backdrop-blur-sm"
              style={{
                fontSize: 16,
                padding: '10px 12px',
                border: '1px solid rgba(255, 255, 255, 0.6)',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.24)',
                color: '#37352f',
                boxShadow: '0 3px 12px rgba(20, 42, 58, 0.08)',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="lbl" style={{ color: '#294b60', textShadow: '0 1px 8px rgba(255,255,255,0.5)' }} htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="backdrop-blur-sm"
              style={{
                fontSize: 16,
                padding: '10px 12px',
                border: '1px solid rgba(255, 255, 255, 0.6)',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.24)',
                color: '#37352f',
                boxShadow: '0 3px 12px rgba(20, 42, 58, 0.08)',
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
