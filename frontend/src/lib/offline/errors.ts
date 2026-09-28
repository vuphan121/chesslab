export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 502 || err.status === 503 || err.status === 504
  if (err instanceof DOMException) return err.name === 'AbortError' || err.name === 'TimeoutError'
  return err instanceof TypeError
}
