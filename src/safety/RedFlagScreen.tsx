import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Card } from '../ui';
import { RED_FLAG_KEYS, type RedFlagReport } from './symptomRules';

export function RedFlagQuestions({
  value,
  onChange,
}: {
  value: RedFlagReport;
  onChange: (v: RedFlagReport) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="stack" style={{ border: '2px solid var(--border)', borderRadius: 10, padding: 12 }}>
      <legend>
        <strong>{t('redFlags.legend')}</strong>
      </legend>
      <p className="hint">{t('redFlags.hint')}</p>
      {RED_FLAG_KEYS.map((k) => (
        <label key={k} className="row" style={{ alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={value[k]}
            onChange={(e) => onChange({ ...value, [k]: e.target.checked })}
            data-testid={`redflag-${k}`}
            style={{ width: 22, height: 22, marginTop: 4 }}
          />
          <span>{t(`redFlags.items.${k}`)}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Shown when any red flag is reported. Training stays disabled until the user
 * explicitly acknowledges the advice. The app never advises continuing.
 */
export function RedFlagScreen({
  reason,
  onAcknowledge,
}: {
  reason: string;
  onAcknowledge: (note: string) => void;
}) {
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  return (
    <Card>
      <Banner tone="danger" title={t('redFlags.screenTitle')}>
        <p>{t('redFlags.screenBody')}</p>
        {reason ? <p className="hint">{reason}</p> : null}
      </Banner>
      <ul>
        <li>{t('redFlags.advice1')}</li>
        <li>{t('redFlags.advice2')}</li>
        <li>{t('redFlags.advice3')}</li>
      </ul>
      <p>{t('redFlags.ackIntro')}</p>
      <label className="row">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          style={{ width: 22, height: 22 }}
          data-testid="redflag-ack-checkbox"
        />
        <span>{t('redFlags.ackCheckbox')}</span>
      </label>
      <div className="field">
        <label htmlFor="redflag-note">{t('redFlags.ackNote')}</label>
        <textarea id="redflag-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
      <Button
        variant="secondary"
        disabled={!confirmed}
        onClick={() => onAcknowledge(note)}
        data-testid="redflag-ack-button"
      >
        {t('redFlags.ackButton')}
      </Button>
    </Card>
  );
}
