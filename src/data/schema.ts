import { z } from 'zod';

/** Bump when the persisted shape changes; add a migration in ./migrations. */
export const SCHEMA_VERSION = 2;

export const eyeSchema = z.enum(['left', 'right']);
export const prismBaseSchema = z.enum(['in', 'out', 'up', 'down']);
export const channelNameSchema = z.enum(['red', 'cyan']);
export const intensityTierSchema = z.enum(['low', 'medium', 'high']);
export const moduleIdSchema = z.enum(['l1', 'l2', 'l3', 'l4', 'l5', 'video', 'brock', 'reading']);

export type IntensityTier = z.infer<typeof intensityTierSchema>;
export type ModuleId = z.infer<typeof moduleIdSchema>;

const isoDate = z.string().min(1);
const shortText = z.string().max(2000);

export const eyeTransformSchema = z.object({
  dx: z.number().finite(),
  dy: z.number().finite(),
  rotationDeg: z.number().finite().min(-8).max(8),
});

export const channelSettingsSchema = z.object({
  channel: channelNameSchema,
  gain: z.number().min(0).max(1),
  gamma: z.number().min(0.5).max(2.5),
});

export const eyeChannelMapSchema = z.object({
  left: channelSettingsSchema,
  right: channelSettingsSchema,
});

export const clinicalPrismSchema = z.object({
  amountDelta: z.number().min(0).max(40),
  base: prismBaseSchema,
  range: z.enum(['near', 'distance']),
  measuredOn: isoDate,
  fusionWithPrism: z.enum(['fused', 'double', 'unknown']),
  notes: shortText,
});
export type ClinicalPrism = z.infer<typeof clinicalPrismSchema>;

export const worthFourDotResultSchema = z.enum([
  'fusion',
  'left-suppression',
  'right-suppression',
  'diplopia',
  'alternating',
  'unknown',
]);
export type WorthFourDotResult = z.infer<typeof worthFourDotResultSchema>;

export const calibrationProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(120),
  createdAt: isoDate,
  updatedAt: isoDate,
  device: z.object({
    ppi: z.number().min(50).max(400),
    cardWidthPx: z.number().positive(),
    dpr: z.number().positive(),
    screenWidth: z.number().nonnegative(),
    screenHeight: z.number().nonnegative(),
  }),
  viewingDistanceCm: z.number().min(30).max(120),
  channels: eyeChannelMapSchema,
  backgroundGray: z.number().min(0).max(80),
  monocular: z.object({ leftVisible: z.boolean(), rightVisible: z.boolean() }),
  worthFourDot: z.object({
    result: worthFourDotResultSchema,
    dotsSeen: z.number().int().min(0).max(6),
    notes: shortText,
  }),
  clinicalPrism: clinicalPrismSchema.nullable(),
  offset: z.object({
    left: eyeTransformSchema,
    right: eyeTransformSchema,
    seededFromClinical: z.boolean(),
    /** 'left' = whole offset on the left layer; 'split' = half on each. */
    splitMode: z.enum(['left', 'split']),
  }),
  contrastBalance: z.object({
    dominantEye: eyeSchema,
    /** Dominant-eye contrast (0..1) at which the two eyes were perceived as equal. */
    balanceRatio: z.number().min(0.05).max(1),
    trials: z.number().int().nonnegative(),
  }),
  postureNote: shortText,
});
export type CalibrationProfile = z.infer<typeof calibrationProfileSchema>;

/** PEDIG / ATS-style frequency scale. */
export const frequencySchema = z.number().int().min(0).max(4);
export const FREQUENCY_LABELS = ['never', 'rarely', 'sometimes', 'often', 'always'] as const;
/** 0 none, 1 mild, 2 moderate, 3 severe. */
export const severitySchema = z.number().int().min(0).max(3);
export const SEVERITY_LABELS = ['none', 'mild', 'moderate', 'severe'] as const;

export const symptomCheckSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().nullable(),
  phase: z.enum(['pre', 'post', 'stop']),
  at: isoDate,
  diplopia: frequencySchema,
  headache: severitySchema,
  nausea: severitySchema,
  eyestrain: severitySchema,
  confusion: severitySchema,
  notes: shortText,
});
export type SymptomCheck = z.infer<typeof symptomCheckSchema>;

export const sessionEventTypeSchema = z.enum([
  'start',
  'stop',
  'pause',
  'resume',
  'flash-warn',
  'flash-pause',
  'break-start',
  'break-end',
  'cap-hit',
  'probe',
  'step-back',
  'step-up',
  'complete',
  'recovered',
]);

