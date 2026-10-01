import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../data/settingsStore';
import { RedFlagScreen } from '../safety/RedFlagScreen';
import { recordSafetyEvent } from '../safety/session';
import { Banner, Card } from '../ui';

export function RedFlagPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettings();
  if (!settings.trainingLock.locked) {
    return (
      <Card title={t('redFlags.screenTitle')}>
        <Banner tone="info">{t('redFlags.notLocked')}</Banner>
      </Card>
    );
  }
  return (
    <RedFlagScreen
      reason={settings.trainingLock.reason}
      onAcknowledge={async (note) => {
        await recordSafetyEvent('red-flag-ack', note);
        settings.setTrainingLock(false);
        navigate('/');
      }}
    />
  );
}
