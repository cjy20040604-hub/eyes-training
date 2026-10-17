import { Component, Suspense, lazy, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HashRouter, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Overview } from './dashboard/Overview';
import { RedFlagPage } from './dashboard/RedFlagPage';
import { ensureSchemaVersion } from './data/db';
import { autoSync } from './sync/config';
import { logError } from './data/errorLog';
import { disclaimerAccepted, useSettings } from './data/settingsStore';
import { ErrorNotice, ReportProblemButton } from './dashboard/ReportProblem';
import { DisclaimerScreen } from './safety/DisclaimerScreen';
import { recoverInProgressSessions } from './safety/session';
import { Banner, Button, Footer } from './ui';

/*
 * Pages other than the overview load on demand, so the first screen only downloads what it
 * shows. The service worker still precaches every chunk, so all pages work offline.
 * The red-flag page stays in the main bundle: safety guidance must never wait on a download.
 */
const CalibrationWizard = lazy(() =>
  import('./calibration/Wizard').then((m) => ({ default: m.CalibrationWizard })),
);
const History = lazy(() => import('./dashboard/History').then((m) => ({ default: m.History })));
const ModuleView = lazy(() => import('./dashboard/ModuleView').then((m) => ({ default: m.ModuleView })));
const Report = lazy(() => import('./dashboard/Report').then((m) => ({ default: m.Report })));
const SettingsPage = lazy(() =>
  import('./dashboard/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const QuickStart = lazy(() => import('./calibration/QuickStart').then((m) => ({ default: m.QuickStart })));
const AccountPage = lazy(() => import('./sync/AccountPage').then((m) => ({ default: m.AccountPage })));
const WeeklyCheck = lazy(() => import('./assessment/WeeklyCheck').then((m) => ({ default: m.WeeklyCheck })));
const TrainingShell = lazy(() =>
  import('./safety/TrainingShell').then((m) => ({ default: m.TrainingShell })),
);

function PageLoading() {
  const { t } = useTranslation();
  return (
    <p role="status" data-testid="page-loading">
      {t('common.loading')}
    </p>
  );
}

/** Two lens outlines; the overlap where both eyes' images meet is filled. Ink only. */
function FusionMark() {
  return (
    <svg width="34" height="22" viewBox="0 0 34 22" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="fusion-left">
          <circle cx="12" cy="11" r="9" />
        </clipPath>
      </defs>
      <circle cx="22" cy="11" r="9" fill="currentColor" clipPath="url(#fusion-left)" />
      <circle cx="12" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="22" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

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
    void logError('react', error, info.componentStack ?? '');
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
        <span className="row">
          <Button onClick={() => window.location.reload()}>{t('app.reload')}</Button>
          <ReportProblemButton />
        </span>
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
    // The recovery may settle after unmount (tests tear the page down quickly); ignore it then.
    let active = true;
    void ensureSchemaVersion();
    recoverInProgressSessions()
      .catch(() => 0)
      .then((n) => {
        if (!active) return;
        setRecovered(n);
        // Signed in to cloud sync on this device: bring this device up to date.
        void autoSync();
      });
    return () => {
      active = false;
    };
  }, []);
  const locked = settings.trainingLock.locked;
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          // Hash routing: move focus without changing the route.
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        {t('app.skip')}
      </a>
      <header className="app-header">
        <NavLink to="/" className="brand" end>
          <FusionMark />
          {t('app.name')}
        </NavLink>
        <nav aria-label="main">
          <NavLink to="/" end>
            {t('nav.overview')}
          </NavLink>
          <NavLink to="/calibration">{t('nav.calibration')}</NavLink>
          <NavLink to="/history">{t('nav.history')}</NavLink>
          <NavLink to="/report">{t('nav.report')}</NavLink>
          <NavLink to="/settings">{t('nav.settings')}</NavLink>
          <NavLink to="/account">{t('nav.account')}</NavLink>
          {locked ? <NavLink to="/red-flag">{t('nav.redFlag')}</NavLink> : null}
        </nav>
      </header>
      <main className="app-main" id="main" tabIndex={-1}>
        <UpdateBanner />
        <ErrorNotice />
        {recovered > 0 ? <Banner tone="warn">{t('app.recovered', { count: recovered })}</Banner> : null}
        {children}
      </main>
      <Footer />
    </div>
  );
}

/** Each page starts at the top, instead of keeping the previous page's scroll position. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Gate({ children }: { children: ReactNode }) {
  const settings = useSettings();
  if (!disclaimerAccepted(settings)) {
    return (
      <DisclaimerScreen
        onAccept={() => {
          settings.acceptDisclaimer();
          window.scrollTo(0, 0);
        }}
      />
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <ScrollToTop />
        <Layout>
          <Gate>
            <Suspense fallback={<PageLoading />}>
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/calibration" element={<CalibrationWizard />} />
                <Route path="/module/:moduleId" element={<ModuleView />} />
                <Route path="/train/:moduleId" element={<TrainingRoute />} />
                <Route path="/history" element={<History />} />
                <Route path="/report" element={<Report />} />
                <Route path="/check" element={<WeeklyCheck />} />
                <Route path="/quick-start" element={<QuickStart />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/red-flag" element={<RedFlagPage />} />
                <Route path="*" element={<Overview />} />
              </Routes>
            </Suspense>
          </Gate>
        </Layout>
      </HashRouter>
    </ErrorBoundary>
  );
}
