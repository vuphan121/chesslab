'use client'

import { useEffect, useRef, useState } from 'react'
import { analyzeGame, lookupAnalysis } from '@/lib/api/client'
import type { Analysis } from '@/lib/api/client'
import { acquireEngine, releaseEngine } from '@/lib/engine/browserEngine'
import type { BrowserEngine } from '@/lib/engine/browserEngine'
import { settingsSignature } from '@/lib/engine/settings'
import type { EngineSettings } from '@/lib/engine/settings'
import { positionKey } from '@/lib/chess/optimisticFen'

const START_DELAY_MS = 40
const LOOKUP_TIMEOUT_MS = 4000
const CACHE_LIMIT = 200
const LOOKUP_LINES = 5

interface Options {
  gameId: string | null
  fen: string | null
  gameOver: boolean
  enabled: boolean
  settings: EngineSettings
  immediate?: boolean
}

export interface EngineAnalysisState {
  analysis: Analysis | null
  analysisFen: string | null
  analyzing: boolean
  engineError: string | null
}

const IDLE: EngineAnalysisState = { analysis: null, analysisFen: null, analyzing: false, engineError: null }

export function useEngineAnalysis({ gameId, fen, gameOver, enabled, settings, immediate = false }: Options): EngineAnalysisState {
  const [state, setState] = useState<EngineAnalysisState>(IDLE)
  const engineRef = useRef<BrowserEngine | null>(null)
  const cacheRef = useRef(new Map<string, Analysis>())

  const signature = settingsSignature(settings)
  const { lines, hashMb, limit, useCloud } = settings
  const depth = limit === 'depth' ? settings.depth : 0
  const timeSec = limit === 'time' ? settings.timeSec : 0
  const active = enabled && !!fen && !!gameId && !gameOver
  const fenRef = useRef(fen)
  fenRef.current = fen
  const posKey = fen ? positionKey(fen) : null
  const immediateRef = useRef(immediate)
  immediateRef.current = immediate

  useEffect(() => {
    engineRef.current = acquireEngine()
    return () => {
      engineRef.current = null
      releaseEngine()
    }
  }, [])

  useEffect(() => {
    const engine = engineRef.current
    const fen = fenRef.current
    if (!active || !engine || !fen || !gameId || !posKey) return
    const key = `${posKey}|${signature}`
    let cancelled = false
    let stopJob: (() => void) | null = null
    const lookup = new AbortController()
    let lookupTimer: ReturnType<typeof setTimeout> | null = null

    const remember = (analysis: Analysis) => {
      const cache = cacheRef.current
      cache.delete(key)
      cache.set(key, analysis)
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
    }

    const run = () => {
      const hit = cacheRef.current.get(key)
      if (hit) {
        setState({ analysis: hit, analysisFen: fen, analyzing: false, engineError: null })
        return
      }
      setState((s) => ({ ...s, analyzing: true, engineError: null }))
      let localDepth = 0
      let settledByLookup = false

      const job = engine.start({
        fen,
        lines,
        hashMb,
        limit,
        depth,
        timeSec,
        onUpdate: (analysis) => {
          if (cancelled || settledByLookup) return
          localDepth = analysis.depth
          setState((s) => ({ ...s, analysis, analysisFen: fen }))
        },
      })
      stopJob = job.cancel

      job.done.then(async (result) => {
        if (cancelled || settledByLookup) return
        if (result.error) {
          try {
            const server = await analyzeGame(gameId, 'full', fen)
            if (cancelled) return
            remember(server)
            setState({ analysis: server, analysisFen: fen, analyzing: false, engineError: result.error })
          } catch {
            if (!cancelled) setState((s) => ({ ...s, analyzing: false, engineError: result.error ?? null }))
          }
          return
        }
        if (result.analysis && result.completed) remember(result.analysis)
        setState((s) => ({ ...s, analyzing: false }))
      })

      if (useCloud && limit !== 'infinite') {
        lookupTimer = setTimeout(() => lookup.abort(), LOOKUP_TIMEOUT_MS)
        lookupAnalysis(gameId, fen, lookup.signal, LOOKUP_LINES)
          .then((found) => {
            if (!found || cancelled || settledByLookup) return
            if (!found.tablebaseCategory && found.depth < localDepth) return
            if (!found.tablebaseCategory && (found.lines?.length ?? 1) < lines) return
            settledByLookup = true
            job.cancel()
            remember(found)
            setState({ analysis: found, analysisFen: fen, analyzing: false, engineError: null })
          })
          .catch(() => {})
          .finally(() => {
            if (lookupTimer) clearTimeout(lookupTimer)
          })
      }
    }

    const timer = setTimeout(run, cacheRef.current.has(key) || immediateRef.current ? 0 : START_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      if (lookupTimer) clearTimeout(lookupTimer)
      lookup.abort()
      stopJob?.()
    }
  }, [active, posKey, gameId, signature, lines, hashMb, limit, depth, timeSec, useCloud])

  return active ? state : { ...state, analyzing: false }
}
