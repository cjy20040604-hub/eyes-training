import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION, clearErrorLogs, listErrorLogs, type ErrorLogEntry } from '../data/errorLog';
import { Button, Card } from '../ui';
import { ReportProblemButton } from './ReportProblem';

const SHOWN = 20;

/** Settings card listing the local error log (kept on this device only). */
export function Diagnostics() {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<ErrorLogEntry[] | null>(null);

  const reload = useCallback(() => {
    listErrorLogs()
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);
  useEffect(reload, [reload]);

  return (
    <Card title={t('settings.diagnostics.title')}>
      <p className="hint">{t('settings.diagnostics.hint')}</p>
      <p data-testid="error-log-count">
        {t('settings.diagnostics.count', { count: entries?.length ?? 0, version: APP_VERSION })}
      </p>
      {entries && entries.length > 0 ? (
        <>
          <ul className="error-log" data-testid="error-log">
            {entries.slice(0, SHOWN).map((e) => (
              <li key={e.id}>
                <time dateTime={e.at}>{new Date(e.at).toLocaleString(i18n.language)}</time>{' '}
                <code>{e.route || '/'}</code> <span>{e.message}</span>
              </li>
            ))}
          </ul>
          <div className="row">
            <ReportProblemButton small />
            <Button small onClick={reload}>
              {t('settings.diagnostics.refresh')}
            </Button>
            <Button
              small
              variant="danger"
              onClick={async () => {
                await clearErrorLogs();
                reload();
              }}
              data-testid="error-log-clear"
            >
              {t('settings.diagnostics.clear')}
            </Button>
          </div>
        </>
      ) : null}
    </Card>
  );
}
