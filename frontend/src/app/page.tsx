'use client'

import Board from '@/components/board/Board'
import { useChessGame } from '@/hooks/useChessGame'

export default function Home() {
  const { boardState, selectSquare, reset } = useChessGame()

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#1e1e1e] gap-6">
      <Board boardState={boardState} onSquareClick={selectSquare} squareSize={80} />

      <div className="flex gap-4 items-center">
        {boardState.isGameOver && (
          <span className="text-white font-semibold">
            Game over: {boardState.gameOverReason}
          </span>
        )}
        <button
          onClick={reset}
          className="px-4 py-2 bg-[#4a90d9] text-white rounded font-semibold hover:bg-[#357abd] transition-colors"
        >
          New Game
        </button>
      </div>
    </main>
  )
}
