import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useSettings } from './data/settingsStore';
import { detectLocale, initI18n } from './i18n';
import './styles.css';

const settings = useSettings.getState();
const locale = settings.disclaimerAcceptedAt ? settings.locale : detectLocale();
if (locale !== settings.locale) settings.setLocale(locale);
initI18n(locale);
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && !settings.reducedMotion) {
  settings.setReducedMotion(true);
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
