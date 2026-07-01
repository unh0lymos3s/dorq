const FRIENDLY: Record<string, string> = {
  // Parser
  parse_runtime_error: 'The document parser failed on that file. Try a different PDF or use a URL instead.',
  docling_parse_error: 'Could not read that document. Try a different PDF or URL.',
  // LLM (local Ollama)
  llm_invalid_json: 'The local model returned an unreadable response. Please retry.',
  strategy_runtime_error: 'Strategy generation failed. Make sure Ollama is running and the model is pulled.',
  llm_error: 'Couldn’t reach the local model. Make sure Ollama is running and the model is pulled.',
  // Backtest
  backtest_runtime_error: 'The backtest engine hit an error. Check the strategy and try again.',
  alpaca_not_configured: 'Market data isn’t configured on the server. Set the Alpaca keys and restart.',
}

const DETAIL_PREFIX: Array<[string, (rest: string) => string]> = [
  ['docling_parse_error:', rest => `Parse error: ${rest.trim()}`],
  ['alpaca_fetch_error:', rest => `Could not fetch market data: ${rest.trim()}`],
  ['strategy_exec_error:', rest => `Strategy code error: ${rest.trim()}`],
  ['strategy_code must', rest => `Invalid strategy code: must${rest}`],
]

interface ErrorEnvelope {
  // raise_http envelopes: { detail: { error, detail } }
  // plain HTTPException:   { detail: "..." }
  detail?: string | { error?: string; detail?: string }
}

export async function friendlyError(res: Response): Promise<Error> {
  let code: string | undefined
  let message = `Request failed (HTTP ${res.status})`

  try {
    const body: ErrorEnvelope = await res.json()
    if (typeof body.detail === 'string') {
      message = body.detail
    } else if (body.detail && typeof body.detail === 'object') {
      code = body.detail.error
      if (body.detail.detail) message = body.detail.detail
    }
  } catch {
    // non-JSON body — keep default message
  }

  // Map a known error code to a friendly, actionable line.
  if (code && FRIENDLY[code]) return new Error(FRIENDLY[code])
  if (FRIENDLY[message]) return new Error(FRIENDLY[message])

  // Prefix match against the raw detail text.
  for (const [prefix, fn] of DETAIL_PREFIX) {
    if (message.startsWith(prefix)) return new Error(fn(message.slice(prefix.length)))
  }

  // HTTP status fallbacks
  if (res.status === 404) return new Error('Resource not found.')
  if (res.status === 413) return new Error('That file is too large.')
  if (res.status === 429) return new Error('Too many requests. Please wait a moment.')
  if (res.status >= 500) return new Error(message || 'Server error. Please try again.')

  return new Error(message)
}
