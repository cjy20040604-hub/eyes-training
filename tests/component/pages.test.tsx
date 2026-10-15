import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { History } from '../../src/dashboard/History';
import { Overview } from '../../src/dashboard/Overview';
import { Report } from '../../src/dashboard/Report';
import { SettingsPage } from '../../src/dashboard/SettingsPage';
import { getDb, resetDbForTests } from '../../src/data/db';
import { logError, resetErrorLogLimiter } from '../../src/data/errorLog';
import type { CalibrationProfile, SessionRecord, SymptomCheck } from '../../src/data/schema';
import { useSettings } from '../../src/data/settingsStore';
import { dayKeyOffset } from '../../src/data/util';
import { changeLocale, initI18n } from '../../src/i18n';
import { makeCalibration, makeCheck, makeSession } from '../fixtures/factories';

void initI18n('en');

function renderPage(ui: ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

/** Six comfortable L1/L2 sessions on the last three days (enough to unlock L3 and later). */
function comfortableHistory(): { sessions: SessionRecord[]; checks: SymptomCheck[] } {
  const sessions: SessionRecord[] = [];
  const checks: SymptomCheck[] = [];
  [-3, -3, -2, -2, -1, -1].forEach((off, i) => {
    const day = dayKeyOffset(off);
    const check = makeCheck({ at: `${day}T10:0${i}:00.000Z` });
    sessions.push(
      makeSession({
        moduleId: i % 2 ? 'l2' : 'l1',
        day,
        startedAt: `${day}T09:0${i}:00.000Z`,
        endedAt: `${day}T09:1${i}:00.000Z`,
        postCheckId: check.id,
        intensityMetric: i % 2 ? 'offsetRemovedPercent' : 'dominantContrastRatio',
        metrics: i % 2 ? { alignments: 6, meanResidualDelta: 1.5 - i * 0.1 } : { timeInCageFraction: 0.6 },
      }),
    );
    checks.push({ ...check, sessionId: sessions[i]!.id });
  });
  return { sessions, checks };
}

async function seed(
  opts: { calibration?: CalibrationProfile | null; sessions?: SessionRecord[]; checks?: SymptomCheck[] } = {},
) {
  const db = getDb();
  const cal = opts.calibration === undefined ? makeCalibration() : opts.calibration;
  if (cal) await db.calibrations.put(cal);
  if (opts.sessions) await db.sessions.bulkPut(opts.sessions);
  if (opts.checks) await db.symptomChecks.bulkPut(opts.checks);
  if (cal) useSettings.getState().setActiveCalibration(cal.id);
  return cal;
}

beforeEach(() => {
  resetDbForTests();
  resetErrorLogLimiter();
  useSettings.getState().resetAll();
  useSettings.getState().acceptDisclaimer();
});

afterEach(async () => {
  await changeLocale('en');
});

describe('Overview', () => {
  it('without a calibration, points to the calibration wizard first', async () => {
    await seed({ calibration: null });
    renderPage(<Overview />);
    expect(await screen.findByTestId('start-calibration')).toHaveAttribute('href', '/calibration');
    expect(screen.queryByTestId('start-next')).toBeNull();
  });

  it('lists L1 and L2 as today’s plan and explains what unlocks the later stages', async () => {
    await seed();
    renderPage(<Overview />);
    expect(await screen.findByTestId('module-row-l1')).toBeInTheDocument();
    expect(screen.getByTestId('module-row-l2')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('start-next')).toHaveAttribute('href', '/train/l1'));
    expect(screen.getByTestId('later-l3')).toHaveTextContent('0 of 6 comfortable sessions, 0 of 3 days');
    expect(screen.getByTestId('later-l4')).toHaveTextContent('clinician agreement');
  });

  it('offers unlocked stages under "Ready to add" and adds one to the plan', async () => {
    const { sessions, checks } = comfortableHistory();
    await seed({ sessions, checks });
    renderPage(<Overview />);
    const add = await screen.findByTestId('add-l3');
    expect(screen.queryByTestId('later-l3')).toBeNull();
    await userEvent.setup().click(add);
    expect(await screen.findByTestId('start-l3')).toBeInTheDocument();
    expect(useSettings.getState().dailyPlan.l3?.enabled).toBe(true);
  });

  it('a STOP in the last three sessions locks the later stages again', async () => {
    const { sessions, checks } = comfortableHistory();
    sessions[5] = {
      ...sessions[5]!,
      status: 'stopped',
      events: [{ at: sessions[5]!.startedAt, type: 'stop' }],
    };
    await seed({ sessions, checks });
    renderPage(<Overview />);
    // The overview first renders before the data has loaded; wait for the loaded state.
    await waitFor(() => expect(screen.getByTestId('later-l3')).toHaveTextContent('STOP'));
  });

  it('hides start buttons once the daily cap is used up', async () => {
    const today = dayKeyOffset(0);
    const sessions = [0, 1, 2].map((i) =>
      makeSession({
        day: today,
        startedAt: `${today}T08:0${i}:00.000Z`,
        actualMinutes: 10,
        plannedMinutes: 10,
      }),
    );
    await seed({ sessions });
    renderPage(<Overview />);
    expect(await screen.findByText('Daily cap reached')).toBeInTheDocument();
    expect(screen.queryByTestId('start-l1')).toBeNull();
  });
});

