import { Component } from 'react'
import type { ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { failed: boolean }

/**
 * The dither background needs a WebGL context; on machines/browsers without
 * one, three.js throws during render. The background is decoration — a
 * failure must degrade to a plain page, never take down the app.
 */
export default class BackgroundBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(): void {
    // Nothing to report — the static CSS background remains.
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
