'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getUserSettings,
  saveUserSettings,
  type PieceTheme,
  type UserSettings,
} from '@/lib/api/client'

interface UserSettingsContextValue {
  settings: UserSettings
  savePieceTheme: (pieceTheme: PieceTheme) => Promise<void>
}

const DEFAULT_SETTINGS: UserSettings = { pieceTheme: 'classic' }
const UserSettingsContext = createContext<UserSettingsContextValue | null>(null)

export default function UserSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    getUserSettings()
      .then((loaded) => {
        if (active) setSettings(loaded)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
  }, [])

  const value = useMemo<UserSettingsContextValue>(() => ({
    settings,
    savePieceTheme: async (pieceTheme) => {
      const previous = settings
      setSettings({ pieceTheme })
      try {
        const saved = await saveUserSettings({ pieceTheme })
        setSettings(saved)
      } catch (error) {
        setSettings(previous)
        throw error
      }
    },
  }), [settings])

  if (!ready) return null
  return <UserSettingsContext.Provider value={value}>{children}</UserSettingsContext.Provider>
}

export function useUserSettings(): UserSettingsContextValue {
  const context = useContext(UserSettingsContext)
  if (!context) throw new Error('useUserSettings must be used within UserSettingsProvider')
  return context
}

export function pieceImagePath(theme: PieceTheme, filename: string): string {
  return theme === 'glass' ? `/pieces/glass/${filename}` : `/pieces/${filename}`
}
