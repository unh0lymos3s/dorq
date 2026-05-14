const FRIENDLY: Record<string, string> = {
  // Parser
  parse_runtime_error: 'The document parser timed out. Try a shorter PDF or use a URL instead.',
  // LLM
  llm_invalid_json: 'The AI model returned an unreadable response. Please retry.',
  strategy_runtime_error: 'Strategy generation failed unexpectedly. Try a different model.',
  // Backtest
  backtest_runtime_error: 'The backtest engine encountered an error. Check your strategy and try again.',
}

const DETAIL_PREFIX: Array<[string, (rest: string) => string]> = [
  ['docling_parse_error:', rest => `Parse error: ${rest.trim()}`],
  ['alpaca_fetch_error:', rest => `Could not fetch market data: ${rest.trim()}`],
  ['strategy_exec_error:', rest => `Strategy code error: ${rest.trim()}`],
  ['strategy_code must', rest => `Invalid strategy code: must${rest}`],
]

export async function friendlyError(res: Response): Promise<Error> {
  let detail = `Request failed (HTTP ${res.status})`
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string') {
      detail = body.detail
    }
  } catch {
    // non-JSON body — keep default
  }

  // Exact match
  if (FRIENDLY[detail]) return new Error(FRIENDLY[detail])

  // Prefix match
  for (const [prefix, fn] of DETAIL_PREFIX) {
    if (detail.startsWith(prefix)) return new Error(fn(detail.slice(prefix.length)))
  }

  // HTTP status fallbacks
  if (res.status === 422) return new Error(detail) // already human from pydantic
  if (res.status === 404) return new Error('Resource not found.')
  if (res.status === 500) return new Error('Server error. Please try again.')
  if (res.status === 413) return new Error('File is too large.')
  if (res.status === 429) return new Error('Too many requests. Please wait a moment.')

  return new Error(detail)
}
