import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupReminder, WeeklyCheckCard, WeeklyGoal } from '../../src/dashboard/OverviewCards';
import { SettingsPage } from '../../src/dashboard/SettingsPage';
import { encryptText } from '../../src/data/crypto';
import { getDb, resetDbForTests } from '../../src/data/db';
import { buildExportBundle } from '../../src/data/exportImport';
import { useSettings } from '../../src/data/settingsStore';
import { dayKey } from '../../src/data/util';
import { initI18n } from '../../src/i18n';
import { makeCalibration, makeSession } from '../fixtures/factories';

void initI18n('en');

const downloads: Array<{ name: string; blob: Blob }> = [];

beforeEach(() => {
  resetDbForTests();
  useSettings.getState().resetAll();
  useSettings.getState().acceptDisclaimer();
  downloads.length = 0;
  let n = 0;
  URL.createObjectURL = vi.fn((b: Blob) => {
    downloads.push({ name: '', blob: b });
    return `blob:dl/${++n}`;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const last = downloads[downloads.length - 1];
    if (last) last.name = this.download;
  });
});

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('overview cards', () => {
  it('weekly goal: days trained this week against the goal', () => {
    useSettings.getState().setWeeklyGoalDays(3);
    wrap(<WeeklyGoal sessions={[makeSession({ day: dayKey(), status: 'completed' })]} />);
    expect(screen.getByRole('img', { name: /1 of 3 training days/ })).toBeInTheDocument();
  });

  it('weekly check: first time, due, and not yet due', () => {
    const { rerender } = wrap(<WeeklyCheckCard assessments={[]} enabled />);
    expect(screen.getByTestId('weekly-check-card')).toHaveTextContent('first two checks set your baseline');
    expect(screen.getByTestId('start-weekly-check')).toHaveAttribute('href', '/check');
    const recent = {
      id: 'a',
      at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      day: dayKey(),
      calibrationId: null,
      viewingDistanceCm: 60,
      status: 'completed' as const,
      worth: null,
      alignment: null,
      balance: null,
      stereo: null,
      preCheckId: null,
      postCheckId: null,
      notes: '',
    };
    rerender(
      <MemoryRouter>
        <WeeklyCheckCard assessments={[recent]} enabled={false} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('weekly-check-card')).toHaveTextContent('Next check in 5 day(s)');
    expect(screen.queryByTestId('start-weekly-check')).toBeNull();
  });

  it('backup reminder appears with unsaved sessions and goes away after a backup', async () => {
    const sessions = [1, 2, 3].map(() =>
      makeSession({ status: 'completed', endedAt: new Date().toISOString() }),
    );
    wrap(<BackupReminder sessions={sessions} />);
    await userEvent.setup().click(screen.getByTestId('backup-now'));
    await waitFor(() => expect(screen.queryByTestId('backup-reminder')).toBeNull());
    expect(useSettings.getState().backup.lastBackupAt).not.toBeNull();
    expect(downloads[0]?.name).toMatch(/eyes-training-backup-.*\.json/);
  });
});

describe('settings: backup and reminders', () => {
  it('encrypted export needs matching passphrases of 8+ characters', async () => {
    wrap(<SettingsPage />);
    const user = userEvent.setup();
    const button = await screen.findByTestId('export-encrypted');
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Passphrase (at least 8 characters)'), 'short');
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Passphrase (at least 8 characters)'), 'er-pass');
    await user.type(screen.getByLabelText('Repeat the passphrase'), 'shorter-pas');
    expect(screen.getByText('The passphrases do not match.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Repeat the passphrase'), 's');
    expect(button).toBeEnabled();
  });

  it('imports an encrypted backup after asking for its passphrase', async () => {
    await getDb().calibrations.put(makeCalibration({ id: 'cal_x', name: 'Encrypted profile' }));
    await getDb().sessions.put(makeSession({ id: 'ses_x' }));
    const file = await encryptText(JSON.stringify(await buildExportBundle()), 'long passphrase', 2000);
    resetDbForTests();
    wrap(<SettingsPage />);
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Import JSON (merge)'),
      new File([file], 'backup.bvx', { type: 'application/octet-stream' }),
    );
    expect(await screen.findByText(/This backup is encrypted/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Passphrase of the backup'), 'wrong passphrase');
    await user.click(screen.getByTestId('import-decrypt'));
    expect(await screen.findByText(/Wrong passphrase/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Passphrase of the backup'));
    await user.type(screen.getByLabelText('Passphrase of the backup'), 'long passphrase');
    await user.click(screen.getByTestId('import-decrypt'));
    await waitFor(async () => expect(await getDb().sessions.get('ses_x')).toBeDefined());
    expect(await screen.findByText('Encrypted profile')).toBeInTheDocument();
  });

  it('downloads a calendar reminder for the chosen days and time', async () => {
    wrap(<SettingsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('reminder-day-0')); // add Sunday
    await user.click(screen.getByTestId('reminder-day-6')); // remove Saturday
    expect(useSettings.getState().reminder.weekdays).toEqual([0, 1, 3, 5]);
    await user.click(screen.getByTestId('download-ics'));
    const ics = await downloads[downloads.length - 1]!.blob.text();
    expect(downloads[downloads.length - 1]!.name).toBe('eyes-training-reminder.ics');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=SU,MO,WE,FR');
    expect(ics).toContain('T190000');
  });

  it('VR stays unavailable without a headset', async () => {
    wrap(<SettingsPage />);
    expect(await screen.findByTestId('vr-support')).toHaveTextContent('No VR headset found');
    expect(screen.getByRole('button', { name: 'webxr' })).toBeDisabled();
  });
});
