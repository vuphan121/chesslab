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

export async function copyPgnToClipboard(pgn: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(pgn)
      return
    }
  } catch {
    // Fall through for browsers that expose Clipboard API but deny the call.
  }

  const input = document.createElement('textarea')
  input.value = pgn
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('Could not copy PGN to the clipboard.')
}
