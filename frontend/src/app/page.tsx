'use client'

import Board from '@/components/board/Board'
import { useChessGame } from '@/hooks/useChessGame'

export default function Home() {
  const { boardState, selectSquare } = useChessGame()

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#e8e8e6] gap-6">
      <Board boardState={boardState} onSquareClick={selectSquare} squareSize={80} />

    </main>
  )
}
