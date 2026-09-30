const MOBILE_MEDIA = '(max-width: 639px), (hover: none) and (pointer: coarse)'

export function isMobileOfflineDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA).matches
}
