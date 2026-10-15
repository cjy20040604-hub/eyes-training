# Changelog

All notable changes to this project are documented here. Versions follow SemVer; releases are git tags `vX.Y.Z`.

## [0.2.0] — 2026-10-15 (Phase 2)

### Added

- L3 "Don't Lose the Left": anti-suppression catch game. Stars only the left eye sees, a basket only the right eye sees, clouds (right eye) to avoid from level 2.
- L4 "Stretch": fusional vergence ramp with break / recovery recording, alternating base-out and base-in, different targets per eye (square / cross) with nonius ticks, horizontal only, 12Δ / 6Δ ceilings, clinician-gated.
- L5 "Pop-Out": Julesz random-dot stereograms with no monocular cue, 4-direction answers, "cannot tell" option, 2-down/1-up log staircase down to one device pixel.
- Dichoptic video: local video files (or CORS-enabled https links) in grey per eye, reduced strong-eye contrast, slowly drifting complementary masks, 85% brightness cap, flash checking, pause with breaks; YouTube / Bilibili only as plain viewing in a new tab.
- Clinician report: setup and starting point, adherence, key measures (first vs latest), symptoms and safety events, trend charts, print / save as PDF, CSV downloads (sessions with measurements, symptom checks, safety events).
- Progress charts on the History page (minutes, L1 contrast, L2 perceived offset, L3 catch rate, L4 break / recovery, L5 threshold, double vision), each with a data-table view; colours validated for colour-vision deficiency in light and dark mode.
- Overview: "Ready to add" section for unlocked stages with one-click add; locked stages show what unlocks them.
- Honest dose: input-driven modules pause after 60 s without input; a module setup step (used by the video module).

### Changed

- Module placeholders replaced by real modules; session events record vergence breaks and recoveries.

## [0.1.2] — 2026-10-09

### Changed

- Visual redesign of the app chrome (training stimulus unchanged): slate ink on cool "record paper", one cobalt accent, red and cyan reserved for the stimulus; automatic dark mode.
- Self-hosted Atkinson Hyperlegible Next (designed for low-vision readers; OFL-1.1), with the system Chinese font as fallback.
- Overview rebuilt around today: date, minutes summary, one "Start next module" button, and a prism-bar meter of trained / planned / spare minutes up to the daily limit. Modules are ledger rows instead of identical cards; later stages are compact rows with unlock progress; the week is a minute bar chart.
- First run: the main button is "Set up calibration" until a profile exists.
- STOP button shows "STOP" large with the reason underneath; module titles use a code badge instead of "L1 · …".
- Destructive buttons are outlined; wizard step tabs and section rules tidied.

### Fixed

- Pages, including the overview after accepting the disclaimer, now open at the top instead of keeping the previous scroll position.
- Start links were rendered underlined.

## [0.1.1] — 2026-10-09

### Fixed

- A single click or tap now moves the ball (L2) or bird (L1). Before, releasing the mouse cancelled the move, so a click did nothing.
- Arrow keys / WASD now move at a steady speed while held and stop on release (Shift for fine moves), instead of drifting in small jumps.
- L2 accepts a ball that is visibly inside the ring (tolerance ~30 px instead of ~18 px) and shows a filling progress arc plus a HUD bar while holding.
- L2: pressing Space when the ball looks inside the ring counts within two ring radii and records the perceived offset (px and Δ); repeated far presses suggest recalibrating.
- Canvas 2D renderer kept full brightness for every shape; gray levels are now preserved (the shared frame is half brightness, the calibration "A"/"B" letters are visible).
- Animation no longer stays frozen after the window is hidden; the session pauses with a Resume button, and the timer only counts while the stimulus is drawn.
- Day-to-day progression now works: after a completed, comfortable session, game difficulty rises one step per day (then visual difficulty within the planned tier); a poor session eases it. Starting a session no longer counts as a difficulty change.
- A 100% contrast balance no longer labels the intensity "High".
- Session completion runs once; micro-break countdown no longer double-counts; STOP keeps the session's metrics; strong pre-session symptoms show their own message.
- Moving between training pages starts a fresh session screen and closes the abandoned session as aborted.
- Calibration offset step: arrow keys nudge the left-eye image (Shift for 1 px).

### Added

- On-screen control hints for each module, false-alarm count for L1 chicks, and L3–L5 unlock progress on the overview.
- Tests: module movement and scoring, progression rules, frame-loop resume, and a three-day end-to-end run that plays L1 and L2 through the real UI.

## [0.1.0] — 2026-09-29 (Phase 1)

### Added

- Safety layer: versioned disclaimer onboarding, persistent black/white STOP button bound to Esc, PEDIG/ATS symptom checks before/after/on-stop, red-flag lock-out screen, session and global daily caps, micro-breaks, consecutive-diplopia progression lock, transition-rate guard and rendered-frame flash detector (WCAG 2.3.1 / ITU-R BT.1702).
- Calibration wizard: credit-card PPI, viewing distance, channel mapping + ghosting gains, monocular checks, digital Worth 4-dot with diplopia caution branch, clinical prism (Δ) entry with exact Δ→px conversion, perceptual offset fine-tune, optional cyclotorsion (default off), contrast-balance staircase, dated exportable profiles.
- Engine: EyeLayer, StereoRenderer interface with Anaglyph (Canvas 2D + WebGL backends), side-by-side renderer and WebXR stub; per-eye affine transform; adaptive staircase; frame loop.
- Modules L1 "Both Eyes On" and L2 "Line Them Up" with separate visual/game difficulty and Low/Medium/High intensity mapping.
- Dashboard: overview (planned vs actual minutes and intensity per module per day, daily cap, 7-day strip), module drill-down with plan editor, history with CSV export and print-to-PDF, settings (caps, clinician toggle + notes, profiles, JSON backup/import, reset).
- Data: versioned zod schema, Dexie IndexedDB store, settings migrations, crash-safe in-progress session recovery, input sanitisation.
- PWA (vite-plugin-pwa, prompt updates), strict CSP, i18n (en, zh-Hans), Vitest unit/component tests, Playwright e2e, GitHub Actions CI + Pages deploy.

### Planned

- Phase 2: L3 anti-suppression, L4 fusional vergence (clinician gated, near-zero vertical demand), L5 RDS stereopsis, dichoptic local-video module with DRM/CORS rejection, clinician report, weekly trends.
- Phase 3: encrypted export, WebXR side-by-side path with cybersickness warnings.
