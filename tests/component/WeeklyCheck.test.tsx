import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeeklyCheck } from '../../src/assessment/WeeklyCheck';
import { getDb, resetDbForTests } from '../../src/data/db';
import { useSettings } from '../../src/data/settingsStore';
import { initI18n } from '../../src/i18n';
import { makeCalibration } from '../fixtures/factories';

void initI18n('en');

function renderCheck() {
  return render(
    <MemoryRouter initialEntries={['/check']}>
      <Routes>
        <Route path="/check" element={<WeeklyCheck />} />
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

beforeEach(() => {
  resetDbForTests();
  useSettings.getState().resetAll();
  useSettings.getState().acceptDisclaimer();
});

afterEach(() => vi.useRealTimers());

describe('weekly check', () => {
  it('needs a calibration first', async () => {
    renderCheck();
    expect(await screen.findByRole('link', { name: 'Calibration' })).toBeInTheDocument();
  });

  it('runs all four measurements and saves one assessment with its symptom checks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await withCalibration();
    renderCheck();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.click(await screen.findByTestId('symptom-submit'));
    // 1. Worth 4-dot
    expect(await screen.findByTestId('check-step')).toHaveTextContent('Step 1 of 4');
    await user.click(screen.getByRole('button', { name: '4' }));
    await user.click(screen.getByTestId('check-next'));
    // 2. Alignment twice: move the cross, then confirm.
    expect(screen.getByTestId('check-step')).toHaveTextContent('Step 2 of 4');
    await user.click(screen.getByTestId('align-left'));
    await user.click(screen.getByTestId('align-done'));
    await user.click(screen.getByTestId('align-right'));
    await user.click(screen.getByTestId('align-done'));
    // 3. Contrast balance: "they look equal" twice ends it.
    await user.click(screen.getByTestId('balance-equal'));
    await user.click(screen.getByTestId('balance-equal'));
    // 4. Stereo: answer "can't tell" until the probe stops (no feedback, 0.5 s between patterns).
    expect(screen.getByTestId('check-step')).toHaveTextContent('Step 4 of 4');
    for (let i = 0; i < 40 && screen.queryByTestId('stereo-cant'); i++) {
      await user.click(screen.getByTestId('stereo-cant'));
      act(() => {
        vi.advanceTimersByTime(600);
      });
    }
    await user.click(await screen.findByTestId('symptom-submit'));
    expect(await screen.findByTestId('check-result')).toHaveTextContent('baseline');

    const [a] = await getDb().assessments.toArray();
    expect(a).toMatchObject({ status: 'completed', worth: { dotsSeen: 4, result: 'fusion' } });
    expect(a!.alignment?.horizontalDelta).toHaveLength(2);
    expect(a!.balance?.ratio).toBe(1);
    expect(a!.stereo).toMatchObject({ trials: 30, cantTell: 30, thresholdArcsec: null });
    const checks = await getDb().symptomChecks.toArray();
    expect(checks.map((c) => c.phase).sort()).toEqual(['post', 'pre']);
  });

  it('STOP keeps what was measured and records a stopped check', async () => {
    await withCalibration();
    renderCheck();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('symptom-submit'));
    await user.click(await screen.findByRole('button', { name: '3' }));
    await user.click(screen.getByTestId('check-next'));
    await user.keyboard('{Escape}');
    expect(await screen.findByTestId('overlay-stop')).toBeInTheDocument();
    await user.click(screen.getByTestId('symptom-submit'));
    expect(await screen.findByTestId('check-result')).toBeInTheDocument();
    const [a] = await getDb().assessments.toArray();
    expect(a).toMatchObject({ status: 'stopped', worth: { dotsSeen: 3 }, alignment: null, stereo: null });
    await waitFor(async () =>
      expect((await getDb().safetyEvents.toArray()).map((e) => e.type)).toContain('stop'),
    );
  });

  it('a red flag before the check locks training', async () => {
    await withCalibration();
    renderCheck();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('redflag-ptosis'));
    await user.click(screen.getByTestId('symptom-submit'));
    expect(await screen.findByText('red flag page')).toBeInTheDocument();
    expect(useSettings.getState().trainingLock.locked).toBe(true);
  });
});
