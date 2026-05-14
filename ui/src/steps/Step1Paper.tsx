import { useCallback, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { PaperResult } from '../types'

interface Props {
  onDone: (paperId: string) => void
  done: boolean
  animKey?: number
}

// ─── Module-scope style constants (allocated once for the lifetime of the app)
const TITLE_STYLE: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  flex: 1,
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  marginBottom: 6,
  marginTop: 16,
  display: 'block',
}

const INPUT_STYLE: React.CSSProperties = {
  height: 42,
  border: '1px solid var(--border)',
  borderRadius: 0,
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 12px',
  fontSize: 13,
  fontFamily: 'var(--font)',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
  transition: 'border-color 0.15s',
}

const HEADER_BASE: React.CSSProperties = {
  height: 52,
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '0 20px',
}

const STEP_NUM_DONE: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  fontFamily: 'var(--font)',
  color: 'var(--muted)',
  lineHeight: 1,
  minWidth: 32,
  textDecoration: 'line-through',
  textDecorationColor: 'var(--border)',
}
const STEP_NUM_ACTIVE: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  fontFamily: 'var(--font)',
  color: 'var(--text)',
  lineHeight: 1,
  minWidth: 32,
}
const STEP_NUM_IDLE: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  fontFamily: 'var(--font)',
  color: 'var(--subtle)',
  lineHeight: 1,
  minWidth: 32,
}

const CARD_ACTIVE: React.CSSProperties = {
  border: '2px solid var(--text)',
  marginTop: -1,
  position: 'relative',
  zIndex: 1,
  overflow: 'hidden',
}
const CARD_IDLE: React.CSSProperties = {
  border: '1px solid var(--border)',
  marginTop: -1,
  overflow: 'hidden',
}

const HEADER_ACTIVE: React.CSSProperties = { ...HEADER_BASE, background: 'var(--bg)' }
const HEADER_IDLE: React.CSSProperties = { ...HEADER_BASE, background: 'var(--surface)' }

const TITLE_ACTIVE: React.CSSProperties = { ...TITLE_STYLE, color: 'var(--text)' }
const TITLE_IDLE: React.CSSProperties = { ...TITLE_STYLE, color: 'var(--muted)' }

const BODY_STYLE: React.CSSProperties = {
  padding: '20px 20px 24px',
  borderTop: '1px solid var(--border)',
  animation: 'slideDown 0.22s ease',
}

const TAB_WRAP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  border: '1px solid var(--border)',
  marginBottom: 18,
}

const TAB_BTN_BASE: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font)',
  transition: 'background 0.15s, color 0.15s',
}
const TAB_BTN_ON: React.CSSProperties = { ...TAB_BTN_BASE, background: 'var(--text)', color: 'var(--bg)' }
const TAB_BTN_OFF: React.CSSProperties = { ...TAB_BTN_BASE, background: 'transparent', color: 'var(--muted)' }

const FILE_NAME_STYLE: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 12,
  color: 'var(--text)',
  fontWeight: 600,
}
const FILE_SIZE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  color: 'var(--muted)',
}
const DROP_PLUS_STYLE: React.CSSProperties = {
  fontSize: 24,
  lineHeight: 1,
  color: 'var(--muted)',
  fontWeight: 300,
}
const DROP_HINT_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  fontFamily: 'var(--font)',
}

const HIDDEN_FILE_INPUT: React.CSSProperties = { display: 'none' }

const LOADING_SPAN: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 13, letterSpacing: 3 }
const DOT_A: React.CSSProperties = { animation: 'pulse 1.2s ease infinite', animationDelay: '0ms', display: 'inline-block' }
const DOT_B: React.CSSProperties = { animation: 'pulse 1.2s ease infinite', animationDelay: '200ms', display: 'inline-block' }
const DOT_C: React.CSSProperties = { animation: 'pulse 1.2s ease infinite', animationDelay: '400ms', display: 'inline-block' }

const ERROR_STYLE: React.CSSProperties = {
  marginTop: 10,
  fontSize: 12,
  fontFamily: 'var(--mono)',
  color: 'var(--error)',
}

const SUCCESS_WRAP: React.CSSProperties = {
  borderTop: '1px solid var(--border)',
  padding: '16px 20px',
  background: 'var(--surface)',
  fontFamily: 'var(--mono)',
  fontSize: 12,
  color: 'var(--muted)',
  lineHeight: 2,
}

const ROW_STYLE: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 16 }
const ROW_VALUE_STYLE: React.CSSProperties = {
  color: 'var(--text)',
  fontWeight: 700,
  textAlign: 'right',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '60%',
}

