import { hydrateRoot, createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
const el = document.getElementById('root')!;
const path = window.location.pathname.replace(/\/$/, '') || '/';
if (el.hasChildNodes() && el.dataset.route === path) hydrateRoot(el, <App path={path} />);
else createRoot(el).render(<App path={path} />);
