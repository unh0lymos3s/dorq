import { useCallback, useRef, useState } from 'react'
import type React from 'react'
import type { PaperResult } from '../types'
import { friendlyError } from '../apiError'
import Stage, { Dots, type StageState } from '../components/Stage'

interface Props {
  state: StageState
  onDone: (paperId: string) => void
}

export default function Step1Paper({ state, onDone }: Props) {
  const [tab, setTab] = useState<'pdf' | 'url'>('pdf')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PaperResult | null>(null)
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
      const data: PaperResult = await res.json()
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
