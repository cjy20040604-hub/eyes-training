import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickStart } from '../../src/calibration/QuickStart';
import { ConsistencySection } from '../../src/dashboard/ConsistencySection';
import { ReportProblemDialog } from '../../src/dashboard/ReportProblem';
import { getDb, resetDbForTests } from '../../src/data/db';
import { useSettings } from '../../src/data/settingsStore';
import { initI18n } from '../../src/i18n';
import { CatchSummary } from '../../src/safety/TrainingViews';
import { AccountPage } from '../../src/sync/AccountPage';
import type * as EngineModule from '../../src/sync/engine';
import { makeSession } from '../fixtures/factories';

void initI18n('en');

beforeEach(() => {
  resetDbForTests();
  useSettings.getState().resetAll();
  useSettings.getState().acceptDisclaimer();
});

describe('quick start', () => {
  it('saves a quick profile from three answers and goes straight to the first session', async () => {
    render(
      <MemoryRouter initialEntries={['/quick-start']}>
        <Routes>
          <Route path="/quick-start" element={<QuickStart />} />
          <Route path="/train/l1" element={<p>first session</p>} />
        </Routes>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    expect(screen.getByTestId('quick-save')).toBeDisabled(); // glasses not answered yet
    await user.click(screen.getByRole('button', { name: 'Desktop monitor' }));
    expect(screen.getByLabelText(/Distance from your eyes/)).toHaveValue(65);
    await user.type(screen.getByLabelText(/Screen diagonal/), '27');
    expect(screen.getByTestId('quick-ppi')).toHaveTextContent('27-inch');
    await user.click(screen.getByRole('button', { name: 'Square B' }));
    await user.click(screen.getByTestId('quick-knows-prism'));
    await user.click(screen.getByTestId('quick-save'));
    expect(await screen.findByText('first session')).toBeInTheDocument();
    const [cal] = await getDb().calibrations.toArray();
    expect(cal).toMatchObject({
      quality: 'quick',
      viewingDistanceCm: 65,
      channels: { left: { channel: 'cyan' }, right: { channel: 'red' } },
      clinicalPrism: { amountDelta: 7, base: 'in' },
    });
    expect(cal!.offset.left.dx).toBeLessThan(0); // base-in on the left eye
    expect(useSettings.getState().activeCalibrationId).toBe(cal!.id);
  });
});

describe('problem report dialog', () => {
  it('previews exactly what would be sent and links to a prefilled GitHub issue', async () => {
    const onClose = vi.fn();
    render(
      <ReportProblemDialog
        entries={[
          {
            id: 'e',
            at: '2026-10-16T10:00:00.000Z',
            kind: 'error',
            message: 'TypeError: x is undefined',
            stack: 'at f (a.js:1:1)',
            route: '/train/l2',
            appVersion: '0.4.0',
          },
        ]}
        onClose={onClose}
      />,
    );
    const user = userEvent.setup();
    expect(screen.getByLabelText('What were you doing? (optional)')).toHaveFocus();
    await user.type(screen.getByLabelText('What were you doing? (optional)'), 'pressing space');
    expect(screen.getByTestId('report-preview')).toHaveTextContent('pressing space');
    expect(screen.getByTestId('report-preview')).toHaveTextContent('TypeError: x is undefined');
    const link = screen.getByTestId('report-github');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('href')).toContain('github.com/cjy20040604-hub/eyes-training/issues/new');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('report consistency views', () => {
  it('the session summary shows check points per eye and explains a doubtful session', () => {
    render(
      <CatchSummary
        session={makeSession({
          moduleId: 'l3',
          metrics: {
            catchShownLeft: 3,
            catchHitLeft: 0,
            catchShownRight: 2,
            catchHitRight: 2,
            catchRate: 0.9,
          },
        })}
      />,
    );
    expect(screen.getByTestId('summary-catch')).toHaveTextContent('left eye: 0 of 3; right eye: 2 of 2');
    expect(screen.getByText(/most left-eye ◇ were missed/)).toBeInTheDocument();
  });

  it('the history / report section summarizes per eye', () => {
    render(
      <ConsistencySection
        chart={false}
        sessions={[
          makeSession({
            moduleId: 'l2',
            metrics: { catchShownLeft: 2, catchHitLeft: 1, catchShownRight: 2, catchHitRight: 2 },
          }),
        ]}
      />,
    );
    expect(screen.getByTestId('consistency-left')).toHaveTextContent('1/2 (50%)');
    expect(screen.getByTestId('consistency-right')).toHaveTextContent('2/2 (100%)');
    expect(screen.getByTestId('consistency-flagged')).toHaveTextContent('0 of 1');
  });
});

describe('account page', () => {
  it('without a configured project it explains that everything stays on this device', () => {
    render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('account-not-configured')).toHaveTextContent('everything stays on this device');
  });

  it('with a project: sign in, set a sync passphrase, encrypt and upload', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.test');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
    let vault: Record<string, unknown> | null = null;
    let session: unknown = null;
    const listeners: Array<(e: string, s: unknown) => void> = [];
    vi.doMock('../../src/sync/supabase', () => ({
      currentSession: async () => session,
      supabase: () => ({
        auth: {
          onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
            listeners.push(cb);
            return { data: { subscription: { unsubscribe() {} } } };
          },
        },
      }),
      signIn: async (email: string) => {
        session = { user: { id: 'u1', email } };
        listeners.forEach((cb) => cb('SIGNED_IN', session));
      },
      signUp: async () => 'confirm-email',
      signOut: async () => {
        session = null;
        listeners.forEach((cb) => cb('SIGNED_OUT', null));
      },
      sendPasswordReset: async () => {},
      supabaseBackend: () => ({
        getVault: async () => (vault ? { ...vault } : null),
        createVault: async (row: Record<string, unknown>) => {
          vault = row;
          return 'ok';
        },
        updateVault: async (row: Record<string, unknown>) => {
          vault = row;
          return 'ok';
        },
        deleteVault: async () => {
          vault = null;
        },
      }),
    }));
    vi.doMock('../../src/sync/engine', async (orig) => {
      const real = await orig<typeof EngineModule>();
      // Fewer key-derivation rounds keep the test fast.
      return { ...real, newSyncKey: (p: string) => real.newSyncKey(p, 2000) };
    });
    const { AccountPage: Configured } = await import('../../src/sync/AccountPage');
    render(
      <MemoryRouter>
        <Configured />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'me@example.org');
    await user.type(screen.getByLabelText('Account password'), 'account-pass');
    await user.click(screen.getByTestId('account-submit'));
    expect(await screen.findByTestId('account-email')).toHaveTextContent('me@example.org');
    expect(await screen.findByTestId('sync-create')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Sync passphrase'), 'my sync passphrase');
    await user.type(screen.getByLabelText('Repeat the sync passphrase'), 'my sync passphrase');
    await user.click(screen.getByTestId('sync-pass-submit'));
    await waitFor(() => expect(vault).not.toBeNull());
    expect(String(vault!['data'])).not.toContain('eyes-training');
    expect(await screen.findByText('Your data is encrypted and stored in the cloud.')).toBeInTheDocument();
    expect(screen.getByTestId('sync-ready')).toBeInTheDocument();
    vi.unstubAllEnvs();
    vi.doUnmock('../../src/sync/supabase');
    vi.doUnmock('../../src/sync/engine');
  });
});
