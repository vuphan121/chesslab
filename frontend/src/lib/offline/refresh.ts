import { flushProgressOutbox, refreshAllCachedData } from '@/lib/api/client'

const SHELL_REFRESH_TIMEOUT_MS = 90000

function refreshAppShell(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(true)
  return navigator.serviceWorker.getRegistration().then(
    (reg) =>
      new Promise<boolean>((resolve) => {
        const worker = reg?.active
        if (!worker) {
          resolve(true)
          return
        }
        const channel = new MessageChannel()
        const timer = setTimeout(() => resolve(false), SHELL_REFRESH_TIMEOUT_MS)
        channel.port1.onmessage = (event) => {
          clearTimeout(timer)
          resolve(!!event.data?.ok)
        }
        worker.postMessage({ type: 'REFRESH_SHELL' }, [channel.port2])
      }),
  )
}

export async function refreshOfflineData(opts: { includeCatalog?: boolean } = {}): Promise<void> {
  await flushProgressOutbox()
  const dataRefresh = opts.includeCatalog === false ? Promise.resolve() : refreshAllCachedData()
  const [, shellOk] = await Promise.all([dataRefresh, refreshAppShell()])
  if (!shellOk) throw new Error('The app files could not be refreshed.')
}
