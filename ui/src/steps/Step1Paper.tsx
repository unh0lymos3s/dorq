import { useCallback, useRef, useState } from 'react'
import type React from 'react'
import type { PaperResult, PaperStatus } from '../types'
import { friendlyDetail, friendlyError } from '../apiError'
import Stage, { Dots, type StageState } from '../components/Stage'

interface Props {
  state: StageState
  onDone: (paperId: string) => void
  /** Pre-parsed paper injected when the user reopens one from history. */
  initialResult?: PaperResult | null
}

const POLL_MS = 1500
const POLL_TIMEOUT_MS = 15 * 60 * 1000
// Transient fetch failures tolerated in a row before giving up — the parse
// keeps running server-side, so a network blip shouldn't fail the upload.
const POLL_MAX_MISSES = 8

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Poll GET /papers/{id} until the background docling parse settles. */
async function pollPaper(paperId: string): Promise<PaperResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let misses = 0
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    let res: Response
    try {
      res = await fetch(`/papers/${paperId}`)
    } catch {
      if (++misses > POLL_MAX_MISSES) {
        throw new Error('Lost connection to the server. The paper may still finish parsing — retry in a moment.')
      }
      continue
    }
    misses = 0
    if (!res.ok) throw await friendlyError(res)
    const st: PaperStatus = await res.json()
    if (st.status === 'ready') {
      return {
        paper_id: st.paper_id,
        filename: st.filename ?? undefined,
        source_url: st.source_url ?? undefined,
        sections_found: st.sections_found ?? [],
        markdown_length: st.markdown_length ?? 0,
      }
    }
    if (st.status === 'error') {
      const raw = st.error ?? 'parse_runtime_error'
      throw new Error(friendlyDetail(raw))
    }
  }
  throw new Error('Timed out waiting for the parser. Try again.')
}

export default function Step1Paper({ state, onDone, initialResult = null }: Props) {
  const [tab, setTab] = useState<'pdf' | 'url'>('pdf')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PaperResult | null>(initialResult)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) { setFile(f); setError(null) }
  }, [])
  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(true) }, [])
  const onDragLeave = useCallback(() => setDragging(false), [])
  const openPicker = useCallback(() => fileInputRef.current?.click(), [])
  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) { setFile(f); setError(null) }
  }, [])
  const onUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value); setError(null)
  }, [])

  const handleParse = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      let res: Response
      if (tab === 'pdf') {
        if (!file) { setError('Select a PDF first.'); setLoading(false); return }
        const form = new FormData()
        form.append('file', file)
        res = await fetch('/papers/upload', { method: 'POST', body: form })
      } else {
        const trimmed = url.trim()
        if (!trimmed) { setError('Enter a URL.'); setLoading(false); return }
        res = await fetch('/papers/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmed }),
        })
      }
      if (!res.ok) throw await friendlyError(res)
      // 202: the parse runs in the background — poll until it settles.
      const accepted: PaperStatus = await res.json()
      const data = await pollPaper(accepted.paper_id)
      setResult(data)
      onDone(data.paper_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [tab, file, url, onDone])

  const badge = result ? (result.filename ?? result.paper_id) : undefined

  return (
    <Stage n={1} title="Upload paper" state={state} badge={badge}>
      {state === 'active' && !result && (
        <div className="card-body">
          <div className="tabs" role="tablist">
            <button className={`tab${tab === 'pdf' ? ' is-on' : ''}`} onClick={() => setTab('pdf')}>PDF</button>
            <button className={`tab${tab === 'url' ? ' is-on' : ''}`} onClick={() => setTab('url')}>URL</button>
          </div>

          {tab === 'pdf' ? (
            <>
              <div
                className={`dropzone${dragging ? ' is-drag' : ''}`}
                onClick={openPicker}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                {file ? (
                  <>
                    <span className="file-name">{file.name}</span>
                    <span className="file-size">{(file.size / 1024).toFixed(1)} KB</span>
                  </>
                ) : (
                  <>
                    <span className="glyph">↑</span>
                    <span className="hint">Drop a PDF, or click to browse</span>
                  </>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept=".pdf" hidden onChange={onFileChange} />
            </>
          ) : (
            <label className="field">
              <span className="field-label">Paper URL</span>
              <input className="input" type="url" placeholder="https://arxiv.org/pdf/…" value={url} onChange={onUrlChange} />
            </label>
          )}

          <button className="btn" onClick={handleParse} disabled={loading}>
            {loading ? <Dots /> : 'Parse paper'}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {result && (
        <div className="card-foot">
          <div className="kv">
            <div className="kv-row"><span className="kv-k">paper_id</span><span className="kv-v">{result.paper_id}</span></div>
            <div className="kv-row"><span className="kv-k">sections</span><span className="kv-v">{result.sections_found.join(', ') || '—'}</span></div>
            <div className="kv-row"><span className="kv-k">length</span><span className="kv-v">{result.markdown_length.toLocaleString()} chars</span></div>
          </div>
        </div>
      )}
    </Stage>
  )
}
