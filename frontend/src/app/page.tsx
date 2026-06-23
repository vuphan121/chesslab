'use client'

import Board from '@/components/board/Board'
import EvalBar from '@/components/analysis/EvalBar'
import TopLines from '@/components/analysis/TopLines'
import { useChessGame } from '@/hooks/useChessGame'

const SQUARE_SIZE = 80
const BOARD_SIZE = SQUARE_SIZE * 8

export default function Home() {
  const { boardState, selectSquare, move, legalMovesFor, analysis, analyzing } = useChessGame()

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#e8e8e6]">
      {boardState && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 120 }}>
          <Board
            boardState={boardState}
            onSquareClick={selectSquare}
            onMove={move}
            legalMovesFor={legalMovesFor}
            bestMove={analysis?.bestMove}
            squareSize={SQUARE_SIZE}
          />
          <EvalBar
            score={analysis?.score ?? 0}
            mate={analysis?.mate ?? 0}
            height={BOARD_SIZE}
          />
          <TopLines
            analysis={analysis}
            analyzing={analyzing}
            turn={boardState.turn}
            fullMove={boardState.fullMove}
            height={BOARD_SIZE}
          />
        </div>
      )}
    </main>
  )
}
