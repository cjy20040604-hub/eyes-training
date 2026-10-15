import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { FlashReport } from '../../src/engine/flashDetector';
import { initI18n } from '../../src/i18n';
import { getModule } from '../../src/modules/registry';
import {
  BlockedView,
  BreakOverlay,
  FlashOverlay,
  PausedOverlay,
  SummaryView,
  TrainingHud,
} from '../../src/safety/TrainingViews';

void initI18n('en');

const STEPPED_BACK = 'Difficulty stepped back';
const PROGRESSION_LOCKED = 'Progression paused — please consult an orthoptist';

const report = (over: Partial<FlashReport> = {}): FlashReport => ({
  level: 'danger',
  flashRate: 3.2,
  redFlashRate: 0,
  flashingAreaFraction: 0.5,
  timestampMs: 0,
  ...over,
});

describe('training views', () => {
  it('a flash warning offers Resume and STOP; an unverifiable one offers only STOP', async () => {
    const onResume = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <FlashOverlay report={report()} canResume onResume={onResume} onStop={onStop} />,
    );
    expect(screen.getByText(/3\.2/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledTimes(1);

    rerender(
      <FlashOverlay
        report={report({ unverifiable: true })}
        canResume={false}
        onResume={onResume}
        onStop={onStop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /^STOP/ }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('the pause overlay explains why it paused', () => {
    const { rerender } = render(<PausedOverlay reason="hidden" onResume={() => {}} />);
    const hiddenText = screen.getByTestId('overlay-paused').textContent;
    rerender(<PausedOverlay reason="idle" onResume={() => {}} />);
    expect(screen.getByTestId('overlay-paused').textContent).not.toBe(hiddenText);
  });

  it('the break overlay counts down whole seconds', () => {
    render(<BreakOverlay leftMs={12_300} />);
    expect(screen.getByTestId('overlay-break')).toHaveTextContent('13');
  });

  it('the HUD shows elapsed / allowed time, score and the module prompt', async () => {
    const onStop = vi.fn();
    render(
      <TrainingHud
        def={getModule('l2')}
        moduleId="l2"
        hud={{ promptKey: 'modules.l2.prompt.align', score: 40, roundProgress: 0.5 }}
        elapsedMs={65_000}
        sessionMs={240_000}
        allowedMinutes={4}
        stopDisabled={false}
        onStop={onStop}
      />,
    );
    expect(screen.getByTestId('hud-timer')).toHaveTextContent('1:05 / 4:00');
    expect(screen.getByTestId('hud-score')).toHaveTextContent('40');
    expect(screen.getByTestId('hud-prompt').textContent).not.toBe('');
    await userEvent.setup().click(screen.getByTestId('stop-button'));
    expect(onStop).toHaveBeenCalled();
  });

  it('a blocked session lists the reasons and links to calibration when needed', () => {
    render(
      <MemoryRouter>
        <BlockedView reasons={['no-calibration', 'cap']} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('block-no-calibration')).toBeInTheDocument();
    expect(screen.getByTestId('block-cap')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Calibration' })).toHaveAttribute('href', '/calibration');
  });

  it('the summary shows minutes, the next difficulty and the session metrics', () => {
    render(
      <MemoryRouter>
        <SummaryView
          def={getModule('l1')}
          outcome={{
            steppedBack: false,
            progressionLocked: false,
            minutes: 4.2,
            change: 'game-up',
            next: {
              moduleId: 'l1',
              intensityValue: 0.6,
              gameDifficulty: 3,
              updatedAt: '2026-10-01T00:00:00.000Z',
              lastChangeDay: '2026-10-01',
            } as never,
          }}
          metrics={{ timeInCageFraction: 0.75, lastHeartbeatMs: 123 }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('summary-minutes')).toHaveTextContent('4.2');
    expect(screen.getByTestId('summary-change')).toHaveTextContent('3/5');
    expect(screen.getByText('0.75')).toBeInTheDocument();
    expect(screen.queryByText('123')).toBeNull();
  });

  it('the summary warns after a step back and a progression lock', () => {
    render(
      <MemoryRouter>
        <SummaryView
          def={getModule('l1')}
          outcome={{ steppedBack: true, progressionLocked: true, minutes: 2, change: null, next: null }}
          metrics={{ farConfirms: 3 }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('summary-recalibrate')).toBeInTheDocument();
    expect(screen.queryByTestId('summary-change')).toBeNull();
    expect(screen.getByText(STEPPED_BACK)).toBeInTheDocument();
    expect(screen.getByText(PROGRESSION_LOCKED)).toBeInTheDocument();
  });
});
