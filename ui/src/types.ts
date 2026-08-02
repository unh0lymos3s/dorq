export interface PaperResult {
  paper_id: string
  filename?: string
  source_url?: string
  sections_found: string[]
  markdown_length: number
}

/** GET /papers/{id} — background-parse status. When status is 'ready' the
 *  payload is a superset of PaperResult. */
export interface PaperStatus {
  paper_id: string
  status: 'parsing' | 'ready' | 'error'
  filename?: string | null
  source_url?: string | null
  sections_found?: string[]
  markdown_length?: number
  error?: string
}

export interface RiskParams {
  stop_loss_pct?: number | null
  take_profit_pct?: number | null
}

export interface IndicatorDef {
  name: string
  params: Record<string, unknown>
}

export interface StrategySpec {
  title: string
  summary: string
  assets: string[]
  timeframe: string
  date_range: [string, string]
  indicators: IndicatorDef[]
  entry_conditions: string[]
  exit_conditions: string[]
  position_sizing: string
  risk_params: RiskParams
  init_cash: number
}

export interface PortfolioConfig {
  assets: string[]
  timeframe: string
  date_range: [string, string]
  position_sizing: string
  risk_params: RiskParams
  init_cash: number
}

export interface CodeStrategyResult {
  strategy_code: string
  portfolio_config: PortfolioConfig
}

export interface PricePoint {
  t: string
  c: number
}

/** One point on a time-series curve. `v` is equity in dollars for
 *  equity/benchmark curves, percent points (≤ 0) for the drawdown curve. */
export interface CurvePoint {
  t: string
  v: number
}

export interface TradeMarker {
  asset: string
  side: 'long' | 'short'
  status: 'open' | 'closed'
  entry_time: string
  entry_price: number
  exit_time: string | null
  exit_price: number | null
  pnl: number | null
  return_pct: number | null
}

export interface BacktestResult {
  backtest_id: string
  created_at?: string
  metrics: Record<string, number | string | null>
  price_series?: Record<string, PricePoint[]>
  trades?: TradeMarker[]
  equity_curve?: CurvePoint[]
  benchmark_curve?: CurvePoint[]
  drawdown_curve?: CurvePoint[]
}

/** A completed run kept client-side so the user can flip between attempts. */
export interface RunEntry {
  result: BacktestResult
  label: string
  at: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export type GenerateMode = 'spec' | 'code'

/** GET /memory/papers — persisted paper summary. */
export interface MemoryPaper {
  paper_id: string
  filename: string | null
  source_url: string | null
  uploaded_at: string | null
  saved_at: string | null
  markdown_length: number
  embedded: boolean
}

/** GET /memory/strategies — persisted strategy summary. */
export interface MemoryStrategy {
  strategy_id: string
  paper_id: string
  kind: 'spec' | 'code'
  saved_at: string | null
  title: string | null
  assets: string[] | null
  timeframe: string | null
  embedded: boolean
}

/** GET /memory/strategies/{id} — full persisted strategy document. */
export interface MemoryStrategyDoc {
  strategy_id: string
  paper_id: string
  kind: 'spec' | 'code'
  saved_at: string | null
  spec: StrategySpec | null
  strategy_code: string | null
  portfolio_config: PortfolioConfig | null
}

export interface ServerConfig {
  ollama_model: string
  alpaca_configured: boolean
}
