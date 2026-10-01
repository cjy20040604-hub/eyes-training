import { useTranslation } from 'react-i18next';
import { Banner, Button, Card } from '../ui';

/** Digital eye strain, posture and anaglyph after-effect guidance. Shown before first session. */
export function ErgonomicsCard({
  onAcknowledge,
  compact,
}: {
  onAcknowledge?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card title={t('ergonomics.title')}>
      <ul>
        <li>{t('ergonomics.posture')}</li>
        <li>{t('ergonomics.distance')}</li>
        <li>{t('ergonomics.lighting')}</li>
        <li>{t('ergonomics.glasses')}</li>
        <li>{t('ergonomics.zoom')}</li>
        <li>{t('ergonomics.breaks')}</li>
      </ul>
      {!compact ? (
        <>
          <Banner tone="info" title={t('ergonomics.twentyTitle')}>
            {t('ergonomics.twentyBody')}
          </Banner>
          <Banner tone="warn" title={t('ergonomics.afterEffectsTitle')}>
            {t('ergonomics.afterEffectsBody')}
          </Banner>
        </>
      ) : null}
      {onAcknowledge ? (
        <Button variant="primary" onClick={onAcknowledge} data-testid="ack-ergonomics">
          {t('common.understood')}
        </Button>
      ) : null}
    </Card>
  );
}
