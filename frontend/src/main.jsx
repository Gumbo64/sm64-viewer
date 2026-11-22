import { createRoot } from 'react-dom/client';
import './styles.css';
import 'sm64-binds-frontend/replay.css'; // after styles.css, as when the viewer imported it itself
import App from './App.jsx';

// No StrictMode: it would mount the viewer twice and start two emulators.
// The emulator (Emscripten SDL) listens for keys on the window and cancels
// them, so typing in a field would do nothing. A key aimed at a field stops
// here, after React's root has seen it and before it bubbles to the window.
for (const type of ['keydown', 'keypress', 'keyup']) {
  document.addEventListener(type, (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) {
      e.stopPropagation();
    }
  });
}

createRoot(document.getElementById('root')).render(<App />);