describe('Report', () => {
  it('summarizes adherence, setup and measures for the period', async () => {
    const { sessions, checks } = comfortableHistory();
    await seed({ sessions, checks });
    renderPage(<Report />);
    const adherence = await screen.findByTestId('report-adherence');
    await waitFor(() => expect(adherence).toHaveTextContent('3 of 30 days'));
    expect(adherence).toHaveTextContent('6 (6 completed, 0 stopped)');
    expect(screen.getByText('7Δ Base-in', { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId('report-measures')).toHaveTextContent('perceived offset');
    expect(screen.getByTestId('report-print')).toBeInTheDocument();
  });

  it('switching to "All time" counts days from the first session', async () => {
    const { sessions, checks } = comfortableHistory();
    await seed({ sessions, checks });
    renderPage(<Report />);
    const adherence = await screen.findByTestId('report-adherence');
    await waitFor(() => expect(adherence).toHaveTextContent('3 of 30 days'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'All time' }));
    await waitFor(() => expect(adherence).toHaveTextContent('3 of 4 days'));
  });
});

describe('History', () => {
  it('shows progress charts and one row per session', async () => {
    const { sessions, checks } = comfortableHistory();
    await seed({ sessions, checks });
    renderPage(<History />);
    expect(await screen.findByTestId('trends')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Completed')).toHaveLength(6));
    expect(within(screen.getByTestId('chart-offset')).getByRole('img')).toBeInTheDocument();
  });
});

describe('Settings', () => {
  it('lists logged errors and clears them', async () => {
    await seed();
    await logError('error', new Error('ring stuck'));
    renderPage(<SettingsPage />);
    await waitFor(() => expect(screen.getByTestId('error-log-count')).toHaveTextContent('1 error(s) logged'));
    expect(screen.getByTestId('error-log')).toHaveTextContent('Error: ring stuck');
    await userEvent.setup().click(screen.getByTestId('error-log-clear'));
    await waitFor(() => expect(screen.getByTestId('error-log-count')).toHaveTextContent('0 error(s) logged'));
    expect(await getDb().errorLogs.count()).toBe(0);
  });

  it('switches the interface to Chinese, loading the strings on demand', async () => {
    await seed();
    renderPage(<SettingsPage />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '简体中文' }));
    expect(await screen.findByRole('heading', { name: '设置', level: 1 })).toBeInTheDocument();
    expect(useSettings.getState().locale).toBe('zh-Hans');
  });

  it('caps stay inside their safe limits whatever is typed', async () => {
    await seed();
    renderPage(<SettingsPage />);
    const daily = await screen.findByLabelText('Global daily cap, all modules (minutes)');
    const user = userEvent.setup();
    await user.clear(daily);
    await user.type(daily, '99');
    expect(useSettings.getState().caps.dailyCapMinutes).toBeLessThanOrEqual(40);
  });
});
