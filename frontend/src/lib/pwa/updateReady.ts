export function updateReady(current: string | undefined, frontendLatest: unknown, backendBuild: string | null): string | null {
  if (typeof frontendLatest !== 'string' || frontendLatest === 'unknown' || frontendLatest === current) return null
  if (backendBuild !== null && backendBuild !== 'unknown' && backendBuild !== frontendLatest) return null
  return frontendLatest
}
