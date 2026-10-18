import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';

// No StrictMode: it would mount the viewer twice and start two emulators.
createRoot(document.getElementById('root')).render(<App />);
