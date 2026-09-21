import type { RepReply } from './types'
import { weightedChoice } from './rng'

export const WEAKNESS_W = 0.75
// Without a cap, whichever branch currently has the most recorded lapses
// keeps getting more and more likely to be steered into every time,
// snowballing into one specific sub-line dominating a chapter's practice
// runs.
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
 * `targetPath` forces the exact recorded continuation for as long as one is
 * available (reproducing the specific line the run was started for). Once
 * that recorded path is exhausted — or no longer matches, e.g. after the run
 * diverged — the reply is chosen by weighted random (favoring branches with
 * more recorded lapses), and the returned targetPath becomes the whole run so
 * far plus that choice, so a later "Do it again" (which replays from the same
 * start with that targetPath) reproduces the exact same line instead of
 * re-rolling this part of it every time.
 */
export function chooseOpponentReply(
  replies: RepReply[],
  targetPath: string[] | null,
  // SAN of every ply played so far this run, BOTH sides' — the target path is
  // indexed the same way (it's a plain SAN path from the run's start), so the
  // reply we're choosing now sits at index playedSans.length. An earlier
  // version took a bare index and recorded a free pick at a slot that skipped
  // the user's move in between, so a replay only ever reproduced the forced
  // part of a line and re-rolled the rest.
  playedSans: string[],
  lapsesFor: (fen: string) => number,
  rng: () => number,
): ChosenReply | null {
  if (replies.length === 0) return null
  const moveIndex = playedSans.length

  if (targetPath && moveIndex < targetPath.length) {
    const forced = replies.find((r) => r.san === targetPath[moveIndex])
    if (forced) return { reply: forced, nextTargetPath: targetPath }
  }

  const reply = weightedChoice(
    replies,
    (r) => 1 + WEAKNESS_W * Math.min(lapsesFor(r.fen), WEAKNESS_LAPSE_CAP),
    rng,
  )
  const nextTargetPath = targetPath ? [...playedSans, reply.san] : targetPath
  return { reply, nextTargetPath }
}
