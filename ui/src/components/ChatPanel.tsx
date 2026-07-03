import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { ChatMessage } from '../types'
import { friendlyError } from '../apiError'
import { Dots } from './Stage'

interface Props {
  paperId: string | null
  backtestId: string | null
}

/**
 * Q&A over the loaded paper and the current backtest's strategy, answered by
 * the local Ollama model via POST /chat. Conversation lives client-side only.
 */
export default function ChatPanel({ paperId, backtestId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const send = useCallback(async () => {
    const question = input.trim()
    if (!question || busy) return
    setError(null)
    setInput('')
    setMessages(m => [...m, { role: 'user', text: question }])
    setBusy(true)
    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          paper_id: paperId,
          strategy_id: backtestId,
        }),
      })
      if (!res.ok) throw await friendlyError(res)
      const data: { answer: string } = await res.json()
      setMessages(m => [...m, { role: 'assistant', text: data.answer }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setBusy(false)
    }
  }, [input, busy, paperId, backtestId])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }, [send])

  return (
    <div className="chat-panel">
      {messages.length > 0 && (
        <div className="chat-log" ref={logRef}>
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg is-${m.role}`}>
              <span className="chat-who">{m.role === 'user' ? 'you' : 'model'}</span>
              <p className="chat-text">{m.text}</p>
            </div>
          ))}
          {busy && (
            <div className="chat-msg is-assistant">
              <span className="chat-who">model</span>
              <p className="chat-text"><Dots /></p>
            </div>
          )}
        </div>
      )}
      <div className="chat-input-row">
        <input
          className="input"
          placeholder="Ask about the paper or this strategy…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        <button className="btn chat-send" onClick={send} disabled={busy || !input.trim()}>
          {busy ? <Dots /> : 'Ask'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
