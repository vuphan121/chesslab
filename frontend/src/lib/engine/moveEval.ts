import type { FenEval } from '@/lib/api/client'
import { BrowserEngine } from './browserEngine'
import type { EngineJob } from './browserEngine'

export const MOVE_EVAL_DEPTH = 14
const MOVE_EVAL_HASH_MB = 16

export class MoveEvaluator {
  private engine = new BrowserEngine()
  private job: EngineJob | null = null

  async evaluate(fen: string): Promise<FenEval | null> {
    const job = this.engine.start({
      fen,
      lines: 1,
      hashMb: MOVE_EVAL_HASH_MB,
      limit: 'depth',
      depth: MOVE_EVAL_DEPTH,
      timeSec: 0,
      onUpdate: () => {},
    })
    this.job = job
    const result = await job.done
    if (result.error) throw new Error(result.error)
    if (!result.completed || !result.analysis) return null
    return { score: result.analysis.score, mate: result.analysis.mate, depth: result.analysis.depth }
  }

  cancel(): void {
    this.job?.cancel()
  }

  dispose(): void {
    this.engine.dispose()
  }
}
