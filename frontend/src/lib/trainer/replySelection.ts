import type { RepReply } from './types'
import { weightedChoice } from './rng'

export const WEAKNESS_W = 0.75
export const WEAKNESS_LAPSE_CAP = 3

export interface ChosenReply {
  reply: RepReply
  nextTargetPath: string[] | null
}

export function chooseOpponentReply(
  replies: RepReply[],
  targetPath: string[] | null,
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
