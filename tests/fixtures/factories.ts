import type { CalibrationProfile, SessionRecord, Settings, SymptomCheck } from '../../src/data/schema';
import { defaultSettings } from '../../src/data/schema';
import { DEFAULT_CHANNEL_MAP } from '../../src/engine/renderer/types';

let counter = 0;
const id = (p: string) => `${p}_${++counter}`;

export function makeCalibration(over: Partial<CalibrationProfile> = {}): CalibrationProfile {
  return {
    id: id('cal'),
    name: 'Test profile',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    device: { ppi: 96, cardWidthPx: 323.5, dpr: 1, screenWidth: 1920, screenHeight: 1080 },
    viewingDistanceCm: 60,
    channels: DEFAULT_CHANNEL_MAP,
    backgroundGray: 0,
    monocular: { leftVisible: true, rightVisible: true },
    worthFourDot: { result: 'left-suppression', dotsSeen: 3, notes: '' },
    clinicalPrism: {
      amountDelta: 7,
      base: 'in',
      range: 'distance',
      measuredOn: '2026-08-01',
      fusionWithPrism: 'fused',
      notes: '',
    },
    offset: {
      left: { dx: -158.7, dy: 0, rotationDeg: 0 },
      right: { dx: 0, dy: 0, rotationDeg: 0 },
      seededFromClinical: true,
      splitMode: 'left',
    },
    contrastBalance: { dominantEye: 'right', balanceRatio: 0.5, trials: 8 },
    postureNote: '',
    ...over,
  };
}

export function makeCheck(over: Partial<SymptomCheck> = {}): SymptomCheck {
  return {
    id: id('chk'),
    sessionId: null,
    phase: 'post',
    at: '2026-09-01T10:15:00.000Z',
    diplopia: 0,
    headache: 0,
    nausea: 0,
    eyestrain: 0,
    confusion: 0,
    notes: '',
    ...over,
  };
}

export function makeSession(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: id('ses'),
    moduleId: 'l1',
    calibrationId: 'cal_1',
    rendererId: 'anaglyph-canvas2d',
    startedAt: '2026-09-01T10:00:00.000Z',
    endedAt: '2026-09-01T10:04:00.000Z',
    day: '2026-09-01',
    plannedMinutes: 4,
    actualMinutes: 4,
    intensityTier: 'low',
    intensityValue: 0.5,
    intensityMetric: 'dominantContrastRatio',
    gameDifficulty: 1,
    viewingDistanceCm: 60,
    postureNote: '',
    status: 'completed',
    preCheckId: null,
    postCheckId: null,
    events: [{ at: '2026-09-01T10:00:00.000Z', type: 'start' }],
    metrics: {},
    notes: '',
    ...over,
  };
}

/** A completed, clean session with its post check, on `day`. */
export function makeCleanPair(
  day: string,
  moduleId: 'l1' | 'l2' = 'l1',
): { session: SessionRecord; check: SymptomCheck } {
  const check = makeCheck({ at: `${day}T10:10:00.000Z` });
  const session = makeSession({
    moduleId,
    day,
    startedAt: `${day}T10:00:00.000Z`,
    endedAt: `${day}T10:04:00.000Z`,
    postCheckId: check.id,
  });
  check.sessionId = session.id;
  return { session, check };
}

export function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    ...defaultSettings(),
    disclaimerAcceptedVersion: 1,
    disclaimerAcceptedAt: '2026-09-01T09:00:00.000Z',
    activeCalibrationId: 'cal_1',
    ...over,
  };
}
