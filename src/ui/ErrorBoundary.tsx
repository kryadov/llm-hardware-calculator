/**
 * The last line of defence — spec §7 ("Error boundary на приложении — последний
 * рубеж").
 *
 * The calculator is a pure function of its inputs, so a render error is a bug
 * rather than a user mistake. What matters is that the bug costs the user only
 * the panel it happened in: the shell wraps the results column, leaving the
 * header, the footer and every input control mounted and usable.
 *
 * `resetKeys` is what makes the fallback's promise ("adjust a parameter to
 * recompute") true. The shell passes the form state, so the next keystroke
 * clears the error and tries the render again instead of stranding the page in
 * a dead state until a reload.
 */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

export interface ErrorBoundaryProps {
  children?: ReactNode
  /**
   * Rendered in place of the children after a crash. `reset` clears the error
   * and re-renders the subtree.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** Side channel for logging; never used for rendering. */
  onError?: (error: Error, info: ErrorInfo) => void
  /**
   * Any change (compared element by element with `Object.is`) clears a caught
   * error and re-renders the children.
   */
  resetKeys?: readonly unknown[]
}

export interface ErrorBoundaryState {
  error: Error | null
}

const changed = (a: readonly unknown[] = [], b: readonly unknown[] = []): boolean =>
  a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))

/** Anything can be thrown in JavaScript; the fallback still wants an `Error`. */
const toError = (thrown: unknown): Error =>
  thrown instanceof Error ? thrown : new Error(String(thrown))

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(thrown: unknown): ErrorBoundaryState {
    return { error: toError(thrown) }
  }

  componentDidCatch(thrown: unknown, info: ErrorInfo): void {
    this.props.onError?.(toError(thrown), info)
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error !== null && changed(prev.resetKeys, this.props.resetKeys)) {
      this.reset()
    }
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    // The default is deliberately styling-free and untranslated: every mount in
    // this app supplies a fallback from the dictionary, and a boundary that
    // reached for i18n or Tailwind could fail a second time inside its own
    // recovery path.
    return this.props.fallback?.(error, this.reset) ?? <p role="alert">{error.message}</p>
  }
}

export default ErrorBoundary
