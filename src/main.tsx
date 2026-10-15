import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installGlobalErrorHandlers } from './data/errorLog';
import { useSettings } from './data/settingsStore';
import { detectLocale, initI18n } from './i18n';
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import './styles.css';

installGlobalErrorHandlers();

const settings = useSettings.getState();
const locale = settings.disclaimerAcceptedAt ? settings.locale : detectLocale();
if (locale !== settings.locale) settings.setLocale(locale);
await initI18n(locale);
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && !settings.reducedMotion) {
  settings.setReducedMotion(true);
}

// Inside a frame (see public/frame-guard.js) the app never starts: no UI, no stimulus.
const framed = document.documentElement.hasAttribute('data-framed');
const root = document.getElementById('root');
if (root && !framed) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
