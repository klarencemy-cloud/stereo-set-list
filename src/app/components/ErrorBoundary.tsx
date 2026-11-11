import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** When this changes (e.g. the page address), the boundary clears its error. */
  resetKey?: unknown;
  onReload?: () => void;
}

interface State {
  failed: boolean;
}

/** Catches render errors so a broken page shows a message instead of a blank screen. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  reload = () => {
    if (this.props.onReload) this.props.onReload();
    else window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page">
        <p role="alert" className="error">Something went wrong</p>
        <button type="button" className="btn primary" onClick={this.reload}>
          Reload
        </button>
      </main>
    );
  }
}
