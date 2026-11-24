export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} m`
  if (m > 0) return `${m} m ${String(s).padStart(2, '0')} s`
  return `${s} s`
}

export function runLabel(run: { cycle: number; name: string }): string {
  return run.name ? run.name : `Run ${run.cycle}`
}

export function solveRate(run: { done: number; solved: number; half: number }): number {
  return run.done > 0 ? Math.round(((run.solved + run.half / 2) / run.done) * 100) : 0
}

export const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 11,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
  padding: 'clamp(14px, 3vw, 22px)',
}

export const buttonStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '10px 14px',
  borderRadius: 8,
  cursor: 'pointer',
  border: '1px solid #d9d6cf',
  background: '#fbfaf7',
  color: '#37352f',
}

export const primaryButtonStyle: React.CSSProperties = { ...buttonStyle, background: '#4a90d9', borderColor: '#4a90d9', color: '#fff' }

export const inputStyle: React.CSSProperties = {
  fontSize: 16,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #d9d6cf',
  background: '#fff',
  color: '#37352f',
  minWidth: 0,
}
