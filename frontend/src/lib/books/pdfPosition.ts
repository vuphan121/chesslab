const KEY_PREFIX = 'chesslab.pdfbook.page.'

export function getLastPdfPage(bookId: string): number {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + bookId)
    const page = raw ? Number.parseInt(raw, 10) : 1
    return Number.isFinite(page) && page > 0 ? page : 1
  } catch {
    return 1
  }
}

export function saveLastPdfPage(bookId: string, page: number): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + bookId, String(page))
  } catch {}
}
