import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '../../src/data/db';
import { useSettings } from '../../src/data/settingsStore';
import { initI18n } from '../../src/i18n';
import type * as XrModule from '../../src/engine/renderer/xr';
import type { TrainingCanvasProps } from '../../src/safety/TrainingCanvas';
import { TrainingShell } from '../../src/safety/TrainingShell';
import { dayKeyOffset } from '../../src/data/util';
import { makeCalibration, makeCheck, makeSession } from '../fixtures/factories';

// A headset is "available" in these tests.
vi.mock('../../src/engine/renderer/xr', async (orig) => ({
  ...(await orig<typeof XrModule>()),
  immersiveVrSupported: async () => true,
}));

// The stand-in canvas shows what the shell asked for and can play the headset's part.
vi.mock('../../src/safety/TrainingCanvas', () => ({
  IDLE_PAUSE_MS: 60_000,
  TrainingCanvas: (p: TrainingCanvasProps) => (
    <div data-testid="canvas-stub" data-renderer={p.rendererId} data-vr={String(!!p.vr?.enabled)}>
      <span data-testid="vr-hint">{p.vr?.hint}</span>
      <button onClick={() => p.vr?.onEnded()}>stub-leave-vr</button>
      <button onClick={() => p.vr?.onStop()}>stub-squeeze</button>
    </div>
  ),
}));

void initI18n('en');

function renderShell(moduleId: string) {
  return render(
    <MemoryRouter initialEntries={[`/train/${moduleId}`]}>
      <Routes>
        <Route path="/train/:moduleId" element={<TrainingShell />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  resetDbForTests();
  const st = useSettings.getState();
  st.resetAll();
  st.acceptDisclaimer();
  st.acknowledgeErgonomics();
  st.setRenderer('webxr');
  st.updateCaps({ sessionMaxMinutes: 20 });
  st.setDailyPlanEntry('l1', { minutes: 15 });
  const cal = makeCalibration();
  await getDb().calibrations.put(cal);
  st.setActiveCalibration(cal.id);
});

describe('training in a VR headset', () => {
  it('asks for the comfort notice once; VR sessions never exceed 10 minutes', async () => {
    renderShell('l1');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('ack-vr-comfort'));
    expect(useSettings.getState().vrComfortAcknowledgedAt).not.toBeNull();
    const pre = await screen.findByTestId('vr-pre');
    const minutes = Number(/at most (\d+) minutes/.exec(pre.textContent ?? '')?.[1]);
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThanOrEqual(10);
    await user.click(screen.getByTestId('symptom-submit'));
    const canvas = await screen.findByTestId('canvas-stub');
    expect(canvas).toHaveAttribute('data-vr', 'true');
    expect(canvas).toHaveAttribute('data-renderer', 'webxr');
    expect(screen.getByTestId('hud-timer')).toHaveTextContent(`/ ${minutes}:00`);
    expect(screen.getByTestId('vr-hint')).toHaveTextContent('Squeeze the grip to STOP');
  });

  it('leaving VR pauses the session; squeezing the grip is STOP', async () => {
    useSettings.getState().acknowledgeVrComfort();
    renderShell('l1');
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('symptom-submit'));
    await user.click(await screen.findByRole('button', { name: 'stub-leave-vr' }));
    expect(await screen.findByTestId('overlay-paused')).toHaveTextContent('You left VR');
    await user.click(screen.getByTestId('resume-button'));
    await user.click(screen.getByRole('button', { name: 'stub-squeeze' }));
    expect(await screen.findByTestId('overlay-stop')).toBeInTheDocument();
  });

  it('modules not tested in VR fall back to the red/cyan glasses', async () => {
    useSettings.getState().acknowledgeVrComfort();
    // Unlock the later stages: six comfortable L1/L2 sessions on three days.
    for (let i = 0; i < 6; i++) {
      const day = dayKeyOffset(-1 - Math.floor(i / 2));
      const check = makeCheck({ at: `${day}T10:0${i}:00.000Z` });
      await getDb().symptomChecks.put(check);
      await getDb().sessions.put(
        makeSession({
          moduleId: i % 2 ? 'l2' : 'l1',
          day,
          startedAt: `${day}T09:0${i}:00.000Z`,
          postCheckId: check.id,
        }),
      );
    }
    useSettings.getState().setDailyPlanEntry('reading', { enabled: true, minutes: 5 });
    renderShell('reading');
    expect(await screen.findByTestId('vr-fallback')).toHaveTextContent('not available in VR yet');
    expect(screen.queryByTestId('vr-pre')).toBeNull();
    await userEvent.setup().click(screen.getByTestId('symptom-submit'));
    expect(await screen.findByTestId('canvas-stub')).toHaveAttribute('data-renderer', 'anaglyph-canvas2d');
  });
});
