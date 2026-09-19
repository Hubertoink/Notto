import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './styles.css';
import App from './App';
import { NottoProvider } from './state';

class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <h1>Noto konnte nicht geöffnet werden.</h1>
        <p>{this.state.error}</p>
        <button onClick={() => location.reload()}>Erneut versuchen</button>
        <p>Deine gespeicherten Notizen bleiben erhalten.</p>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <Boundary>
    <MotionConfig reducedMotion="user">
      <NottoProvider>
        <App />
      </NottoProvider>
    </MotionConfig>
  </Boundary>,
);
