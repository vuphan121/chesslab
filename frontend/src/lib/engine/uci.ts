export interface UciInfo {
  depth: number
  multipv: number
  scoreKind: 'cp' | 'mate'
  scoreValue: number
  bound: 'lower' | 'upper' | null
  nodes: number
  nps: number
  timeMs: number
  pv: string[]
}

export function parseInfo(line: string): UciInfo | null {
  if (!line.startsWith('info ')) return null
  const t = line.split(/\s+/)
  let depth = 0
  let multipv = 1
  let scoreKind: 'cp' | 'mate' | null = null
  let scoreValue = 0
  let bound: 'lower' | 'upper' | null = null
  let nodes = 0
  let nps = 0
  let timeMs = 0
  let pv: string[] = []
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'string':
        return null
      case 'depth':
        depth = Number(t[++i])
        break
      case 'multipv':
        multipv = Number(t[++i])
        break
      case 'nodes':
        nodes = Number(t[++i])
        break
      case 'nps':
        nps = Number(t[++i])
        break
      case 'time':
        timeMs = Number(t[++i])
        break
      case 'score':
        scoreKind = t[++i] === 'mate' ? 'mate' : 'cp'
        scoreValue = Number(t[++i])
        break
      case 'lowerbound':
        bound = 'lower'
        break
      case 'upperbound':
        bound = 'upper'
        break
      case 'pv':
        pv = t.slice(i + 1)
        i = t.length
        break
    }
  }
  if (scoreKind === null || pv.length === 0 || !Number.isFinite(depth) || depth < 1) return null
  return { depth, multipv, scoreKind, scoreValue, bound, nodes, nps, timeMs, pv }
}
