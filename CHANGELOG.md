# Changelog

All notable changes to this project are documented here. Versions follow SemVer; releases are git tags `vX.Y.Z`.

## [0.4.0] — 2026-10-17

### Changed

- **Positioning: personal and educational use only.** Wording across the app, README and docs no longer diagnoses or measures: Worth 4-dot answers are described ("3 dots: only the right eye's dots") instead of labelled ("left eye suppressed"); the weekly check is a "weekly self-check"; "stereo threshold" is "finest depth seen"; the report is a "training summary" that states it is not a clinical measurement. The disclaimer version was bumped, so it is shown again once.
- Dependencies: Vitest 4.1.11 (0 known vulnerabilities in all dependencies). Vitest 4 counts branch coverage more strictly; the branch floors were reset to the new baseline.

### Added

- **One-eye check points in every module**: small diamonds ◇ appear to one eye at a time (L1 keeps its chick); C or the on-screen button reports them. Per session and over time the app shows, per eye, how many were seen and how many presses had no diamond.
- **Report consistency**: a session is "doubtful" when presses come without a diamond, or when its own results needed both eyes but one eye's diamonds were mostly missed. Doubtful sessions never raise the difficulty. Shown in the session summary, History and the report.
- **Quick start** (about 3 minutes): device type and distance (screen size estimated), the glasses check and an optional prism value, then the first session. Quick profiles are marked; L4, L5, the Brock string and the weekly self-check need the full calibration.
- **Account and end-to-end encrypted cloud sync** (optional, Supabase): sign in on several devices; data is gzip-compressed and encrypted on the device (AES-256-GCM, key from a separate sync passphrase, PBKDF2-SHA-256 600 000 rounds) before upload; record-by-record merge and optimistic versioning between devices. Disabled, with no network requests, until a project is configured (`docs/SYNC-SETUP.md`, `supabase/schema.sql`).
- **One-click problem reports**: after an error the app offers a report; the user sees exactly what it contains (version, browser, recent errors — no training data) and chooses to open a pre-filled GitHub issue or copy it. Nothing is sent automatically.
- **Accessibility**: axe-core WCAG 2.1 A/AA scan of every page in CI, a skip link, named progress bars, keyboard checks; a colour-vision note in the glasses step; `docs/ACCESSIBILITY.md`.

## [0.3.0] — 2026-10-16

### Added

- Weekly check (`/check`): the same four-step measurement every week — Worth 4-dot, perceived alignment (twice, from a random off-centre start), contrast balance, and a random-dot stereo threshold (2-down/1-up, no feedback, up to 30 patterns). The first two checks form the baseline. Results are stored separately from sessions, shown on the overview, history and report ("Measured" vs "Training scores from the games"), and exported as CSV.
- Encrypted backups: AES-256-GCM with a PBKDF2-SHA-256 key (600 000 rounds), browser Web Crypto only; encrypted files (`.bvx`) are detected on import and need the passphrase.
- Data safety: persistent-storage request (after a completed session or from Settings), backup reminders on the overview, and optional automatic backup to a chosen folder after each session (File System Access API, Chrome / Edge).
- Weekly goal in training days (Monday to Sunday) with a progress ring; calendar reminders as an `.ics` file (weekly days and time, with an alarm); app-icon badge on days without training (installed app).
- VR headset presentation via WebXR (beta) for L1, L2 and L5: each eye sees its own layer on a world-locked panel with the same angular size and Δ offsets as the calibrated screen; controller trigger = Space, grip = STOP; leaving VR pauses; VR sessions are at most 10 minutes; a one-time comfort notice; flash checking on each eye's picture. Other modules fall back to the glasses with a notice.
- Brock string module (B): three beads from near to far with crossed / uncrossed disparity; report crossings (Space) and a fading string (Arrow Down); horizontal only, near demand 1–8Δ, at most 2Δ divergence; clinician-gated like L4.
- Two-eye reading module (R): alternate words (Chinese: characters) go to each eye; the dominant eye is dimmed; page turning, "words missing" reports; six short original passages in each language.
- Built-in calm scenes for the video module (aquarium, drifting clouds, floating lanterns), drawn live and flash-free by design; now the default source.

### Changed

- Settings schema 2 (migrated automatically): new modules in the daily plan, weekly goal, reminders, backup and VR settings. IndexedDB version 3 adds the weekly checks and the remembered backup folder.
- The report separates "Measured: weekly check" from "Training scores (from the games)".

### Tests

- 54 new unit and component tests (285 in total): encryption, backups and the folder writer, reminders and the calendar file, weekly goals, the weekly check end to end in jsdom, VR geometry and the VR training path, Brock string, reading layout, scenes.
- New end-to-end tests: the weekly check in a real browser, Brock string and reading (per-eye pixels), a built-in scene, encrypted backup export / wipe / restore, backup reminder and calendar file, and the VR fallback without a headset.

## [0.2.1] — 2026-10-16

### Added

- Anti-framing guard (`public/frame-guard.js`): inside another site's frame the app stays hidden, never starts, and offers a link to open it directly. GitHub Pages cannot send a `frame-ancestors` header and browsers ignore it in a `<meta>` CSP, so it was removed from the meta tag.
- Local error log (Settings → Diagnostics): uncaught errors, unhandled rejections and React render errors are kept on the device (message, trimmed stack, route, app version; no training data). It can be cleared, and is added to the backup file only when the user ticks the box.

### Changed

- Pages load on demand (`React.lazy`) and the Chinese strings load only when Chinese is used; vendor code is split into stable chunks. The app's own startup bundle went from 141 KB to 37 KB gzip. All chunks are still precached for offline use.
- The training session lifecycle is now an explicit state machine (`src/safety/sessionMachine.ts`) with unit tests for its safety rules (STOP from every state, an unverifiable flash cannot be dismissed, a pause never hides a break or a flash warning). TrainingShell's views moved to `TrainingViews.tsx`; the calibration stimuli moved to `calibration/stimuli.ts`.
- Fixed in passing: the metrics of a session that ran to time are captured before the stimulus closes.

### Tests

- End-to-end tests run against an e2e-mode build with a test hook that reports object positions, replacing pixel scanning in the three-day test; new rendering checks confirm each eye's image is drawn in its own colour channel at the calibrated offset; new tests for the frame guard, the error log, on-demand language loading and offline use of lazily loaded pages.
- Component tests for every page (overview, report, history, settings, training screen with a stand-in canvas, video setup, charts, app routing); unit tests for session rules, the state machine, the error log, calibration stimuli and translation completeness.
- Unit and component test coverage rose from 36% to 73% of statements, with a CI gate (stricter for safety rules and the stimulus engine).
- CI checks formatting, that the production build has the frame guard and no test hooks, and runs smoke tests against the live site after each deploy.

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
