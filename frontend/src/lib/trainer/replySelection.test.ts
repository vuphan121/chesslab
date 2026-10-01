import { describe, it, expect } from 'vitest'
import { chooseOpponentReply } from './replySelection'
import { mulberry32 } from './rng'
import type { RepReply } from './types'

function reply(san: string, fen: string, chapterIds: string[] = ['ch1']): RepReply {
  return { san, uci: san.toLowerCase(), fen, chapterIds }
}

describe('chooseOpponentReply', () => {
  it('forces the recorded target move when one is available at this index', () => {
    const replies = [reply('Nf3', 'fenA'), reply('Bd3', 'fenB'), reply('e5', 'fenC')]
    const chosen = chooseOpponentReply(replies, ['Bd3', 'O-O'], [], () => 0, () => 0.999)
    expect(chosen?.reply.san).toBe('Bd3')
    expect(chosen?.nextTargetPath).toEqual(['Bd3', 'O-O'])
  })

  it('falls back to weighted random once the target path is exhausted, and records the run so far plus the choice', () => {
    const replies = [reply('Nf3', 'fenA'), reply('Bd3', 'fenB')]
    const chosen = chooseOpponentReply(replies, ['Bd3'], ['Bd3'], () => 0, () => 0.9)
    expect(chosen).not.toBeNull()
    expect(chosen?.reply.san).toBe('Bd3')
    expect(chosen?.nextTargetPath).toEqual(['Bd3', 'Bd3'])
  })

  it('replaces the target path with the actual run when it has diverged (index < length but no match)', () => {
    const replies = [reply('Nf3', 'fenA'), reply('e5', 'fenB')]
    const chosen = chooseOpponentReply(replies, ['Bd3', 'O-O', 'Qd2'], [], () => 0, () => 0.1)
    expect(chosen?.reply.san).toBe('Nf3')
    expect(chosen?.nextTargetPath).toEqual(['Nf3'])
  })

  it('weights by lapses (capped) when choosing freely', () => {
    const replies = [reply('Nf3', 'fenA'), reply('Bd3', 'fenB')]
    const lapsesFor = (fen: string) => (fen === 'fenB' ? 10 : 0)
    const justBelowSplit = 1 / 4.25 - 0.001
    const justAboveSplit = 1 / 4.25 + 0.001
    const low = chooseOpponentReply(replies, null, [], lapsesFor, () => justBelowSplit)
    const high = chooseOpponentReply(replies, null, [], lapsesFor, () => justAboveSplit)
    expect(low?.reply.san).toBe('Nf3')
    expect(high?.reply.san).toBe('Bd3')
  })

  it('returns null when there are no replies', () => {
    expect(chooseOpponentReply([], null, [], () => 0, () => 0.5)).toBeNull()
  })

  it('REGRESSION: a full run replayed from the start reproduces the exact same line', () => {
    const branchesByReply: RepReply[][] = [
      [reply('Nc3', 'p1a'), reply('Nd2', 'p1b')],
      [reply('e5', 'p2a'), reply('Qd2', 'p2b'), reply('a3', 'p2c')],
      [reply('Bd3', 'p3a'), reply('Be2', 'p3b')],
    ]
    const userMoves = ['d6', 'g6', 'Bg7']

    function runOnce(targetPathRef: { current: string[] | null }, rngSeed: number) {
      const rng = mulberry32(rngSeed)
      const played: string[] = []
      for (let i = 0; i < branchesByReply.length; i++) {
        played.push(userMoves[i])
        const chosen = chooseOpponentReply(branchesByReply[i], targetPathRef.current, played, () => 0, rng)
        if (!chosen) break
        played.push(chosen.reply.san)
        targetPathRef.current = chosen.nextTargetPath
      }
      return played
    }

    const firstRunTarget = { current: ['d6', 'Nc3'] as string[] | null }
    const firstPlayed = runOnce(firstRunTarget, 1)

    const redoTarget = { current: firstRunTarget.current }
    const redoPlayed = runOnce(redoTarget, 999)

    expect(redoPlayed).toEqual(firstPlayed)
  })
})
