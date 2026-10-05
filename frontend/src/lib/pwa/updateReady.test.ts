import { describe, expect, it } from 'vitest'
import { updateReady } from './updateReady'

describe('updateReady', () => {
  it('waits when the frontend is unchanged or unknown', () => {
    expect(updateReady('aaa1111', 'aaa1111', 'aaa1111')).toBeNull()
    expect(updateReady('aaa1111', 'unknown', 'aaa1111')).toBeNull()
    expect(updateReady('aaa1111', undefined, 'aaa1111')).toBeNull()
  })

  it('waits while the backend is still on another commit', () => {
    expect(updateReady('aaa1111', 'bbb2222', 'aaa1111')).toBeNull()
  })

  it('offers the update once both report the new commit', () => {
    expect(updateReady('aaa1111', 'bbb2222', 'bbb2222')).toBe('bbb2222')
  })

  it('does not block on a backend with no version endpoint or an unknown build', () => {
    expect(updateReady('aaa1111', 'bbb2222', null)).toBe('bbb2222')
    expect(updateReady('aaa1111', 'bbb2222', 'unknown')).toBe('bbb2222')
  })
})
