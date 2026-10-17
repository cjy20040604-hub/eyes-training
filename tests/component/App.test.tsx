import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { resetDbForTests } from '../../src/data/db';
import { useSettings } from '../../src/data/settingsStore';
import { initI18n } from '../../src/i18n';

// The service-worker registration hook comes from the PWA plugin's virtual module.
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

void initI18n('en');

beforeEach(() => {
  resetDbForTests();
  useSettings.getState().resetAll();
  window.location.hash = '#/';
});

describe('App shell', () => {
  it('shows only the disclaimer until it is accepted', async () => {
    render(<App />);
    expect(await screen.findByTestId('accept-disclaimer')).toBeDisabled();
    expect(screen.queryByRole('heading', { name: "Today's training" })).toBeNull();
  });

  it.each([
    ['#/settings', 'Settings'],
    ['#/history', 'History'],
    ['#/report', 'Training summary'],
    ['#/calibration', 'Calibration wizard'],
  ])('loads the page at %s on demand', async (hash, heading) => {
    useSettings.getState().acceptDisclaimer();
    window.location.hash = hash;
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: heading, level: 1 }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('keeps the red-flag page reachable from the menu while training is locked', async () => {
    useSettings.getState().acceptDisclaimer();
    useSettings.getState().setTrainingLock(true, 'test');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Red flag' })).toHaveAttribute('href', '#/red-flag');
  });
});
