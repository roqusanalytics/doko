import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; onError(): void; onRecover(): Promise<void> }

export class ReaderErrorBoundary extends Component<Props, { failed: boolean; recovering: boolean; message: string }> {
  state = { failed: false, recovering: false, message: "" };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    console.error("Doko reader render failed. Reopen the saved document to recover.");
    this.props.onError();
  }
  private recover = async () => {
    this.setState({ recovering: true, message: "" });
    try {
      await this.props.onRecover();
      this.setState({ failed: false, recovering: false });
    } catch {
      this.setState({ recovering: false, message: "Couldn't reopen the saved document. Try again, or restart Doko." });
    }
  };
  render() {
    if (!this.state.failed) return this.props.children;
    return <main style={{ padding: "max(24px, 8vh) 24px", maxWidth: 560, margin: "0 auto" }}>
      <div role="alert">
        <h1>This reader stopped</h1>
        <p>Unsaved changes in this tab may have been lost. Reopen the saved document to continue.</p>
        {this.state.message && <p>{this.state.message}</p>}
      </div>
      <button className="btn primary" type="button" onClick={this.recover} disabled={this.state.recovering}>
        {this.state.recovering ? "Reopening…" : "Reopen saved document"}
      </button>
    </main>;
  }
}
