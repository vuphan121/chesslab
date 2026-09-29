import { Chess } from 'chess.js'

interface LinePgnInput {
  repertoireName: string
  chapterName: string
  startFen: string
  fallbackFen: string
  leadingSans: string[]
  runSans: string[]
  side: 'w' | 'b'
  date?: Date
}

function replay(startFen: string, sans: string[]): Chess | null {
  try {
    const chess = new Chess(startFen)
    for (const san of sans) chess.move(san)
    return chess
  } catch {
    return null
  }
}

export function buildLinePgn(input: LinePgnInput): string | null {
  const full = [...input.leadingSans, ...input.runSans]
  let chess = replay(input.startFen, full)
  if (!chess) chess = replay(input.fallbackFen, input.runSans)
  if (!chess) return null
  const d = input.date ?? new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  chess.setHeader('Event', `${input.repertoireName}: ${input.chapterName}`)
  chess.setHeader('Site', 'Chesslab')
  chess.setHeader('Date', `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`)
  chess.setHeader('Round', '-')
  chess.setHeader('White', input.side === 'w' ? 'Repertoire' : 'Opponent')
  chess.setHeader('Black', input.side === 'b' ? 'Repertoire' : 'Opponent')
  chess.setHeader('Result', '*')
  return chess.pgn()
}

export function pgnFileName(repertoireName: string, chapterName: string): string {
  const slug = `${repertoireName}-${chapterName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'line'}.pgn`
}

export function downloadPgn(pgn: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
