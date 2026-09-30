import { describe, expect, it } from 'vitest'
import { ApiError, isRetryable } from './errors'

describe('isRetryable', () => {
  it('keeps server failures for later sync', () => {
    expect(isRetryable(new ApiError('internal error', 500))).toBe(true)
    expect(isRetryable(new ApiError('unavailable', 503))).toBe(true)
  })

  it('does not retry permanent client failures', () => {
    expect(isRetryable(new ApiError('bad request', 400))).toBe(false)
    expect(isRetryable(new ApiError('not found', 404))).toBe(false)
  })
})
