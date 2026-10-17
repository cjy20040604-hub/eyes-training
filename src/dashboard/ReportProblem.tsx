import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ERROR_LOGGED_EVENT, listErrorLogs, type ErrorLogEntry } from '../data/errorLog';
import { buildErrorReport, issueUrl } from '../data/errorReport';
import { Banner, Button } from '../ui';

/**
 * "Report a problem": shows exactly what would be sent, then the user chooses to open a
 * pre-filled GitHub issue (in a new tab) or copy the text. Nothing is sent automatically.
 */
export function ReportProblemDialog({ entries, onClose }: { entries: ErrorLogEntry[]; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const firstRef = useRef<HTMLTextAreaElement>(null);
  const report = buildErrorReport(entries, {
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    language: i18n.language,
    note,
  });

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-problem-title"
        data-testid="report-problem"
      >
        <h2 id="report-problem-title">{t('problem.title')}</h2>
        <p className="hint">{t('problem.intro')}</p>
        <label htmlFor="problem-note">{t('problem.note')}</label>
        <textarea
          id="problem-note"
          ref={firstRef}
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
        />
        <p className="label">{t('problem.preview')}</p>
        <pre className="report-preview" data-testid="report-preview">
          {report.body}
        </pre>
        <div className="row">
          <a
            className="btn primary"
            href={issueUrl(report)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="report-github"
          >
            {t('problem.github')}
          </a>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${report.title}\n\n${report.body}`);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            data-testid="report-copy"
          >
            {copied ? t('problem.copied') : t('problem.copy')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
        <p className="hint">{t('problem.githubHint')}</p>
      </div>
    </div>
  );
}

/** Opens the dialog with the current error log. */
export function ReportProblemButton({ small }: { small?: boolean }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ErrorLogEntry[] | null>(null);
  return (
    <>
      <Button
        small={small}
        onClick={async () => setEntries(await listErrorLogs().catch(() => []))}
        data-testid="report-problem-open"
      >
        {t('problem.open')}
      </Button>
      {entries ? <ReportProblemDialog entries={entries} onClose={() => setEntries(null)} /> : null}
    </>
  );
}

/** A quiet notice when the app logs an error, offering to report it. */
export function ErrorNotice() {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  useEffect(() => {
    const on = () => setCount((n) => n + 1);
    window.addEventListener(ERROR_LOGGED_EVENT, on);
    return () => window.removeEventListener(ERROR_LOGGED_EVENT, on);
  }, []);
  if (count === 0) return null;
  return (
    <div data-testid="error-notice">
      <Banner tone="warn" title={t('problem.noticeTitle')}>
        {t('problem.noticeBody')}{' '}
        <span className="row">
          <ReportProblemButton small />
          <Button small variant="ghost" onClick={() => setCount(0)}>
            {t('problem.dismiss')}
          </Button>
        </span>
      </Banner>
    </div>
  );
}
