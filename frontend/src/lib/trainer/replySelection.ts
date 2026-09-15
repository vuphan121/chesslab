import type { RepReply } from './types'
import { weightedChoice } from './rng'

export const WEAKNESS_W = 0.75
// Same rationale as scheduler.ts's LAPSE_WEIGHT_CAP: without a cap, whichever
// branch currently has the most recorded lapses keeps getting more and more
// likely to be steered into every time, snowballing into one specific
// sub-line dominating a chapter's practice runs.
export const WEAKNESS_LAPSE_CAP = 3

export interface ChosenReply {
  reply: RepReply
  // The target path to store back into the caller's ref — grown by one
  // entry when this pick was "free" (not forced), so a later replay from
  // the same starting point reproduces this exact choice instead of
  // re-rolling it. Unchanged (same reference-equal-by-value) when the pick
  // was forced from an existing target entry.
  nextTargetPath: string[] | null
}

/**
 * Picks the opponent's reply at a branch point during a drill run.
 *
 * `targetPath`/`moveIndex` force the exact recorded continuation for as long
 * as one is available (reproducing the specific due line pickNext selected).
 * Once that recorded path is exhausted — or moveIndex is out of sync with it,
 * e.g. after the run diverged — the reply is chosen by weighted random
 * (favoring branches with more recorded lapses), and that choice is recorded
 * onto the returned targetPath so a later "Do it again" (which replays from
 * moveIndex 0 with the same starting targetPath) reproduces the exact same
 * line instead of re-rolling this part of it every time.
 */
export function chooseOpponentReply(
  replies: RepReply[],
  targetPath: string[] | null,
  moveIndex: number,
  lapsesFor: (fen: string) => number,
  rng: () => number,
): ChosenReply | null {
  if (replies.length === 0) return null

  if (targetPath && moveIndex < targetPath.length) {
    const forced = replies.find((r) => r.san === targetPath[moveIndex])
    if (forced) return { reply: forced, nextTargetPath: targetPath }
  }

  const reply = weightedChoice(
    replies,
    (r) => 1 + WEAKNESS_W * Math.min(lapsesFor(r.fen), WEAKNESS_LAPSE_CAP),
    rng,
  )
  const nextTargetPath = targetPath ? [...targetPath.slice(0, moveIndex), reply.san] : targetPath
  return { reply, nextTargetPath }
}
