import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Card } from '../ui';

/**
 * Safety onboarding + disclaimer. Must be acknowledged (all checkboxes) before any
 * training or calibration. Re-shown whenever DISCLAIMER_VERSION changes.
 */
export function DisclaimerScreen({ onAccept }: { onAccept: () => void }) {
  const { t } = useTranslation();
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  const [c, setC] = useState(false);
  const [d, setD] = useState(false);
  const all = a && b && c && d;
  return (
    <Card title={t('disclaimer.title')}>
      <Banner tone="warn" title={t('disclaimer.notTreatment')}>
        {t('disclaimer.statement')}
      </Banner>
      <h3>{t('disclaimer.evidenceTitle')}</h3>
      <p>{t('disclaimer.evidence1')}</p>
      <p>{t('disclaimer.evidence2')}</p>
      <h3>{t('disclaimer.rulesTitle')}</h3>
      <ul>
        <li>{t('disclaimer.rule1')}</li>
        <li>{t('disclaimer.rule2')}</li>
        <li>{t('disclaimer.rule3')}</li>
        <li>{t('disclaimer.rule4')}</li>
        <li>{t('disclaimer.rule5')}</li>
        <li>{t('disclaimer.rule6')}</li>
      </ul>
      <h3>{t('disclaimer.photoTitle')}</h3>
      <p>{t('disclaimer.photoBody')}</p>
      <h3>{t('disclaimer.privacyTitle')}</h3>
      <p>{t('disclaimer.privacyBody')}</p>
      <div className="stack" style={{ marginTop: 16 }}>
        <label className="row">
          <input
            type="checkbox"
            checked={a}
            onChange={(e) => setA(e.target.checked)}
            data-testid="ack-1"
            style={{ width: 22, height: 22 }}
          />
          <span>{t('disclaimer.ack1')}</span>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={b}
            onChange={(e) => setB(e.target.checked)}
            data-testid="ack-2"
            style={{ width: 22, height: 22 }}
          />
          <span>{t('disclaimer.ack2')}</span>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={c}
            onChange={(e) => setC(e.target.checked)}
            data-testid="ack-3"
            style={{ width: 22, height: 22 }}
          />
          <span>{t('disclaimer.ack3')}</span>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={d}
            onChange={(e) => setD(e.target.checked)}
            data-testid="ack-4"
            style={{ width: 22, height: 22 }}
          />
          <span>{t('disclaimer.ack4')}</span>
        </label>
        <Button variant="primary" disabled={!all} onClick={onAccept} data-testid="accept-disclaimer">
          {t('disclaimer.accept')}
        </Button>
      </div>
    </Card>
  );
}
