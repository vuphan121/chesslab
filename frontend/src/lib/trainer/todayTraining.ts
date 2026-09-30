export interface TodayTrainingSettings {
  repertoireIds: string[]
}

export interface TodayTrainingEntry {
  repertoireId: string
  cardId: string
}

export interface TodayTrainingResponse {
  settings: TodayTrainingSettings | null
  entryCount: number
  nextEntry: TodayTrainingEntry | null
}

export interface TodayTrainingSnapshot {
  queueDate: string
  settings: TodayTrainingSettings | null
  entries: TodayTrainingEntry[]
}

export function summarizeTodayTraining(snapshot: TodayTrainingSnapshot): TodayTrainingResponse {
  return {
    settings: snapshot.settings,
    entryCount: snapshot.entries.length,
    nextEntry: snapshot.entries[0] ?? null,
  }
}

export function rotateTodayTraining(
  snapshot: TodayTrainingSnapshot,
  repertoireId: string,
  cardId: string,
): TodayTrainingSnapshot | null {
  const index = snapshot.entries.findIndex(
    (entry) => entry.repertoireId === repertoireId && entry.cardId === cardId,
  )
  if (index < 0) return null
  const entries = [...snapshot.entries]
  const [completed] = entries.splice(index, 1)
  entries.push(completed)
  return { ...snapshot, entries }
}
