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
    const chosen = chooseOpponentReply(replies, ['Bd3', 'O-O'], 0, () => 0, () => 0.999)
    // Without forcing, rng=0.999 (near the top of the weighted range) would
    // pick the LAST reply — proving the forced branch, not chance, won here.
    expect(chosen?.reply.san).toBe('Bd3')
    expect(chosen?.nextTargetPath).toEqual(['Bd3', 'O-O'])
  })

  it('falls back to weighted random once the target path is exhausted, and records the choice', () => {
    const replies = [reply('Nf3', 'fenA'), reply('Bd3', 'fenB')]
    // Target path has only 1 entry; we're asking for index 1 (past the end).
    const chosen = chooseOpponentReply(replies, ['Bd3'], 1, () => 0, () => 0.9)
    expect(chosen).not.toBeNull()
    // rng=0.9 with equal weights (both lapses=0) should land on the 2nd reply.
    expect(chosen?.reply.san).toBe('Bd3')
    // The free choice gets appended, extending the recorded path.
    expect(chosen?.nextTargetPath).toEqual(['Bd3', 'Bd3'])
  })

  it('truncates and overwrites the target path when the run has diverged (index < length but no match)', () => {
    const replies = [reply('Nf3', 'fenA'), reply('e5', 'fenB')]
    // Index 0 has a recorded target of 'Bd3', but 'Bd3' isn't even a legal
    // reply here (the run took a different branch) — must fall back, and
    // the stale tail of the old target path must be discarded, not kept.
    const chosen = chooseOpponentReply(replies, ['Bd3', 'O-O', 'Qd2'], 0, () => 0, () => 0.1)
    expect(chosen?.reply.san).toBe('Nf3')
    expect(chosen?.nextTargetPath).toEqual(['Nf3'])
  })

  it('weights by lapses (capped) when choosing freely', () => {
    const replies = [reply('Nf3', 'fenA'), reply('Bd3', 'fenB')]
    const lapsesFor = (fen: string) => (fen === 'fenB' ? 10 : 0) // capped at WEAKNESS_LAPSE_CAP=3
    // weights: Nf3 = 1, Bd3 = 1 + 0.75*3 = 3.25 -> total 4.25, Nf3 covers [0, 1/4.25)
    const justBelowSplit = 1 / 4.25 - 0.001
    const justAboveSplit = 1 / 4.25 + 0.001
    const low = chooseOpponentReply(replies, null, 0, lapsesFor, () => justBelowSplit)
    const high = chooseOpponentReply(replies, null, 0, lapsesFor, () => justAboveSplit)
    expect(low?.reply.san).toBe('Nf3')
    expect(high?.reply.san).toBe('Bd3')
  })

  it('returns null when there are no replies', () => {
    expect(chooseOpponentReply([], null, 0, () => 0, () => 0.5)).toBeNull()
  })

  it('REGRESSION: a full run replayed from the start reproduces the exact same line', () => {
    // Simulates the real "Do it again" bug: a run with a branch point PAST
    // the originally-due card's own recorded path (so the reply there used
    // to be plain Math.random() and could diverge on replay). Here we
    // reproduce that by running the full opponent-reply sequence once,
    // capturing the resulting target path, then replaying from index 0 with
    // that same target path and confirming every pick matches — even though
    // the "random" rng stream differs between the two runs (simulating two
    // separate Math.random() call sequences), because free choices beyond
    // the target are recorded, not re-rolled.
    const branchesByPly: RepReply[][] = [
      [reply('Nc3', 'p1a'), reply('Nd2', 'p1b')], // due card's own recorded reply ends here
      [reply('e5', 'p2a'), reply('Qd2', 'p2b'), reply('a3', 'p2c')], // beyond the due path — was random
      [reply('Bd3', 'p3a'), reply('Be2', 'p3b')], // also beyond — was random
    ]

    function runOnce(targetPathRef: { current: string[] | null }, rngSeed: number) {
      const rng = mulberry32(rngSeed)
      const picks: string[] = []
      for (let ply = 0; ply < branchesByPly.length; ply++) {
        const chosen = chooseOpponentReply(branchesByPly[ply], targetPathRef.current, ply, () => 0, rng)
        if (!chosen) break
        picks.push(chosen.reply.san)
        targetPathRef.current = chosen.nextTargetPath
      }
      return picks
    }

    // First run: only the first ply is "due" (forced); plies 1-2 are free
    // choices, made with rng seed 1.
    const firstRunTarget = { current: ['Nc3'] as string[] | null }
    const firstPicks = runOnce(firstRunTarget, 1)

    // "Do it again": runMoves reset (ply index starts back at 0), but the
    // target path carries over unchanged (this is what redoLine does — see
    // useTrainerSession.ts). Use a DIFFERENT rng seed, simulating a fresh
    // Math.random() stream — the old bug would let this diverge.
    const redoTarget = { current: firstRunTarget.current }
    const redoPicks = runOnce(redoTarget, 999)

    expect(redoPicks).toEqual(firstPicks)
  })
})
