import { useRef, useState } from 'react'
import type React from 'react'
import type { PaperResult } from '../types'

interface Props {
  onDone: (paperId: string) => void
  done: boolean
}

const CIRCLE: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 700,
  flexShrink: 0,
  background: 'var(--text)',
  color: 'var(--bg)',
  border: 'none',
}

const CIRCLE_IDLE: React.CSSProperties = {
  ...CIRCLE,
  background: 'transparent',
  color: 'var(--muted)',
  border: '1.5px solid var(--border)',
}

export default function Step1Paper({ onDone, done }: Props) {
  const [tab, setTab] = useState<'pdf' | 'url'>('pdf')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PaperResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isDone = done || result !== null
  const isActive = !isDone

  const cardStyle: React.CSSProperties = {
    border: isActive
      ? '2px solid var(--text)'
      : '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
  }

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    background: 'var(--surface)',
  }

  const cirStyle = isDone || isActive ? CIRCLE : CIRCLE_IDLE

  function handleFile(f: File) {
    setFile(f)
    setError(null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  async function handleParse() {
    setError(null)
    setLoading(true)
    try {
      let res: Response
      if (tab === 'pdf') {
        if (!file) { setError('Select a PDF file first.'); setLoading(false); return }
        const form = new FormData()
        form.append('file', file)
        res = await fetch('/papers/upload', { method: 'POST', body: form })
      } else {
        if (!url.trim()) { setError('Enter a URL.'); setLoading(false); return }
        res = await fetch('/papers/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() }),
        })
      }
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data: PaperResult = await res.json()
      setResult(data)
      onDone(data.paper_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid var(--text)' : '2px solid transparent',
    padding: '6px 2px',
    marginRight: 16,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--text)' : 'var(--muted)',
    fontFamily: 'var(--font)',
  })

  const parseBtn: React.CSSProperties = {
    width: '100%',
    height: 40,
    background: 'var(--text)',
    color: 'var(--bg)',
    border: 'none',
    borderRadius: 'var(--radius)',
    fontSize: 14,
    fontWeight: 600,
    cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.6 : 1,
    fontFamily: 'var(--font)',
    marginTop: 12,
  }

  const dropZone: React.CSSProperties = {
    border: `1.5px dashed ${dragging ? 'var(--text)' : 'var(--border)'}`,
    borderRadius: 'var(--radius)',
    height: 80,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 13,
    color: 'var(--muted)',
    background: dragging ? 'var(--subtle)' : 'transparent',
    transition: 'background 0.15s, border-color 0.15s',
    userSelect: 'none',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 38,
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'var(--surface)',
    color: 'var(--text)',
    padding: '0 10px',
    fontSize: 13,
    fontFamily: 'var(--font)',
    boxSizing: 'border-box',
    outline: 'none',
  }

  const infoBlock: React.CSSProperties = {
    marginTop: 12,
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: 12,
    color: 'var(--muted)',
    background: 'var(--subtle)',
    fontFamily: 'var(--mono)',
    lineHeight: 1.7,
  }

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div style={cirStyle}>{isDone ? '✓' : '1'}</div>
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Upload Paper</span>
        {isDone && (
          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {result?.filename ?? result?.paper_id}
          </span>
        )}
      </div>

      {isActive && (
        <div style={{ padding: '0 16px 16px' }}>
          {/* Tab switcher */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 14, marginTop: 2 }}>
            <button style={tabBtnStyle(tab === 'pdf')} onClick={() => setTab('pdf')}>PDF</button>
            <button style={tabBtnStyle(tab === 'url')} onClick={() => setTab('url')}>URL</button>
          </div>

          {tab === 'pdf' ? (
            <>
              <div
                style={dropZone}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                {file ? file.name : 'Drop PDF here or click to browse'}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
            </>
          ) : (
            <input
              style={inputStyle}
              type="url"
              placeholder="https://arxiv.org/pdf/..."
              value={url}
              onChange={e => { setUrl(e.target.value); setError(null) }}
            />
          )}

          <button style={parseBtn} onClick={handleParse} disabled={loading}>
            {loading ? 'Parsing…' : 'Parse'}
          </button>

          {error && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--error, #cc0000)' }}>
              {error}
            </p>
          )}
        </div>
      )}

      {result !== null && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={infoBlock}>
            <div>paper_id: {result.paper_id}</div>
            <div>sections: {result.sections_found.join(', ') || '—'}</div>
            <div>markdown: {result.markdown_length.toLocaleString()} chars</div>
          </div>
        </div>
      )}
    </div>
  )
}