const BADGE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  color: 'var(--muted)',
  maxWidth: 220,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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

  // Compose dynamic styles from cached chunks; only the drop zone & button
  // need dragging/loading info, and those memoize cheaply.
  const dropZoneStyle = useMemo<React.CSSProperties>(() => ({
    border: `1.5px dashed ${dragging ? 'var(--text)' : 'var(--border)'}`,
    height: 100,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
    background: dragging ? 'var(--subtle)' : 'transparent',
    userSelect: 'none',
    gap: 6,
  }), [dragging])

  const parseBtnStyle = useMemo<React.CSSProperties>(() => ({
    width: '100%',
    height: 44,
    background: 'var(--text)',
    color: 'var(--bg)',
    border: 'none',
    fontFamily: 'var(--font)',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: loading ? 'not-allowed' : 'pointer',
    marginTop: 20,
    transition: 'opacity 0.15s',
    opacity: loading ? 0.5 : 1,
  }), [loading])

  const handleFile = useCallback((f: File) => {
    setFile(f)
    setError(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) {
      setFile(f)
      setError(null)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => setDragging(false), [])

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), [])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }, [handleFile])

  const onUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value)
    setError(null)
  }, [])

  const handleParse = useCallback(async () => {
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
        const trimmed = url.trim()
        if (!trimmed) { setError('Enter a URL.'); setLoading(false); return }
        res = await fetch('/papers/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmed }),
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
  }, [tab, file, url, onDone])

  const cardStyle = isActive ? CARD_ACTIVE : CARD_IDLE
  const headerStyle = isActive ? HEADER_ACTIVE : HEADER_IDLE
  const titleStyle = isActive ? TITLE_ACTIVE : TITLE_IDLE
  const stepNumStyle = isDone ? STEP_NUM_DONE : isActive ? STEP_NUM_ACTIVE : STEP_NUM_IDLE

  const badgeText = result?.filename ?? result?.paper_id

  // Precompute the success rows just once when result changes.
  const successRows = useMemo<readonly [string, string][] | null>(() => {
    if (!result) return null
    return [
      ['paper_id', result.paper_id],
      ['sections', result.sections_found.join(', ') || '—'],
      ['length', `${result.markdown_length.toLocaleString()} chars`],
    ]
  }, [result])

  return (
    <div style={cardStyle} className={isActive ? 'step-active' : undefined}>
      {/* ── Header ── */}
      <div style={headerStyle}>
        <span style={stepNumStyle}>1</span>
        <span style={titleStyle}>Upload Paper</span>
        {isDone && badgeText && <span style={BADGE_STYLE}>{badgeText}</span>}
      </div>

      {/* ── Active body ── */}
      {isActive && (
        <div style={BODY_STYLE}>
          {/* Tab switcher */}
          <div style={TAB_WRAP_STYLE}>
            <button
              onClick={() => setTab('pdf')}
              style={tab === 'pdf' ? TAB_BTN_ON : TAB_BTN_OFF}
            >
              PDF
            </button>
            <button
              onClick={() => setTab('url')}
              style={tab === 'url' ? TAB_BTN_ON : TAB_BTN_OFF}
            >
              URL
            </button>
          </div>

          {tab === 'pdf' ? (
            <>
              <div
                style={dropZoneStyle}
                onClick={openFilePicker}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {file ? (
                  <>
                    <span style={FILE_NAME_STYLE}>{file.name}</span>
                    <span style={FILE_SIZE_STYLE}>{(file.size / 1024).toFixed(1)} KB</span>
                  </>
                ) : (
                  <>
                    <span style={DROP_PLUS_STYLE}>+</span>
                    <span style={DROP_HINT_STYLE}>Drop PDF or click to browse</span>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                style={HIDDEN_FILE_INPUT}
                onChange={onFileChange}
              />
            </>
          ) : (
            <>
              <label style={LABEL_STYLE}>Paper URL</label>
              <input
                className="dorq-input"
                style={INPUT_STYLE}
                type="url"
                placeholder="https://arxiv.org/pdf/..."
                value={url}
                onChange={onUrlChange}
              />
            </>
          )}

          <button style={parseBtnStyle} onClick={handleParse} disabled={loading}>
            {loading ? (
              <span style={LOADING_SPAN}>
                <span style={DOT_A}>•</span>
                <span style={DOT_B}>•</span>
                <span style={DOT_C}>•</span>
              </span>
            ) : (
              'Parse Paper'
            )}
          </button>

          {error && <p style={ERROR_STYLE}>! {error}</p>}
        </div>
      )}

      {/* ── Success info block ── */}
      {successRows && (
        <div style={SUCCESS_WRAP}>
          {successRows.map(([label, value]) => (
            <div key={label} style={ROW_STYLE}>
              <span>{label}</span>
              <span style={ROW_VALUE_STYLE}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
