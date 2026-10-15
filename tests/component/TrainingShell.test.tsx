import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '../../src/data/db';
import { useSettings } from '../../src/data/settingsStore';
import type { FlashReport } from '../../src/engine/flashDetector';
import { initI18n } from '../../src/i18n';
import type { TrainingCanvasProps } from '../../src/safety/TrainingCanvas';
import { TrainingShell } from '../../src/safety/TrainingShell';
import { makeCalibration } from '../fixtures/factories';

/*
 * The stimulus needs a real canvas (covered by Playwright). Here a stand-in lets the test
 * play the canvas's part: report a flash, report idleness, and show whether it may run.
 */
vi.mock('../../src/safety/TrainingCanvas', () => {
  const flash = (over: Partial<FlashReport>): FlashReport => ({
    level: 'danger',
    flashRate: 3.5,
    redFlashRate: 0,
    flashingAreaFraction: 0.3,
    timestampMs: 0,
    ...over,
  });
  return {
    IDLE_PAUSE_MS: 60_000,
    TrainingCanvas: (p: TrainingCanvasProps) => (
      <div data-testid="canvas-stub" data-running={String(p.running)}>
        <button onClick={() => p.onFlash(flash({}))}>stub-flash</button>
        <button onClick={() => p.onFlash(flash({ unverifiable: true }))}>stub-unverifiable</button>
        <button onClick={() => p.onIdle?.()}>stub-idle</button>
      </div>
    ),
  };
});

void initI18n('en');

function renderShell(moduleId = 'l1') {
  return render(
    <MemoryRouter initialEntries={[`/train/${moduleId}`]}>
      <Routes>
        <Route path="/train/:moduleId" element={<TrainingShell />} />
        <Route path="/red-flag" element={<p>red flag page</p>} />
        <Route path="/" element={<p>overview</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function withCalibration() {
  const cal = makeCalibration();
  await getDb().calibrations.put(cal);
  useSettings.getState().setActiveCalibration(cal.id);
}

async function startSession() {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId('symptom-submit'));
  expect(await screen.findByTestId('canvas-stub')).toBeInTheDocument();
  return user;
}

beforeEach(() => {
  resetDbForTests();
  useSettings.getState().resetAll();
  useSettings.getState().acceptDisclaimer();
  useSettings.getState().acknowledgeErgonomics();
});

describe('TrainingShell', () => {
  it('is blocked without a calibration and links to the wizard', async () => {
    renderShell();
    expect(await screen.findByTestId('block-no-calibration')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Calibration' })).toBeInTheDocument();
  });

  it('shows the ergonomics card before the first session only', async () => {
    useSettings.getState().resetAll();
    useSettings.getState().acceptDisclaimer();
    await withCalibration();
    renderShell();
    await userEvent.setup().click(await screen.findByTestId('ack-ergonomics'));
    expect(await screen.findByTestId('symptom-check-pre')).toBeInTheDocument();
    expect(useSettings.getState().ergonomicsAcknowledgedAt).not.toBeNull();
  });

  it('does not start when double vision is already frequent before the session', async () => {
    await withCalibration();
    renderShell();
    const group = await screen.findByRole('group', { name: /double vision/i });
    const user = userEvent.setup();
    await user.click(within(group).getByRole('button', { name: 'Often' }));
    await user.click(screen.getByTestId('symptom-submit'));
    expect(await screen.findByTestId('block-symptoms')).toBeInTheDocument();
    expect(await getDb().sessions.count()).toBe(0);
  });

  it('a red flag before the session locks training and opens the red-flag page', async () => {
    await withCalibration();
    renderShell();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('redflag-ptosis'));
    await user.click(screen.getByTestId('symptom-submit'));
    expect(await screen.findByText('red flag page')).toBeInTheDocument();
    expect(useSettings.getState().trainingLock.locked).toBe(true);
    expect((await getDb().safetyEvents.toArray()).map((e) => e.type)).toEqual(['red-flag']);
  });

  it('STOP ends the session, asks how you feel, and records a stopped session', async () => {
    await withCalibration();
    renderShell();
    const user = await startSession();
    await user.click(screen.getByTestId('stop-button'));
    expect(await screen.findByTestId('overlay-stop')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas-stub')).toBeNull();
    await user.click(screen.getByTestId('symptom-submit'));
    expect(await screen.findByTestId('summary-minutes')).toBeInTheDocument();
    const [session] = await getDb().sessions.toArray();
    expect(session?.status).toBe('stopped');
    expect(session?.postCheckId).not.toBeNull();
    expect(session?.events.map((e) => e.type)).toContain('stop');
    await waitFor(async () =>
      expect((await getDb().safetyEvents.toArray()).map((e) => e.type)).toContain('stop'),
    );
  });

  it('a flash warning pauses the stimulus and can be resumed', async () => {
    await withCalibration();
    renderShell();
    const user = await startSession();
    await user.click(screen.getByRole('button', { name: 'stub-flash' }));
    expect(await screen.findByTestId('overlay-flash')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-running', 'false');
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.queryByTestId('overlay-flash')).toBeNull();
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-running', 'true');
    await waitFor(async () =>
      expect((await getDb().safetyEvents.toArray()).map((e) => e.type)).toContain('flash-pause'),
    );
  });

  it('an unverifiable picture cannot be resumed, only stopped', async () => {
    await withCalibration();
    renderShell();
    const user = await startSession();
    await user.click(screen.getByRole('button', { name: 'stub-unverifiable' }));
    const overlay = await screen.findByTestId('overlay-flash');
    expect(within(overlay).queryByRole('button', { name: 'Resume' })).toBeNull();
    await user.click(within(overlay).getByRole('button', { name: /^STOP/ }));
    expect(await screen.findByTestId('overlay-stop')).toBeInTheDocument();
  });

  it('idle time pauses the session until the user resumes', async () => {
    await withCalibration();
    renderShell();
    const user = await startSession();
    await user.click(screen.getByRole('button', { name: 'stub-idle' }));
    expect(await screen.findByTestId('overlay-paused')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-running', 'false');
    await user.click(screen.getByTestId('resume-button'));
    expect(screen.queryByTestId('overlay-paused')).toBeNull();
    const [session] = await getDb().sessions.toArray();
    expect(session?.status).toBe('in-progress');
  });

  it('leaving mid-session closes it as aborted instead of leaving it in progress', async () => {
    await withCalibration();
    const view = renderShell();
    await startSession();
    view.unmount();
    await waitFor(async () => expect((await getDb().sessions.toArray())[0]?.status).toBe('aborted'));
  });
});