export const sessionEventSchema = z.object({
  at: isoDate,
  type: sessionEventTypeSchema,
  data: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type SessionEvent = z.infer<typeof sessionEventSchema>;

export const sessionRecordSchema = z.object({
  id: z.string().min(1),
  moduleId: moduleIdSchema,
  calibrationId: z.string().nullable(),
  rendererId: z.string(),
  startedAt: isoDate,
  endedAt: isoDate.nullable(),
  /** Calendar day key YYYY-MM-DD in local time, for daily caps. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  plannedMinutes: z.number().nonnegative(),
  actualMinutes: z.number().nonnegative(),
  intensityTier: intensityTierSchema,
  intensityValue: z.number(),
  intensityMetric: z.string(),
  gameDifficulty: z.number().int().min(1).max(5),
  viewingDistanceCm: z.number(),
  postureNote: shortText,
  status: z.enum(['in-progress', 'completed', 'stopped', 'aborted', 'recovered']),
  preCheckId: z.string().nullable(),
  postCheckId: z.string().nullable(),
  events: z.array(sessionEventSchema),
  metrics: z.record(z.number()),
  notes: shortText,
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

export const safetyEventSchema = z.object({
  id: z.string().min(1),
  at: isoDate,
  type: z.enum([
    'stop',
    'red-flag',
    'red-flag-ack',
    'flash-pause',
    'cap-hit',
    'diplopia-lock',
    'diplopia-unlock',
  ]),
  sessionId: z.string().nullable(),
  details: shortText,
});
export type SafetyEvent = z.infer<typeof safetyEventSchema>;

export const dailyPlanEntrySchema = z.object({
  minutes: z.number().min(0).max(20),
  intensityTier: intensityTierSchema,
  enabled: z.boolean(),
});

export const moduleProgressSchema = z.object({
  /** Current concrete intensity value on the module's metric. */
  intensityValue: z.number(),
  intensityTier: intensityTierSchema,
  gameDifficulty: z.number().int().min(1).max(5),
  lastVisualChangeAt: isoDate.nullable(),
  lastGameChangeAt: isoDate.nullable(),
});
export type ModuleProgress = z.infer<typeof moduleProgressSchema>;

export const capsSchema = z.object({
  sessionMaxMinutes: z.number().min(2).max(20),
  sessionDefaultMinutes: z.number().min(2).max(20),
  dailyCapMinutes: z.number().min(5).max(40),
  microBreakEveryMinutes: z.number().min(2).max(10),
  microBreakSeconds: z.number().min(10).max(120),
  twentyTwentyTwenty: z.boolean(),
});
export type Caps = z.infer<typeof capsSchema>;

export const lockSchema = z.object({
  locked: z.boolean(),
  reason: z.string().max(500),
  since: isoDate.nullable(),
});

/**
 * Weekly check: a fixed measurement with no feedback and no score, kept apart from
 * training results so progress is not confused with getting better at the games.
 * Horizontal alignment residuals are signed: positive = the left-eye image had to move right.
 */
export const assessmentSchema = z.object({
  id: z.string().min(1),
  at: isoDate,
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  calibrationId: z.string().nullable(),
  viewingDistanceCm: z.number(),
  status: z.enum(['completed', 'stopped']),
  worth: z
    .object({
      dotsSeen: z.number().int().min(0).max(6),
      alternating: z.boolean(),
      result: worthFourDotResultSchema,
    })
    .nullable(),
  alignment: z
    .object({
      horizontalDelta: z.array(z.number().finite()),
      verticalDelta: z.array(z.number().finite()),
      meanDelta: z.number().finite(),
      spreadDelta: z.number().finite(),
    })
    .nullable(),
  balance: z
    .object({ ratio: z.number().min(0.05).max(1), trials: z.number().int().nonnegative() })
    .nullable(),
  stereo: z
    .object({
      thresholdArcsec: z.number().positive().nullable(),
      trials: z.number().int().nonnegative(),
      correct: z.number().int().nonnegative(),
      cantTell: z.number().int().nonnegative(),
      minArcsec: z.number().positive(),
    })
    .nullable(),
  preCheckId: z.string().nullable(),
  postCheckId: z.string().nullable(),
  notes: shortText,
});
export type Assessment = z.infer<typeof assessmentSchema>;

export const reminderSchema = z.object({
  /** Days of the week, 0 = Sunday … 6 = Saturday. */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  /** Local time HH:MM. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export const backupSettingsSchema = z.object({
  lastBackupAt: isoDate.nullable(),
  lastAutoBackupAt: isoDate.nullable(),
  /** Write a backup file to a folder the user chose after each session (Chrome / Edge). */
  autoBackup: z.boolean(),
  /** Remind about backups after this many days. */
  remindAfterDays: z.number().int().min(1).max(60),
});

export const settingsSchema = z.object({
  schemaVersion: z.number().int(),
  locale: z.enum(['en', 'zh-Hans']),
  rendererId: z.enum(['anaglyph-canvas2d', 'anaglyph-webgl', 'sbs', 'webxr']),
  activeCalibrationId: z.string().nullable(),
  disclaimerAcceptedVersion: z.number().int().nullable(),
  disclaimerAcceptedAt: isoDate.nullable(),
  ergonomicsAcknowledgedAt: isoDate.nullable(),
  clinicianAgreement: z.boolean(),
  clinicianNotes: shortText,
  trainingLock: lockSchema,
  progressionLock: lockSchema,
  caps: capsSchema,
  dailyPlan: z.record(moduleIdSchema, dailyPlanEntrySchema),
  moduleProgress: z.record(moduleIdSchema, moduleProgressSchema),
  cyclotorsionEnabled: z.boolean(),
  reducedMotion: z.boolean(),
  /** Days per week the user aims to train. */
  weeklyGoalDays: z.number().int().min(1).max(7),
  reminder: reminderSchema,
  backup: backupSettingsSchema,
  /** When the VR comfort notice was acknowledged (needed once before VR sessions). */
  vrComfortAcknowledgedAt: isoDate.nullable(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const exportBundleSchema = z.object({
  app: z.literal('eyes-training'),
  schemaVersion: z.number().int().positive(),
  exportedAt: isoDate,
  settings: z.unknown(),
  calibrations: z.array(z.unknown()),
  sessions: z.array(z.unknown()),
  symptomChecks: z.array(z.unknown()),
  safetyEvents: z.array(z.unknown()),
  /** Weekly checks (added in schema 2). */
  assessments: z.array(z.unknown()).optional(),
  /** Only present when the user chose to include the local error log. Never imported. */
  errorLogs: z.array(z.unknown()).optional(),
});
export type ExportBundle = z.infer<typeof exportBundleSchema>;

/** The disclaimer text version. Bump to force re-acknowledgement when copy changes. */
export const DISCLAIMER_VERSION = 1;

export const DEFAULT_CAPS: Caps = {
  sessionMaxMinutes: 20,
  sessionDefaultMinutes: 12,
  dailyCapMinutes: 30,
  microBreakEveryMinutes: 5,
  microBreakSeconds: 45,
  twentyTwentyTwenty: true,
};

export function defaultSettings(): Settings {
  return {
    schemaVersion: SCHEMA_VERSION,
    locale: 'en',
    rendererId: 'anaglyph-canvas2d',
    activeCalibrationId: null,
    disclaimerAcceptedVersion: null,
    disclaimerAcceptedAt: null,
    ergonomicsAcknowledgedAt: null,
    clinicianAgreement: false,
    clinicianNotes: '',
    trainingLock: { locked: false, reason: '', since: null },
    progressionLock: { locked: false, reason: '', since: null },
    caps: { ...DEFAULT_CAPS },
    dailyPlan: {
      l1: { minutes: 4, intensityTier: 'low', enabled: true },
      l2: { minutes: 5, intensityTier: 'low', enabled: true },
      l3: { minutes: 4, intensityTier: 'low', enabled: false },
      l4: { minutes: 3, intensityTier: 'low', enabled: false },
      l5: { minutes: 3, intensityTier: 'low', enabled: false },
      video: { minutes: 0, intensityTier: 'low', enabled: false },
      brock: { minutes: 3, intensityTier: 'low', enabled: false },
      reading: { minutes: 5, intensityTier: 'low', enabled: false },
    },
    moduleProgress: {},
    cyclotorsionEnabled: false,
    reducedMotion: false,
    weeklyGoalDays: 4,
    reminder: { weekdays: [1, 3, 5, 6], time: '19:00' },
    backup: { lastBackupAt: null, lastAutoBackupAt: null, autoBackup: false, remindAfterDays: 7 },
    vrComfortAcknowledgedAt: null,
  };
}
