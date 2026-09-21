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
    // Without forcing, rng=0.999 (near the top of the weighted range) would
    // pick the LAST reply — proving the forced branch, not chance, won here.
    expect(chosen?.reply.san).toBe('Bd3')
    expect(chosen?.nextTargetPath).toEqual(['Bd3', 'O-O'])
  })

  it('falls back to weighted random once the target path is exhausted, and records the run so far plus the choice', () => {
    const replies = [reply('Nf3', 'fenA'), reply('Bd3', 'fenB')]
    // One ply already played, target path has only 1 entry: we're asking for
    // index 1 (past the end).
    const chosen = chooseOpponentReply(replies, ['Bd3'], ['Bd3'], () => 0, () => 0.9)
    expect(chosen).not.toBeNull()
    // rng=0.9 with equal weights (both lapses=0) should land on the 2nd reply.
    expect(chosen?.reply.san).toBe('Bd3')
    expect(chosen?.nextTargetPath).toEqual(['Bd3', 'Bd3'])
  })

  it('replaces the target path with the actual run when it has diverged (index < length but no match)', () => {
    const replies = [reply('Nf3', 'fenA'), reply('e5', 'fenB')]
    // Index 0 has a recorded target of 'Bd3', but 'Bd3' isn't even a legal
    // reply here (the run took a different branch) — must fall back, and
    // the stale tail of the old target path must be discarded, not kept.
    const chosen = chooseOpponentReply(replies, ['Bd3', 'O-O', 'Qd2'], [], () => 0, () => 0.1)
    expect(chosen?.reply.san).toBe('Nf3')
    expect(chosen?.nextTargetPath).toEqual(['Nf3'])
  })

  it('weights by lapses (capped) when choosing freely', () => {
    const replies = [reply('Nf3', 'fenA'), reply('Bd3', 'fenB')]
    const lapsesFor = (fen: string) => (fen === 'fenB' ? 10 : 0) // capped at WEAKNESS_LAPSE_CAP=3
    // weights: Nf3 = 1, Bd3 = 1 + 0.75*3 = 3.25 -> total 4.25, Nf3 covers [0, 1/4.25)
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
    // The real "Do it again" bug. A run alternates the user's move and the
    // opponent's reply, and the hook indexes the target path by every ply
    // played (both sides). Free picks past the originally-recorded path used
    // to be stored at a slot that skipped the user's move in between, so on a
    // replay they were looked up at the wrong index, missed, and re-rolled.
    // Here the same run is played twice with DIFFERENT rng streams (standing
    // in for two separate Math.random() sequences); the picks must match
    // because free choices are recorded, not re-rolled.
    const branchesByReply: RepReply[][] = [
      [reply('Nc3', 'p1a'), reply('Nd2', 'p1b')], // the due line's own recorded reply
      [reply('e5', 'p2a'), reply('Qd2', 'p2b'), reply('a3', 'p2c')], // beyond the due path
      [reply('Bd3', 'p3a'), reply('Be2', 'p3b')], // also beyond
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

    // First run: only the first reply is "due" (forced, at ply index 1 —
    // after the user's own first move); everything after is a free choice.
    const firstRunTarget = { current: ['d6', 'Nc3'] as string[] | null }
    const firstPlayed = runOnce(firstRunTarget, 1)

    // "Do it again": the run's played-move list resets but the target path
    // carries over (what redoLine does). Different rng seed on purpose.
    const redoTarget = { current: firstRunTarget.current }
    const redoPlayed = runOnce(redoTarget, 999)

    expect(redoPlayed).toEqual(firstPlayed)
  })
})
