# Changelog

All notable changes to this project are documented here. Versions follow SemVer; releases are git tags `vX.Y.Z`.

## [0.1.0] — 2026-09-29 (MVP, Phase 1)

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
