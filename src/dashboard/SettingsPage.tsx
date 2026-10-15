import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDb } from '../data/db';
import { downloadText, exportJson, importJson } from '../data/exportImport';
import { useAllData } from '../data/hooks';
import { useSettings } from '../data/settingsStore';
import { RENDERER_IDS } from '../engine/renderer';
import { changeLocale } from '../i18n';
import { Banner, Button, Card, Field, Segmented } from '../ui';
import { Diagnostics } from './Diagnostics';

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useSettings();
  const all = useAllData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [includeErrorLog, setIncludeErrorLog] = useState(false);

  const onImport = async (file: File, mode: 'merge' | 'replace') => {
    try {
      const res = await importJson(await file.text(), mode);
      setMessage(
        t('settings.importDone', {
          sessions: res.sessions,
          calibrations: res.calibrations,
          skipped: res.skipped,
        }),
      );
      all.reload();
    } catch (e) {
      setMessage(t('settings.importFailed', { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <div>
      <h1>{t('settings.title')}</h1>
      {message ? <Banner tone="info">{message}</Banner> : null}

      <Card title={t('settings.general')}>
        <Field label={t('settings.language')}>
          <Segmented
            value={settings.locale}
            onChange={(l) => {
              settings.setLocale(l);
              void changeLocale(l);
            }}
            label={t('settings.language')}
            options={[
              { value: 'en', label: 'English' },
              { value: 'zh-Hans', label: '简体中文' },
            ]}
          />
        </Field>
        <Field label={t('settings.renderer')} hint={t('settings.rendererHint')}>
          <Segmented
            value={settings.rendererId}
            onChange={settings.setRenderer}
            label={t('settings.renderer')}
            options={RENDERER_IDS.map((r) => ({ value: r, label: r }))}
            disabledValues={['webxr']}
          />
        </Field>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(e) => settings.setReducedMotion(e.target.checked)}
          />
          <span>{t('settings.reducedMotion')}</span>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.cyclotorsionEnabled}
            onChange={(e) => settings.setCyclotorsionEnabled(e.target.checked)}
          />
          <span>{t('settings.cyclotorsion')}</span>
        </label>
        <p className="hint">{t('settings.cyclotorsionHint')}</p>
      </Card>

      <Card title={t('settings.caps')}>
        <Field label={t('settings.dailyCap')} htmlFor="daily-cap">
          <input
            id="daily-cap"
            type="number"
            min={5}
            max={40}
            value={settings.caps.dailyCapMinutes}
            onChange={(e) =>
              settings.updateCaps({ dailyCapMinutes: Math.max(5, Math.min(40, Number(e.target.value))) })
            }
          />
        </Field>
        <Field label={t('settings.sessionMax')} htmlFor="session-max">
          <input
            id="session-max"
            type="number"
            min={2}
            max={20}
            value={settings.caps.sessionMaxMinutes}
            onChange={(e) =>
              settings.updateCaps({ sessionMaxMinutes: Math.max(2, Math.min(20, Number(e.target.value))) })
            }
          />
        </Field>
        <Field label={t('settings.breakEvery')} htmlFor="break-every">
          <input
            id="break-every"
            type="number"
            min={2}
            max={10}
            value={settings.caps.microBreakEveryMinutes}
            onChange={(e) =>
              settings.updateCaps({
                microBreakEveryMinutes: Math.max(2, Math.min(10, Number(e.target.value))),
              })
            }
          />
        </Field>
        <Field label={t('settings.breakSeconds')} htmlFor="break-seconds">
          <input
            id="break-seconds"
            type="number"
            min={10}
            max={120}
            value={settings.caps.microBreakSeconds}
            onChange={(e) =>
              settings.updateCaps({ microBreakSeconds: Math.max(10, Math.min(120, Number(e.target.value))) })
            }
          />
        </Field>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.caps.twentyTwentyTwenty}
            onChange={(e) => settings.updateCaps({ twentyTwentyTwenty: e.target.checked })}
          />
          <span>{t('settings.twenty')}</span>
        </label>
      </Card>

      <Card title={t('settings.clinician')}>
        <p className="hint">{t('settings.clinicianHint')}</p>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.clinicianAgreement}
            onChange={(e) => settings.setClinicianAgreement(e.target.checked)}
            data-testid="clinician-toggle"
          />
          <span>{t('settings.clinicianToggle')}</span>
        </label>
        <Field label={t('settings.clinicianNotes')} htmlFor="clinician-notes">
          <textarea
            id="clinician-notes"
            value={settings.clinicianNotes}
            onChange={(e) => settings.setClinicianNotes(e.target.value)}
            maxLength={2000}
          />
        </Field>
        {settings.progressionLock.locked ? (
          <div>
            <Banner tone="warn" title={t('overview.progressionLocked')}>
              {settings.progressionLock.reason}
            </Banner>
            <Button onClick={() => settings.setProgressionLock(false)}>
              {t('settings.clearProgressionLock')}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card title={t('settings.profiles')}>
        {(all.data?.calibrations ?? []).length === 0 ? (
          <p className="hint">{t('settings.noProfiles')}</p>
        ) : null}
        <table>
          <tbody>
            {(all.data?.calibrations ?? []).map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name}
                  {settings.activeCalibrationId === c.id ? ` (${t('settings.active')})` : ''}
                </td>
                <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                <td>
                  {c.device.ppi} PPI, {c.viewingDistanceCm} cm
                </td>
                <td className="row">
                  <Button
                    small
                    onClick={() => settings.setActiveCalibration(c.id)}
                    disabled={settings.activeCalibrationId === c.id}
                  >
                    {t('settings.activate')}
                  </Button>
                  <Button
                    small
                    onClick={() => downloadText(`calibration-${c.id}.json`, JSON.stringify(c, null, 2))}
                  >
                    {t('settings.export')}
                  </Button>
                  <Button
                    small
                    variant="danger"
                    onClick={async () => {
                      await getDb().calibrations.delete(c.id);
                      if (settings.activeCalibrationId === c.id) settings.setActiveCalibration(null);
                      all.reload();
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title={t('settings.data')}>
        <p className="hint">{t('settings.dataHint')}</p>
        <div className="row">
          <Button
            onClick={async () =>
              downloadText(
                `eyes-training-backup-${new Date().toISOString().slice(0, 10)}.json`,
                await exportJson({ includeErrorLog }),
              )
            }
          >
            {t('settings.exportAll')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="sr-only"
            aria-label={t('settings.importMerge')}
            onChange={(e) => e.target.files?.[0] && void onImport(e.target.files[0], 'merge')}
          />
          <Button onClick={() => fileRef.current?.click()}>{t('settings.importMerge')}</Button>
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={includeErrorLog}
            onChange={(e) => setIncludeErrorLog(e.target.checked)}
            data-testid="export-include-errors"
          />
          <span>{t('settings.diagnostics.includeInExport')}</span>
        </label>
        <div className="row" style={{ marginTop: 12 }}>
          {!confirmReset ? (
            <Button variant="danger" onClick={() => setConfirmReset(true)}>
              {t('settings.resetAll')}
            </Button>
          ) : (
            <>
              <span>{t('settings.resetConfirm')}</span>
              <Button
                variant="danger"
                onClick={async () => {
                  const db = getDb();
                  await Promise.all([
                    db.calibrations.clear(),
                    db.sessions.clear(),
                    db.symptomChecks.clear(),
                    db.safetyEvents.clear(),
                    db.errorLogs.clear(),
                  ]);
                  settings.resetAll();
                  setConfirmReset(false);
                  all.reload();
                }}
              >
                {t('common.confirm')}
              </Button>
              <Button onClick={() => setConfirmReset(false)}>{t('common.cancel')}</Button>
            </>
          )}
        </div>
      </Card>

      <Diagnostics />
    </div>
  );
}
