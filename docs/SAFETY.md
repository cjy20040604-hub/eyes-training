# Safety design

This app is a personal wellness / self-experiment tool for one adult with paralytic
(incomitant) strabismus, used under the supervision of an orthoptist / ophthalmologist.
It is **not** a medical device and makes **no** treatment or diagnosis claims.

## Evidence context encoded in the app copy

- Kushner 2002, _Arch Ophthalmol_ 120(11):1498–504: 3/424 adults (0.8%) developed persistent
  intractable diplopia after strabismus surgery; patients who did not see double during
  pre-operative prism testing never developed diplopia afterwards.
- Khan 2008, _J AAPOS_ 12(1):46–8: prism testing "greatly overestimated" the risk.
- Conclusion shown to the user: a reassuring 7Δ prism test says the eyes _can_ be optically
  aligned; it does not guarantee that breaking long-standing suppression will be comfortable.

## Hard rules implemented in code

| Rule                                                                                                                                                                                                                                                          | Where                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Disclaimer must be acknowledged (4 checkboxes), re-shown when `DISCLAIMER_VERSION` changes                                                                                                                                                                    | `src/safety/DisclaimerScreen.tsx`, `src/App.tsx`                                     |
| STOP button on every training screen, black/white octagon + text, `Esc`                                                                                                                                                                                       | `src/safety/StopButton.tsx`, `src/styles.css`                                        |
| STOP halts stimuli, records `stop` session + safety events, opens symptom check                                                                                                                                                                               | `src/safety/TrainingShell.tsx`                                                       |
| Red flag (deviation increase, new diplopia, ptosis, unequal pupils, severe headache, neuro) → training lock, "seek urgent medical attention", never advise continuing                                                                                         | `src/safety/RedFlagScreen.tsx`, `symptomRules.ts`                                    |
| Pre/post symptom check (never/rarely/sometimes/often/always + headache, nausea, eyestrain, confusion)                                                                                                                                                         | `src/safety/SymptomCheckForm.tsx`                                                    |
| Diplopia ("sometimes" or worse) in 2 consecutive post checks → progression lock + orthoptist advice                                                                                                                                                           | `symptomRules.ts`, `session.ts`                                                      |
| Any discomfort → immediate visual step back; never advance visual and game difficulty together                                                                                                                                                                | `src/modules/adaptive.ts`                                                            |
| Per-session max 20 min, default 12; global daily cap 30 min across all modules (hard stop); micro-break every 5 min                                                                                                                                           | `src/safety/caps.ts`                                                                 |
| L3–L5 unlock after 6 clean L1/L2 sessions on ≥3 days with no STOP in the last 3; L4 and any offset reduction need the clinician toggle                                                                                                                        | `src/safety/gating.ts`                                                               |
| Head posture: habitual, never forced; posture + distance recorded each session                                                                                                                                                                                | `ErgonomicsCard.tsx`, `TrainingShell.tsx`                                            |
| Cyclotorsion compensation optional, default off, 0.5° steps, ±8° ceiling, applied only when enabled in Settings                                                                                                                                               | `src/engine/affine.ts`, `Wizard.tsx`                                                 |
| Photosensitivity: transition guard (≥334 ms apart, ≤3/s) + rendered-frame flash detector (WCAG 2.3.1 general and red flash, area-aware) auto-pauses at ≥3 flashes/s, warns at 2                                                                               | `src/engine/transitionGuard.ts`, `src/engine/flashDetector.ts`, `TrainingCanvas.tsx` |
| Anaglyph after-effects and 20-20-20 shown as comfort guidance, explicitly not therapy                                                                                                                                                                         | `ErgonomicsCard.tsx`                                                                 |
| All data local; no network; strict CSP                                                                                                                                                                                                                        | `index.html`, `public/_headers`, e2e test                                            |
| L4 vergence: horizontal only (vertical demand always 0); hard ceilings 12Δ base-out and 6Δ base-in, far below normal adult amplitudes (AAO near convergence break ~20–25Δ, divergence ~12Δ); a break immediately reverses the ramp; clinician toggle required | `src/engine/vergence.ts`, `src/modules/l4`, `gating.ts`                              |
| L5 random-dot stereo: new patterns only through the transition guard; feedback is a thin outline, never a flash; "cannot tell" is always a valid answer                                                                                                       | `src/modules/l5`, `src/engine/rds.ts`                                                |
| Dichoptic video: local files only by default; brightness capped at 85%; frames that cannot be read (cross-origin video) stop playback with no resume; video pauses with every break, overlay and STOP; headache warning shown before every session            | `src/modules/video`, `TrainingCanvas.tsx`, `TrainingShell.tsx`                       |
| YouTube / Bilibili are never processed or downloaded; only offered as plain viewing in a new tab, labelled "not training"                                                                                                                                     | `src/modules/video/VideoSetup.tsx`                                                   |
| Honest dose: the session timer counts only while frames are drawn; input-driven modules pause after 60 s without input                                                                                                                                        | `TrainingShell.tsx`, `TrainingCanvas.tsx`                                            |
| A STOP in the last 3 sessions re-locks L3–L5 and video until sessions are comfortable again                                                                                                                                                                   | `gating.ts`, overview                                                                |

## Photosensitivity guard details

1. **Prevention.** Modules must call `TransitionGuard.request()` before any luminance-changing
   state change. Requests closer than 334 ms to the previous one, or more than 3 within any
   1 s window, are refused. Because a flash is a _pair_ of opposing transitions, this keeps
   our own content at ≤1.5 flashes/s, half the WCAG limit.
2. **Detection.** Each frame the composited canvas is downsampled to a 64×36 grid. Per cell,
   relative luminance (WCAG formula on linearised sRGB) is tracked as excursions; an opposing
   change ≥0.10 with the darker state <0.80 is a transition. Saturated-red state changes are
   tracked separately. A cell's flashes/s = transitions in the last second / 2. The reported
   rate is the highest value reached by enough cells to cover the area threshold, which is
   25% of a 10° visual field computed from the calibrated PPI and viewing distance (WCAG's
   341×256 px reference when unknown). Level `warn` at ≥2/s, `danger` (auto-pause + event)
   at ≥3/s. Any frequency from 3 to 60 Hz produces more transitions and is caught by the
   same counter.
3. **Validation.** Unit tests replay synthetic 60 fps sequences (1, 2, 4, 10 Hz, 334 ms spacing,
   sub-threshold area, red). Any bundled animation or video should additionally be checked
   with the Trace Center **PEAT** tool before shipping.

## Regulatory posture

Wellness / personal-experiment language only; no treatment or diagnosis claims anywhere;
persistent footer disclaimer; `docs/TERMS.md` and `docs/PRIVACY.md` for public deployment;
"not for children without clinician supervision". Treating a condition could make software
an SaMD under FDA / EU MDR / NMPA rules; this project deliberately stays in the wellness lane.
