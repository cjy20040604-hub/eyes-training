import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Persistent STOP button. Black/white, octagon shape, text label: readable through
 * either anaglyph filter. Bound to Escape while mounted. Large and keyboard-reachable.
 */
export function StopButton({ onStop, disabled }: { onStop: () => void; disabled?: boolean }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !disabled) {
        e.preventDefault();
        onStop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStop, disabled]);
  return (
    <button
      type="button"
      className="stop-button"
      onClick={onStop}
      disabled={disabled}
      data-testid="stop-button"
      aria-keyshortcuts="Escape"
      aria-label={t('safety.stopButton')}
    >
      <span className="stop-word">{t('safety.stopWord')}</span>
      <span className="stop-reason">{t('safety.stopReason')}</span>
    </button>
  );
}
