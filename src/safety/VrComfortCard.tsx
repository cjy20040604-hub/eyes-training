import { useTranslation } from 'react-i18next';
import { Banner, Button, Card } from '../ui';

/**
 * Shown once before the first VR session. Cybersickness is the main extra risk of a
 * headset; the rules here are kept in code (shorter sessions, world-locked panel, no
 * artificial motion, grip = STOP), and the user is told what to do.
 */
export function VrComfortCard({ onAcknowledge }: { onAcknowledge: () => void }) {
  const { t } = useTranslation();
  return (
    <Card title={t('vr.comfortTitle')}>
      <Banner tone="warn" title={t('vr.comfortWarnTitle')}>
        {t('vr.comfortWarn')}
      </Banner>
      <ul className="plain-list" data-testid="vr-comfort">
        <li>{t('vr.comfort1')}</li>
        <li>{t('vr.comfort2')}</li>
        <li>{t('vr.comfort3')}</li>
        <li>{t('vr.comfort4')}</li>
        <li>{t('vr.comfort5')}</li>
      </ul>
      <Button variant="primary" onClick={onAcknowledge} data-testid="ack-vr-comfort">
        {t('vr.comfortAck')}
      </Button>
    </Card>
  );
}
