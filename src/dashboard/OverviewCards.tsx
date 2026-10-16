import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { checkDue, daysSinceLastCheck, daysUntilNextCheck } from '../assessment/checkLogic';
import { backupDue, backupFileName, daysSinceBackup } from '../data/backup';
import { downloadText, exportJson } from '../data/exportImport';
import { weeklyProgress } from '../data/goals';
import type { Assessment, SessionRecord } from '../data/schema';
import { useSettings } from '../data/settingsStore';
import { Banner, Button } from '../ui';

/** Ring showing training days this week against the weekly goal. Days count, not minutes. */
export function WeeklyGoal({ sessions }: { sessions: SessionRecord[] }) {
  const { t } = useTranslation();
  const goal = useSettings((s) => s.weeklyGoalDays);
  const p = weeklyProgress(sessions, goal);
  const r = 34;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, p.done / Math.max(1, p.goal));
  return (
    <section className="goal-card" aria-labelledby="goal-title" data-testid="weekly-goal">
      <h2 className="section-title" id="goal-title">
        {t('goal.title')}
      </h2>
      <div className="goal-body">
        <svg
          width="84"
          height="84"
          viewBox="0 0 84 84"
          role="img"
          aria-label={t('goal.ring', { done: p.done, goal: p.goal })}
        >
          <circle cx="42" cy="42" r={r} className="goal-track" />
          <circle
            cx="42"
            cy="42"
            r={r}
            className="goal-fill"
            strokeDasharray={`${c * frac} ${c}`}
            transform="rotate(-90 42 42)"
          />
          <text x="42" y="47" textAnchor="middle" className="goal-text">
            {p.done}/{p.goal}
          </text>
        </svg>
        <div>
          <p data-testid="weekly-goal-text">
            {p.reached
              ? t('goal.reached')
              : p.outOfReach
                ? t('goal.outOfReach')
                : t('goal.progress', { done: p.done, goal: p.goal, left: p.daysLeft })}
          </p>
          <Link className="hint" to="/settings#reminders">
            {t('goal.adjust')}
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The weekly check: due now, or when the next one is. */
export function WeeklyCheckCard({ assessments, enabled }: { assessments: Assessment[]; enabled: boolean }) {
  const { t } = useTranslation();
  const due = checkDue(assessments);
  const since = daysSinceLastCheck(assessments);
  return (
    <section className="goal-card" aria-labelledby="check-card-title" data-testid="weekly-check-card">
      <h2 className="section-title" id="check-card-title">
        {t('check.title')}
      </h2>
      <p>
        {since === null
          ? t('check.never')
          : due
            ? t('check.dueSince', { days: since })
            : t('check.next', { days: daysUntilNextCheck(assessments) })}
      </p>
      <p className="hint">{t('check.why')}</p>
      {enabled ? (
        <Link className={`btn ${due ? 'primary' : ''}`} to="/check" data-testid="start-weekly-check">
          {due ? t('check.startDue') : t('check.startAnyway')}
        </Link>
      ) : null}
    </section>
  );
}

/** Reminder to back up: the data lives only in this browser. */
export function BackupReminder({ sessions }: { sessions: SessionRecord[] }) {
  const { t } = useTranslation();
  const backup = useSettings((s) => s.backup);
  const markBackup = useSettings((s) => s.markBackup);
  if (!backupDue(backup, sessions)) return null;
  const days = daysSinceBackup(backup);
  return (
    <div data-testid="backup-reminder">
      <Banner tone="info" title={days === null ? t('backup.neverTitle') : t('backup.oldTitle', { days })}>
        <p>{t('backup.body')}</p>
        <div className="row">
          <Button
            small
            variant="primary"
            data-testid="backup-now"
            onClick={async () => {
              downloadText(backupFileName(), await exportJson());
              markBackup('manual');
            }}
          >
            {t('backup.now')}
          </Button>
          <Link className="btn small" to="/settings#backup">
            {t('backup.encrypted')}
          </Link>
        </div>
      </Banner>
    </div>
  );
}
