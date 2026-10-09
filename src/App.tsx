import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HashRouter, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { CalibrationWizard } from './calibration/Wizard';
import { History } from './dashboard/History';
import { ModuleView } from './dashboard/ModuleView';
import { Overview } from './dashboard/Overview';
import { RedFlagPage } from './dashboard/RedFlagPage';
import { SettingsPage } from './dashboard/SettingsPage';
import { ensureSchemaVersion } from './data/db';
import { disclaimerAccepted, useSettings } from './data/settingsStore';
import { DisclaimerScreen } from './safety/DisclaimerScreen';
import { recoverInProgressSessions } from './safety/session';
import { TrainingShell } from './safety/TrainingShell';
import { Banner, Button, Footer } from './ui';

/**
 * A fresh training screen per module: moving from /train/l1 to /train/l2 (e.g. with the
 * browser's back/forward buttons) must not carry over the previous module's session state.
 */
function TrainingRoute() {
  const { moduleId } = useParams();
  return <TrainingShell key={moduleId ?? 'none'} />;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }
  override render() {
    if (this.state.error) return <CrashScreen error={this.state.error} />;
    return this.props.children;
  }
}

function CrashScreen({ error }: { error: Error }) {
  const { t } = useTranslation();
  return (
    <div className="app-main">
      <Banner tone="danger" title={t('app.errorTitle')}>
        {t('app.errorBody')}
        <pre style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>
        <Button onClick={() => window.location.reload()}>{t('app.reload')}</Button>
      </Banner>
    </div>
  );
}

function UpdateBanner() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  if (needRefresh) {
    return (
      <Banner tone="info" title={t('app.updateAvailable')}>
        <Button small onClick={() => void updateServiceWorker(true)}>
          {t('app.reload')}
        </Button>{' '}
        <Button small variant="ghost" onClick={() => setNeedRefresh(false)}>
          {t('common.cancel')}
        </Button>
      </Banner>
    );
  }
  if (offlineReady) {
    return (
      <Banner tone="success" title={t('app.offlineReady')}>
        <Button small variant="ghost" onClick={() => setOfflineReady(false)}>
          OK
        </Button>
      </Banner>
    );
  }
  return null;
}

function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const [recovered, setRecovered] = useState(0);
  useEffect(() => {
    void ensureSchemaVersion();
    recoverInProgressSessions()
      .then(setRecovered)
      .catch(() => setRecovered(0));
  }, []);
  const locked = settings.trainingLock.locked;
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">{t('app.name')}</span>
        <nav aria-label="main">
          <NavLink to="/" end>
            {t('nav.overview')}
          </NavLink>
          <NavLink to="/calibration">{t('nav.calibration')}</NavLink>
          <NavLink to="/history">{t('nav.history')}</NavLink>
          <NavLink to="/settings">{t('nav.settings')}</NavLink>
          {locked ? <NavLink to="/red-flag">{t('nav.redFlag')}</NavLink> : null}
        </nav>
      </header>
      <main className="app-main">
        <UpdateBanner />
        {recovered > 0 ? <Banner tone="warn">{t('app.recovered', { count: recovered })}</Banner> : null}
        {children}
      </main>
      <Footer />
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const settings = useSettings();
  if (!disclaimerAccepted(settings)) {
    return <DisclaimerScreen onAccept={settings.acceptDisclaimer} />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Layout>
          <Gate>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/calibration" element={<CalibrationWizard />} />
              <Route path="/module/:moduleId" element={<ModuleView />} />
              <Route path="/train/:moduleId" element={<TrainingRoute />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/red-flag" element={<RedFlagPage />} />
              <Route path="*" element={<Overview />} />
            </Routes>
          </Gate>
        </Layout>
      </HashRouter>
    </ErrorBoundary>
  );
}
