import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FREQUENCY_LABELS, SEVERITY_LABELS, type SymptomCheck } from '../data/schema';
import { sanitizeText } from '../data/sanitize';
import { newId, nowIso } from '../data/util';
import { Button, Field, Segmented } from '../ui';
import { RedFlagQuestions } from './RedFlagScreen';
import { emptyRedFlagReport, hasRedFlag, type RedFlagReport } from './symptomRules';

export interface SymptomCheckSubmit {
  check: SymptomCheck;
  redFlags: RedFlagReport;
}

/** PEDIG / ATS-style symptom check used before, after, and on STOP. */
export function SymptomCheckForm({
  phase,
  sessionId,
  onSubmit,
  onCancel,
}: {
  phase: SymptomCheck['phase'];
  sessionId: string | null;
  onSubmit: (result: SymptomCheckSubmit) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [diplopia, setDiplopia] = useState(0);
  const [headache, setHeadache] = useState(0);
  const [nausea, setNausea] = useState(0);
  const [eyestrain, setEyestrain] = useState(0);
  const [confusion, setConfusion] = useState(0);
  const [notes, setNotes] = useState('');
  const [redFlags, setRedFlags] = useState<RedFlagReport>(emptyRedFlagReport());

  const freqOptions = FREQUENCY_LABELS.map((k, i) => ({ value: i, label: t(`symptoms.frequency.${k}`) }));
  const sevOptions = SEVERITY_LABELS.map((k, i) => ({ value: i, label: t(`symptoms.severity.${k}`) }));

  const submit = () => {
    onSubmit({
      check: {
        id: newId('chk'),
        sessionId,
        phase,
        at: nowIso(),
        diplopia,
        headache,
        nausea,
        eyestrain,
        confusion,
        notes: sanitizeText(notes),
      },
      redFlags,
    });
  };

  return (
    <form
      className="stack"
      data-testid={`symptom-check-${phase}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p>{t(`symptoms.intro.${phase}`)}</p>
      <Field label={t('symptoms.diplopia')} hint={t('symptoms.diplopiaHint')}>
        <Segmented
          value={diplopia}
          options={freqOptions}
          onChange={setDiplopia}
          label={t('symptoms.diplopia')}
        />
      </Field>
      <Field label={t('symptoms.headache')}>
        <Segmented
          value={headache}
          options={sevOptions}
          onChange={setHeadache}
          label={t('symptoms.headache')}
        />
      </Field>
      <Field label={t('symptoms.nausea')}>
        <Segmented value={nausea} options={sevOptions} onChange={setNausea} label={t('symptoms.nausea')} />
      </Field>
      <Field label={t('symptoms.eyestrain')}>
        <Segmented
          value={eyestrain}
          options={sevOptions}
          onChange={setEyestrain}
          label={t('symptoms.eyestrain')}
        />
      </Field>
      <Field label={t('symptoms.confusion')} hint={t('symptoms.confusionHint')}>
        <Segmented
          value={confusion}
          options={sevOptions}
          onChange={setConfusion}
          label={t('symptoms.confusion')}
        />
      </Field>
      <RedFlagQuestions value={redFlags} onChange={setRedFlags} />
      <Field label={t('symptoms.notes')} htmlFor={`notes-${phase}`}>
        <textarea
          id={`notes-${phase}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
        />
      </Field>
      <div className="row">
        <Button
          variant={hasRedFlag(redFlags) ? 'danger' : 'primary'}
          type="submit"
          data-testid="symptom-submit"
        >
          {hasRedFlag(redFlags) ? t('symptoms.submitRedFlag') : t('symptoms.submit')}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
