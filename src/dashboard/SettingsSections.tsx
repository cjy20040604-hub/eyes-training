import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  backupFileName,
  backupFolderName,
  backupToFolder,
  chooseBackupFolder,
  folderBackupSupported,
  forgetBackupFolder,
  requestPersistentStorage,
  storagePersisted,
  type FolderBackupResult,
} from '../data/backup';
import { MIN_PASSPHRASE_LENGTH, encryptText } from '../data/crypto';
import { downloadText, exportJson } from '../data/exportImport';
import { buildReminderIcs } from '../data/ics';
import { useSettings } from '../data/settingsStore';
import { Banner, Button, Card, Field, Segmented } from '../ui';

const fmtDate = (iso: string | null, lng: string) =>
  iso ? new Date(iso).toLocaleString(lng === 'zh-Hans' ? 'zh-CN' : 'en-GB') : null;

/** Backup: persistent storage, encrypted export, and the optional backup folder. */
export function BackupSection() {
  const { t, i18n } = useTranslation();
  const backup = useSettings((s) => s.backup);
  const markBackup = useSettings((s) => s.markBackup);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'warn'; text: string } | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const folderSupported = folderBackupSupported();

  useEffect(() => {
    void storagePersisted().then(setPersisted);
    if (folderSupported) void backupFolderName().then(setFolder);
  }, [folderSupported]);

  const passError =
    pass.length > 0 && pass.length < MIN_PASSPHRASE_LENGTH
      ? t('backup.passTooShort', { n: MIN_PASSPHRASE_LENGTH })
      : pass2.length > 0 && pass !== pass2
        ? t('backup.passMismatch')
        : null;
  const canEncrypt = pass.length >= MIN_PASSPHRASE_LENGTH && pass === pass2 && !busy;

  const folderMessage = (r: FolderBackupResult) =>
    r === 'written'
      ? { tone: 'success' as const, text: t('backup.folderWritten') }
      : { tone: 'warn' as const, text: t(`backup.folder.${r}`) };

  return (
    <Card title={t('backup.title')}>
      <div id="backup" />
      <p className="hint">{t('backup.intro')}</p>
      {message ? (
        <Banner tone={message.tone} role="status">
          {message.text}
        </Banner>
      ) : null}
      <dl className="kv">
        <dt>{t('backup.last')}</dt>
        <dd data-testid="backup-last">
          {fmtDate(backup.lastBackupAt, i18n.language) ?? t('backup.neverShort')}
        </dd>
        <dt>{t('backup.persistence')}</dt>
        <dd data-testid="storage-persisted">
          {persisted === null
            ? t('backup.persistUnknown')
            : persisted
              ? t('backup.persistYes')
              : t('backup.persistNo')}{' '}
          {persisted === false ? (
            <Button
              small
              onClick={async () => {
                const r = await requestPersistentStorage();
                setPersisted(r === 'granted');
                setMessage(
                  r === 'granted'
                    ? { tone: 'success', text: t('backup.persistGranted') }
                    : { tone: 'warn', text: t('backup.persistDenied') },
                );
              }}
            >
              {t('backup.persistAsk')}
            </Button>
          ) : null}
        </dd>
      </dl>

      <h3 className="subhead">{t('backup.encryptTitle')}</h3>
      <p className="hint">{t('backup.encryptHint')}</p>
      <Field label={t('backup.pass')} htmlFor="backup-pass">
        <input
          id="backup-pass"
          type="password"
          autoComplete="new-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />
      </Field>
      <Field label={t('backup.pass2')} htmlFor="backup-pass2">
        <input
          id="backup-pass2"
          type="password"
          autoComplete="new-password"
          value={pass2}
          onChange={(e) => setPass2(e.target.value)}
        />
      </Field>
      {passError ? <p className="field-error">{passError}</p> : null}
      <Button
        variant="primary"
        disabled={!canEncrypt}
        data-testid="export-encrypted"
        onClick={async () => {
          setBusy(true);
          try {
            downloadText(backupFileName(new Date(), true), await encryptText(await exportJson(), pass));
            markBackup('manual');
            setPass('');
            setPass2('');
            setMessage({ tone: 'success', text: t('backup.encryptDone') });
          } catch (e) {
            setMessage({ tone: 'warn', text: e instanceof Error ? e.message : String(e) });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? t('backup.encrypting') : t('backup.encryptButton')}
      </Button>

      {folderSupported ? (
        <>
          <h3 className="subhead">{t('backup.folderTitle')}</h3>
          <p className="hint">{t('backup.folderHint')}</p>
          <p data-testid="backup-folder">
            {folder ? t('backup.folderChosen', { name: folder }) : t('backup.folderNone')}
            {folder && backup.lastAutoBackupAt
              ? ` ${t('backup.folderLast', { date: fmtDate(backup.lastAutoBackupAt, i18n.language) })}`
              : ''}
          </p>
          <div className="row">
            <Button
              onClick={async () => {
                const name = await chooseBackupFolder();
                if (name) {
                  setFolder(name);
                  setMessage(folderMessage(await backupToFolder(true)));
                }
              }}
            >
              {folder ? t('backup.folderChange') : t('backup.folderChoose')}
            </Button>
            {folder ? (
              <>
                <Button onClick={async () => setMessage(folderMessage(await backupToFolder(true)))}>
                  {t('backup.folderNow')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await forgetBackupFolder();
                    setFolder(null);
                  }}
                >
                  {t('backup.folderForget')}
                </Button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </Card>
  );
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Weekly goal and calendar reminders. */
export function RemindersSection() {
  const { t, i18n } = useTranslation();
  const goal = useSettings((s) => s.weeklyGoalDays);
  const reminder = useSettings((s) => s.reminder);
  const setGoal = useSettings((s) => s.setWeeklyGoalDays);
  const setReminder = useSettings((s) => s.setReminder);
  const locale = i18n.language === 'zh-Hans' ? 'zh-CN' : 'en-GB';
  const dayName = (d: number) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2024, 0, 7 + d)); // 7 Jan 2024 = Sunday

  return (
    <Card title={t('goal.settingsTitle')}>
      <div id="reminders" />
      <Field label={t('goal.daysPerWeek')}>
        <Segmented
          value={goal}
          onChange={setGoal}
          label={t('goal.daysPerWeek')}
          options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))}
        />
      </Field>
      <p className="hint">{t('goal.daysHint')}</p>

      <h3 className="subhead">{t('goal.reminderTitle')}</h3>
      <p className="hint">{t('goal.reminderHint')}</p>
      <fieldset className="weekday-picker">
        <legend>{t('goal.reminderDays')}</legend>
        {WEEKDAY_ORDER.map((d) => (
          <label key={d} className="row">
            <input
              type="checkbox"
              checked={reminder.weekdays.includes(d)}
              onChange={(e) =>
                setReminder({
                  weekdays: e.target.checked
                    ? [...reminder.weekdays, d]
                    : reminder.weekdays.filter((x) => x !== d),
                })
              }
              data-testid={`reminder-day-${d}`}
            />
            <span>{dayName(d)}</span>
          </label>
        ))}
      </fieldset>
      <Field label={t('goal.reminderTime')} htmlFor="reminder-time">
        <input
          id="reminder-time"
          type="time"
          value={reminder.time}
          onChange={(e) => setReminder({ time: e.target.value })}
        />
      </Field>
      <Button
        disabled={reminder.weekdays.length === 0}
        data-testid="download-ics"
        onClick={() =>
          downloadText(
            'eyes-training-reminder.ics',
            buildReminderIcs({
              weekdays: reminder.weekdays,
              time: reminder.time,
              title: t('goal.icsTitle'),
              description: t('goal.icsBody'),
              url: window.location.href.split('#')[0],
            }),
            'text/calendar',
          )
        }
      >
        {t('goal.downloadIcs')}
      </Button>
    </Card>
  );
}
