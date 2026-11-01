import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/app.css';

class RendererBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="startup-error"><h1>Cutroom couldn't open this view.</h1><p>Reload the app to reconnect to your project folder.</p><button type="button" className="button" onClick={() => window.location.reload()}>Reload Cutroom</button></main>;
    return this.props.children;
  }
}
const root = document.getElementById('root');
if (!root) throw new Error('Renderer root is missing');
createRoot(root).render(<StrictMode><RendererBoundary><App /></RendererBoundary></StrictMode>);
