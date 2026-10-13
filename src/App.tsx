import { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Cpu,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Square,
  Terminal,
  Thermometer,
  Trash2,
  Unplug,
  X,
  Zap,
} from 'lucide-react'
import './App.css'

type Model = {
  name: string
  model: string
  size: number
  details?: { family?: string; parameter_size?: string; quantization_level?: string }
}

type RunningModel = { name: string; size: number; processor?: string; context?: number; until?: string }

type GpuStats = {
  name: string
  vramTotalMiB: number | null
  vramUsedMiB: number | null
  temperatureC: number | null
  utilizationPercent: number | null
  fanPercent: number | null
  powerWatts: number | null
}

type Status = {
  connected: boolean
  canUninstall: boolean
  ollamaUrl: string
  error: string | null
  models: Model[]
  running: RunningModel[]
  gpu: GpuStats | null
  settings: { gpuOverheadBytes: string | null; keepAlive: string | null }
  monitoredAt: string
}

type ActivityEvent = {
  id: string
  timestamp: string
  category: 'inference' | 'control'
  method?: string
  endpoint?: string
  model?: string
  statusCode?: number
  durationMs?: number
  action?: string
  modelCount?: number
}

type DialogState =
  | { kind: 'remove'; model: string }
  | { kind: 'uninstall'; removeModels: boolean }
  | { kind: 'clear' }
  | null

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`)
  return result as T
}

function formatSize(bytes: number | undefined) {
  if (!bytes) return '0 GB'
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function formatTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(timestamp))
}

function actionLabel(action?: string) {
  if (action === 'stop-all') return 'Stopped loaded models'
  if (action === 'model-stopped') return 'Stopped model'
  if (action === 'model-removed') return 'Removed model'
  if (action === 'ollama-uninstalled') return 'Uninstalled Ollama'
  return action ?? 'Control action'
}

function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [dialog, setDialog] = useState<DialogState>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [copied, setCopied] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const [nextStatus, nextActivity] = await Promise.all([
          requestJson<Status>('/api/status'),
          requestJson<{ events: ActivityEvent[] }>('/api/activity?limit=100'),
        ])
        if (!active) return
        setStatus(nextStatus)
        setEvents(nextActivity.events)
        setConnectionError('')
      } catch (error) {
        if (active) setConnectionError(error instanceof Error ? error.message : 'Dashboard service is unavailable.')
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [reload])

  async function runAction(key: string, path: string, options: RequestInit, message: string) {
    setBusy(key)
    setNotice('')
    try {
      await requestJson(path, options)
      setNotice(message)
      setReload((value) => value + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The action could not be completed.')
    } finally {
      setBusy('')
      setDialog(null)
    }
  }

  function jsonOptions(body: object): RequestInit {
    return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  }

  async function copyAgentUrl() {
    try {
      await navigator.clipboard.writeText('http://127.0.0.1:3210/ollama')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setNotice('Clipboard access was denied. Select the URL to copy it manually.')
    }
  }

  const gpu = status?.gpu
  const usedMiB = gpu?.vramUsedMiB ?? 0
  const totalMiB = gpu?.vramTotalMiB ?? 0
  const reservedMiB = Number(status?.settings.gpuOverheadBytes ?? 0) / (1024 * 1024)
  const vramPercent = totalMiB ? Math.min(100, (usedMiB / totalMiB) * 100) : 0
  const reservePercent = totalMiB ? Math.min(100, (reservedMiB / totalMiB) * 100) : 0
  const activeNames = new Set(status?.running.map((model) => model.name) ?? [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Local Model Control home">
          <span className="brand-mark"><Cpu size={18} strokeWidth={2.2} /></span>
          <span>Local Model <b>Control</b></span>
        </a>
        <div className="topbar-right">
          <span className={`connection ${status?.connected ? 'is-online' : 'is-offline'}`}><span className="connection-dot" />{status?.connected ? 'OLLAMA ONLINE' : 'OLLAMA OFFLINE'}</span>
          <button className="button button-quiet top-refresh" onClick={() => setReload((value) => value + 1)} title="Refresh status"><RefreshCw size={15} /><span>Refresh</span></button>
        </div>
      </header>

      <main id="top" className="main-content">
        <section className="page-heading">
          <div>
            <p className="eyebrow"><span className="eyebrow-line" /> LOCAL INFERENCE / OPERATIONS</p>
            <h1>Model control room</h1>
            <p className="heading-copy">Runtime health, GPU headroom, and activity routed through this dashboard.</p>
          </div>
          <button className="button button-stop-all" disabled={!status?.running.length || Boolean(busy)} onClick={() => void runAction('stop-all', '/api/stop-all', jsonOptions({}), 'All loaded models stopped.')}>
            {busy === 'stop-all' ? <LoaderCircle className="spin" size={16} /> : <Square size={15} fill="currentColor" />} Stop all
          </button>
        </section>

        {connectionError && <div className="notice notice-error"><Unplug size={16} /> {connectionError}</div>}
        {notice && <div className="notice"><CheckCircle2 size={16} /><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={15} /></button></div>}

        <section className="metric-grid" aria-label="Live system metrics">
          <article className="metric metric-vram">
            <div className="metric-top"><span className="metric-label">GPU MEMORY</span><HardDrive size={16} /></div>
            <div className="metric-value">{gpu?.vramUsedMiB == null ? '—' : formatSize(usedMiB * 1024 ** 2)}<small> / {gpu?.vramTotalMiB == null ? '—' : formatSize(totalMiB * 1024 ** 2)}</small></div>
            <div className="meter" aria-label={`GPU memory ${Math.round(vramPercent)} percent used`}><span className="meter-used" style={{ width: `${vramPercent}%` }} /><span className="meter-reserved" style={{ left: `${100 - reservePercent}%`, width: `${reservePercent}%` }} /></div>
            <div className="metric-foot"><span>Model allocation</span><span>{reservedMiB ? `${formatSize(reservedMiB * 1024 ** 2)} reserved for other apps` : 'Reserve not detected'}</span></div>
          </article>

          <article className="metric metric-temp">
            <div className="metric-top"><span className="metric-label">GPU TEMPERATURE</span><Thermometer size={16} /></div>
            <div className="metric-value">{gpu?.temperatureC == null ? '—' : `${Math.round(gpu.temperatureC)}°`}<small>{gpu?.temperatureC == null ? '' : ' C'}</small></div>
            <div className="metric-foot"><span>{gpu?.utilizationPercent == null ? 'GPU utilization unavailable' : `${Math.round(gpu.utilizationPercent)}% utilization`}</span><span>{gpu?.powerWatts == null ? '—' : `${gpu.powerWatts.toFixed(1)} W`}</span></div>
          </article>

          <article className="metric metric-loaded">
            <div className="metric-top"><span className="metric-label">LOADED MODELS</span><Zap size={16} /></div>
            <div className="metric-value">{status?.running.length ?? '—'}<small> active</small></div>
            <div className="metric-foot"><span>{status?.models.length ?? '—'} installed locally</span><span>{gpu?.fanPercent == null ? 'Fan RPM unavailable' : `Fan ${gpu.fanPercent}%`}</span></div>
          </article>

          <article className="metric metric-keepalive">
            <div className="metric-top"><span className="metric-label">IDLE UNLOAD</span><Clock3 size={16} /></div>
            <div className="metric-value">{status?.settings.keepAlive ?? '—'}<small> timeout</small></div>
            <div className="metric-foot"><span>GPU reserve for other work</span><span>{status?.settings.gpuOverheadBytes ? formatSize(Number(status.settings.gpuOverheadBytes)) : 'Not configured'}</span></div>
          </article>
        </section>

        <div className="workspace-grid">
          <section className="panel models-panel">
            <div className="section-heading"><div><p className="section-kicker">RUNTIME</p><h2>Installed models</h2></div><span className="count-label">{status?.models.length ?? 0} MODELS</span></div>
            <div className="model-list">
              {status?.models.length ? status.models.map((model) => {
                const loaded = activeNames.has(model.name)
                return <article className="model-row" key={model.name}>
                  <div className="model-symbol"><Cpu size={17} /></div>
                  <div className="model-main">
                    <div className="model-title-line"><h3>{model.name}</h3><span className={`state-chip ${loaded ? 'state-loaded' : 'state-idle'}`}><span />{loaded ? 'LOADED' : 'IDLE'}</span></div>
                    <p>{model.details?.parameter_size ?? 'Local model'} <span>·</span> {model.details?.quantization_level ?? 'Quantization n/a'} <span>·</span> {formatSize(model.size)}</p>
                  </div>
                  <div className="model-actions">
                    {loaded && <button className="icon-button stop-model" title={`Stop ${model.name}`} aria-label={`Stop ${model.name}`} disabled={Boolean(busy)} onClick={() => void runAction(`stop-${model.name}`, '/api/models/stop', jsonOptions({ model: model.name }), `${model.name} stopped.`)}><Square size={15} fill="currentColor" /></button>}
                    <button className="icon-button delete-model" title={`Remove ${model.name}`} aria-label={`Remove ${model.name}`} disabled={Boolean(busy)} onClick={() => setDialog({ kind: 'remove', model: model.name })}><Trash2 size={16} /></button>
                  </div>
                </article>
              }) : <div className="empty-state"><HardDrive size={22} /><p>{status?.connected ? 'No models installed.' : 'Waiting for the Ollama runtime.'}</p></div>}
            </div>
            <div className="models-foot"><ShieldCheck size={15} /><span>Models stay on this device. Removing one deletes its local files.</span></div>
          </section>

          <section className="panel activity-panel">
            <div className="section-heading"><div><p className="section-kicker">REQUEST LEDGER</p><h2>Recent activity</h2></div><button className="text-button" onClick={() => setDialog({ kind: 'clear' })} disabled={!events.length}>Clear log</button></div>
            <div className="activity-head"><span>EVENT / MODEL</span><span>RESULT</span><span>TIME</span></div>
            <div className="activity-list">
              {events.length ? events.slice(0, 12).map((event) => {
                const isInference = event.category === 'inference'
                const success = (event.statusCode ?? 500) < 400
                return <article className="activity-row" key={event.id}>
                  <div className="activity-event-icon">{isInference ? <Activity size={15} /> : <ShieldCheck size={15} />}</div>
                  <div className="activity-details"><strong>{isInference ? event.endpoint : actionLabel(event.action)}</strong><span>{event.model ?? (event.modelCount != null ? `${event.modelCount} models` : 'System')}</span></div>
                  <span className={`result-chip ${success ? 'result-ok' : 'result-failed'}`}>{success ? `${event.durationMs ?? 0} ms` : event.statusCode ?? 'ERR'}</span>
                  <time>{formatTime(event.timestamp)}</time>
                </article>
              }) : <div className="activity-empty"><Activity size={20} /><p>No routed inference requests yet.</p><span>Point an agent at the local proxy below to record metadata here.</span></div>}
            </div>
            <div className="activity-foot"><span className="live-dot" /> Updating every 2.5 seconds <span className="privacy-note">Prompts and responses are never saved.</span></div>
          </section>
        </div>

        <section className="agent-section">
          <div className="agent-copy"><div className="agent-icon"><Terminal size={18} /></div><div><p className="section-kicker">ROUTE AGENT TRAFFIC</p><h2>Bring Cline and Continue into the ledger</h2><p>Set the Ollama base URL in each agent to this local proxy. Requests will appear above; prompt contents remain in memory only.</p></div></div>
          <div className="route-block"><label htmlFor="proxy-url">OLLAMA-COMPATIBLE BASE URL</label><div className="route-input-row"><code id="proxy-url">http://127.0.0.1:3210/ollama</code><button className="icon-button copy-button" onClick={() => void copyAgentUrl()} title="Copy proxy URL" aria-label="Copy proxy URL">{copied ? <Check size={16} /> : <Copy size={16} />}</button></div><span className="route-note">Cline provider: Ollama · Continue provider: Ollama · Model: qwen2.5-coder:3b</span></div>
        </section>

        <section className="safety-strip"><div className="safety-heading"><AlertTriangle size={17} /><h2>Runtime controls</h2></div><p>Uninstalling Ollama stops its service. Downloaded models are kept unless you choose to delete them too.</p>{status?.canUninstall ? <button className="button button-danger" onClick={() => setDialog({ kind: 'uninstall', removeModels: false })} disabled={Boolean(busy)}><Trash2 size={15} /> Uninstall Ollama</button> : <span className="container-note">Uninstall Ollama on the host. Use <code>docker compose down</code> to remove this dashboard.</span>}</section>

        <footer className="page-footer"><span><span className="footer-signal" /> LOCAL ONLY <span className="footer-separator">/</span> 127.0.0.1</span><span>{gpu?.name ?? 'NVIDIA telemetry unavailable'} <span className="footer-separator">·</span> {status?.monitoredAt ? `Updated ${formatTime(status.monitoredAt)}` : 'Connecting'}</span></footer>
      </main>

      {dialog && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null) }}>
        <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <button className="dialog-close icon-button" onClick={() => setDialog(null)} aria-label="Close dialog"><X size={18} /></button>
          {dialog.kind === 'remove' ? <>
            <span className="dialog-icon dialog-icon-danger"><Trash2 size={19} /></span><p className="section-kicker">DELETE LOCAL FILES</p><h2 id="dialog-title">Remove this model?</h2><p className="dialog-copy">This permanently removes <strong>{dialog.model}</strong> and its downloaded model data from this device.</p>
            <div className="dialog-actions"><button className="button button-quiet" onClick={() => setDialog(null)}>Cancel</button><button className="button button-danger" disabled={Boolean(busy)} onClick={() => void runAction('remove-model', '/api/models/remove', jsonOptions({ model: dialog.model, confirmation: dialog.model }), 'Model removed from this device.')}>{busy === 'remove-model' ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />} Remove model</button></div>
          </> : dialog.kind === 'uninstall' ? <>
            <span className="dialog-icon dialog-icon-danger"><AlertTriangle size={19} /></span><p className="section-kicker">SYSTEM CHANGE</p><h2 id="dialog-title">Uninstall Ollama?</h2><p className="dialog-copy">The local runtime will stop and be removed. This dashboard will remain installed.</p>
            <label className="checkbox-row"><input type="checkbox" checked={dialog.removeModels} onChange={(event) => setDialog({ kind: 'uninstall', removeModels: event.target.checked })} /><span>Also delete all downloaded model files</span></label>
            <div className="dialog-actions"><button className="button button-quiet" onClick={() => setDialog(null)}>Cancel</button><button className="button button-danger" disabled={Boolean(busy)} onClick={() => void runAction('uninstall', '/api/uninstall', jsonOptions({ confirmation: 'UNINSTALL OLLAMA', removeModels: dialog.removeModels }), 'Ollama uninstall requested.')}>{busy === 'uninstall' ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />} Uninstall</button></div>
          </> : <>
            <span className="dialog-icon"><Activity size={19} /></span><p className="section-kicker">ACTIVITY HISTORY</p><h2 id="dialog-title">Clear the request log?</h2><p className="dialog-copy">This clears the local metadata ledger. It does not affect model files or agent conversations.</p>
            <div className="dialog-actions"><button className="button button-quiet" onClick={() => setDialog(null)}>Cancel</button><button className="button button-danger" disabled={Boolean(busy)} onClick={() => void runAction('clear-log', '/api/activity', { method: 'DELETE' }, 'Activity log cleared.')}><Trash2 size={15} /> Clear log</button></div>
          </>}
        </section>
      </div>}
    </div>
  )
}

export default App
