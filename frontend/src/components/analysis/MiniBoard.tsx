import Image from 'next/image'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

function parseFen(fen: string): Record<string, { type: string; color: string }> {
  const pieces: Record<string, { type: string; color: string }> = {}
  const rows = fen.split(' ')[0].split('/')
  for (let r = 0; r < 8; r++) {
    let f = 0
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') {
        f += parseInt(ch, 10)
      } else {
        pieces[`${FILES[f]}${RANKS[r]}`] = {
          color: ch === ch.toUpperCase() ? 'w' : 'b',
          type: ch.toLowerCase(),
        }
        f++
      }
    }
  }
  return pieces
}

interface Props {
  fen: string
  squareSize?: number
}

export default function MiniBoard({ fen, squareSize = 44 }: Props) {
  const pieces = parseFen(fen)
  const textureSize = squareSize * 8

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        borderRadius: 3,
        overflow: 'hidden',
        userSelect: 'none',
        boxShadow:
          '0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.14), inset 0 0 0 1px rgba(0,0,0,0.1)',
      }}
    >
      {RANKS.map((rank) => (
        <div key={rank} style={{ display: 'flex' }}>
          {FILES.map((file) => {
            const square = `${file}${rank}`
            const piece = pieces[square]
            const spriteCol = FILES.indexOf(file)
            const spriteRow = RANKS.indexOf(rank)

            return (
              <div
                key={square}
                style={{
                  width: squareSize,
                  height: squareSize,
                  backgroundImage: "url('/board-texture.png')",
                  backgroundSize: `${textureSize}px ${textureSize}px`,
                  backgroundPosition: `-${spriteCol * squareSize}px -${spriteRow * squareSize}px`,
                  position: 'relative',
                }}
              >
                {piece && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Image
                      src={`/pieces/${piece.color}${piece.type}.png`}
                      alt=""
                      width={squareSize * 0.85}
                      height={squareSize * 0.85}
                      style={{ width: squareSize * 0.85, height: squareSize * 0.85 }}
                      draggable={false}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
