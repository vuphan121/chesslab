'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  getWoodpeckerState,
  listWoodpeckerRuns,
  recordWoodpeckerAttempt,
  renameWoodpeckerRun,
  resetWoodpeckerRange,
  startWoodpeckerRun,
  unsolveWoodpeckerPuzzle,
  type WoodpeckerRun,
  type WoodpeckerState,
} from '@/lib/api/client'
import { buttonStyle, cardStyle, formatDuration, inputStyle, primaryButtonStyle, runLabel, solveRate } from './format'

type Dialog = 'new' | 'adjust' | null

export default function RunsTab({ onTrain }: { onTrain: (puzzle?: number) => void }) {
  const [runs, setRuns] = useState<WoodpeckerRun[] | null>(null)
  const [state, setState] = useState<WoodpeckerState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([listWoodpeckerRuns(), getWoodpeckerState()])
      setRuns(r)
      setState(s)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load runs.')
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void load())
  }, [load])

  const current = runs && state ? runs.find((r) => r.cycle === state.cycle) ?? null : null
  const total = state?.total ?? 0
  const done = current?.done ?? 0

  return (
    <div style={{ width: 'min(760px, calc(100vw - 32px))', margin: '16px auto 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <p role="alert" style={{ color: '#b34343', fontSize: 13 }}>
          {error}
        </p>
      )}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="lbl" style={{ color: '#b4b1a8' }}>
              Current run
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, marginTop: 2 }}>{state ? runLabel({ cycle: state.cycle, name: current?.name ?? '' }) : '…'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="tap" style={buttonStyle} onClick={() => setDialog('adjust')} disabled={!state}>
              Adjust
            </button>
            <button className="tap" style={primaryButtonStyle} onClick={() => onTrain()} disabled={!state}>
              Continue
            </button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 14 }}>
          <Metric label="Done" value={`${done} / ${total}`} />
          <Metric label="Solved" value={current ? `${solveRate(current)}%` : '–'} />
          <Metric label="Avg time" value={current && current.avgMs ? formatDuration(current.avgMs) : '–'} />
          <Metric label="Total time" value={current ? formatDuration(current.totalMs) : '–'} />
        </div>
        <div style={{ height: 8, borderRadius: 4, background: '#f0efe9', marginTop: 12, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${total ? (done / total) * 100 : 0}%`, background: '#4a90d9' }} />
        </div>
        {state && <div style={{ fontSize: 12, color: '#6a675f', marginTop: 6 }}>Next: puzzle {state.next}</div>}
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div className="lbl" style={{ color: '#b4b1a8' }}>
            Runs
          </div>
          <button className="tap" style={buttonStyle} onClick={() => setDialog('new')} disabled={!state}>
            New run
          </button>
        </div>
        {runs?.map((run) => {
          const active = run.cycle === state?.cycle
          const finished = run.done >= run.total
          return (
            <div key={run.cycle} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '9px 0', borderTop: '1px solid #f0efe9' }}>
              <span style={{ fontWeight: 600, minWidth: 56, whiteSpace: 'nowrap' }}>{runLabel(run)}</span>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 8,
                  background: active ? '#e8f3fd' : finished ? '#e9f5ea' : '#f0efe9',
                  color: active ? '#2f6db0' : finished ? '#3f7a45' : '#6a675f',
                }}
              >
                {active ? 'Active' : finished ? 'Done' : 'Stopped'}
              </span>
              <span style={{ flex: 1, color: '#6a675f', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {run.done}/{run.total} · {formatDuration(run.totalMs)}
              </span>
              <span style={{ fontWeight: 600 }}>{solveRate(run)}%</span>
            </div>
          )
        })}
        {runs && runs.length === 0 && <div style={{ fontSize: 13, color: '#6a675f', padding: '8px 0' }}>No runs yet</div>}
      </div>

      {dialog === 'new' && state && (
        <NewRunDialog
          nextCycle={state.cycle + (current && current.done < current.total ? 1 : 0)}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            void load()
          }}
        />
      )}
      {dialog === 'adjust' && state && (
        <AdjustDialog
          state={state}
          name={current?.name ?? ''}
          onClose={() => setDialog(null)}
          onChanged={() => void load()}
          onGoto={(n) => onTrain(n)}
        />
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f7f6f2', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 12, color: '#6a675f' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle, width: 'min(420px, 100%)', maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

function NewRunDialog({ nextCycle, onClose, onDone }: { nextCycle: number; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const start = async () => {
    setBusy(true)
    try {
      await startWoodpeckerRun('')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the run.')
      setBusy(false)
    }
  }
  return (
    <Overlay title="New run" onClose={onClose}>
      <div style={{ fontSize: 14 }}>Start Run {nextCycle}?</div>
      {error && (
        <p role="alert" style={{ color: '#b34343', fontSize: 13, marginTop: 8 }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="tap" style={buttonStyle} onClick={onClose}>
          Cancel
        </button>
        <button className="tap" style={primaryButtonStyle} onClick={start} disabled={busy}>
          Start
        </button>
      </div>
    </Overlay>
  )
}

function AdjustDialog({
  state,
  name,
  onClose,
  onChanged,
  onGoto,
}: {
  state: WoodpeckerState
  name: string
  onClose: () => void
  onChanged: () => void
  onGoto: (n: number) => void
}) {
  const [gotoN, setGotoN] = useState(String(state.next))
  const [unsolveN, setUnsolveN] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [newName, setNewName] = useState(name)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const valid = (v: string) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 1 && n <= state.total ? n : null
  }

  const run = async (action: () => Promise<unknown>, done: string) => {
    setError(null)
    setMessage(null)
    try {
      await action()
      setMessage(done)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  const skip = () =>
    run(
      () =>
        recordWoodpeckerAttempt({
          operationId: crypto.randomUUID(),
          cycle: state.cycle,
          puzzleNumber: state.next,
          solved: false,
          outcome: 'skipped',
          durationMs: 0,
        }),
      `Skipped puzzle ${state.next}`,
    )

  const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: '1px solid #f0efe9' }
  const numberInput = (value: string, set: (v: string) => void, placeholder: string) => (
    <input value={value} onChange={(e) => set(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={placeholder} style={{ ...inputStyle, width: 72 }} />
  )

  return (
    <Overlay title="Adjust run" onClose={onClose}>
      <div style={{ ...rowStyle, borderTop: 'none' }}>
        <span style={{ flex: 1, fontSize: 13 }}>Go to puzzle</span>
        {numberInput(gotoN, setGotoN, '#')}
        <button
          className="tap"
          style={buttonStyle}
          onClick={() => {
            const n = valid(gotoN)
            if (n) onGoto(n)
            else setError(`Enter 1 to ${state.total}`)
          }}
        >
          Go
        </button>
      </div>
      <div style={rowStyle}>
        <span style={{ flex: 1, fontSize: 13 }}>Skip puzzle {state.next}</span>
        <button className="tap" style={buttonStyle} onClick={skip}>
          Skip
        </button>
      </div>
      <div style={rowStyle}>
        <span style={{ flex: 1, fontSize: 13 }}>Mark unsolved</span>
        {numberInput(unsolveN, setUnsolveN, '#')}
        <button
          className="tap"
          style={buttonStyle}
          onClick={() => {
            const n = valid(unsolveN)
            if (n) void run(() => unsolveWoodpeckerPuzzle(state.cycle, n), `Puzzle ${n} marked unsolved`)
            else setError(`Enter 1 to ${state.total}`)
          }}
        >
          Mark
        </button>
      </div>
      <div style={rowStyle}>
        <span style={{ flex: 1, fontSize: 13 }}>Reset puzzles</span>
        {numberInput(from, setFrom, 'From')}
        {numberInput(to, setTo, 'To')}
        <button
          className="tap"
          style={buttonStyle}
          onClick={() => {
            const a = valid(from)
            const b = valid(to)
            if (a && b && a <= b) void run(() => resetWoodpeckerRange(state.cycle, a, b), `Reset puzzles ${a} to ${b}`)
            else setError('Enter a valid range')
          }}
        >
          Reset
        </button>
      </div>
      <div style={rowStyle}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`Run ${state.cycle}`} maxLength={80} style={{ ...inputStyle, flex: 1 }} />
        <button className="tap" style={buttonStyle} onClick={() => void run(() => renameWoodpeckerRun(state.cycle, newName), 'Renamed')}>
          Rename
        </button>
      </div>
      {message && <p style={{ color: '#3f7a45', fontSize: 13, marginTop: 8 }}>{message}</p>}
      {error && (
        <p role="alert" style={{ color: '#b34343', fontSize: 13, marginTop: 8 }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="tap" style={buttonStyle} onClick={onClose}>
          Close
        </button>
      </div>
    </Overlay>
  )
}
