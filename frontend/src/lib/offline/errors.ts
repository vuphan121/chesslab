export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status >= 500 && err.status <= 599
  if (err instanceof DOMException) return err.name === 'AbortError' || err.name === 'TimeoutError'
  return err instanceof TypeError
}
