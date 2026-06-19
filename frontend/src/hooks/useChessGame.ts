'use client'

import { useState, useCallback } from 'react'
import { Chess } from 'chess.js'
import type { BoardState, Square } from '@/lib/chess/types'

function buildBoardState(game: Chess, selectedSquare: Square | null, history: { from: Square; to: Square }[]): BoardState {
  const pieces: BoardState['pieces'] = {}
  const board = game.board()

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c]
      if (sq) {
        pieces[sq.square] = { type: sq.type, color: sq.color }
      }
    }
  }

  const legalMoves = selectedSquare
    ? game.moves({ square: selectedSquare as any, verbose: true }).map((m) => m.to)
    : []

  const lastMove = history.length > 0 ? history[history.length - 1] : null

  return {
    pieces,
    turn: game.turn(),
    selectedSquare,
    legalMoves,
    lastMove,
    isCheck: game.isCheck(),
    isGameOver: game.isGameOver(),
    gameOverReason: game.isCheckmate()
      ? 'checkmate'
      : game.isStalemate()
        ? 'stalemate'
        : game.isDraw()
          ? 'draw'
          : null,
  }
}

export function useChessGame() {
  const [game] = useState(() => new Chess())
  const [moveHistory, setMoveHistory] = useState<{ from: Square; to: Square }[]>([])
  const [boardState, setBoardState] = useState<BoardState>(() => buildBoardState(game, null, []))

  const selectSquare = useCallback(
    (square: Square) => {
      const current = boardState.selectedSquare

      // Clicking selected square deselects
      if (current === square) {
        setBoardState(buildBoardState(game, null, moveHistory))
        return
      }

      // Attempt move if a piece is selected and target is a legal move
      if (current && boardState.legalMoves.includes(square)) {
        const move = game.move({ from: current, to: square, promotion: 'q' })
        if (move) {
          const newHistory = [...moveHistory, { from: move.from, to: move.to }]
          setMoveHistory(newHistory)
          setBoardState(buildBoardState(game, null, newHistory))
          return
        }
      }

      // Select the clicked square if it has a piece of the current turn
      const piece = boardState.pieces[square]
      if (piece && piece.color === game.turn()) {
        setBoardState(buildBoardState(game, square, moveHistory))
      } else {
        setBoardState(buildBoardState(game, null, moveHistory))
      }
    },
    [game, boardState, moveHistory],
  )

  const reset = useCallback(() => {
    game.reset()
    setMoveHistory([])
    setBoardState(buildBoardState(game, null, []))
  }, [game])

  return { boardState, selectSquare, reset }
}
