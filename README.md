# Binocular Vision Explorer

A browser-based, fully offline, personal wellness / self-experiment tool for exploring
simultaneous perception and fusion with red-cyan anaglyph glasses, built for one adult
with paralytic (incomitant) strabismus under clinical supervision.

**This is not medical treatment and not a medical device.** It does not diagnose,
treat, cure or prevent any condition. Read [docs/SAFETY.md](docs/SAFETY.md) first.

## What it does (MVP, Phase 1)

- Safety layer: enforced onboarding disclaimer, always-visible black/white STOP button
  (Esc), pre/post symptom checks (PEDIG/ATS diplopia scale), red-flag lock-out, per-session
  and global daily caps, micro-breaks, consecutive-diplopia progression lock, photosensitivity
  guard (transition rate limiter + rendered-frame flash detector).
- Calibration wizard: credit-card PPI, viewing distance, glasses channel mapping + ghosting,
  monocular checks, digital Worth 4-dot, clinical prism (Δ) entry with exact Δ→px conversion
  seeding the virtual-prism offset, perceptual fine-tune, optional cyclotorsion (off by
  default), contrast-balance staircase.
- Engine: per-eye layers, swappable renderers (anaglyph Canvas 2D / WebGL, side-by-side,
  WebXR stub), per-eye affine transform, staircase, transition guard, flash detector.
- Modules L1 "Both Eyes On" and L2 "Line Them Up", each separating visual difficulty
  (intensity metric) from game difficulty.
- Dashboard: planned vs actual minutes and intensity per module per day, daily cap, 7-day
  view, history, CSV export and print-to-PDF, JSON backup/import, English + 简体中文.
- PWA: installable, works offline, prompt-based service worker updates.

Phase 2 (L3–L5, dichoptic video, clinician report) and Phase 3 (encrypted export, WebXR)
are listed in [CHANGELOG.md](CHANGELOG.md).

## Run

```bash
npm install
npm run dev
```

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

End-to-end tests (build first, Playwright starts the preview server):

```bash
npx playwright install chromium
npm run test:e2e
```

## Deploy

Static hosting only. Set `VITE_BASE=/<repo>/` for GitHub Pages sub-paths (see
`.github/workflows/ci.yml`). Netlify / Cloudflare Pages pick up `public/_headers` for the
CSP; GitHub Pages relies on the `<meta http-equiv>` CSP in `index.html`. HTTPS is required
for the service worker.

## Privacy

Everything stays on the device: `localStorage` for settings, IndexedDB for sessions and
calibrations. There are no network calls, analytics or trackers, enforced by a strict CSP
and asserted in the e2e tests. See [docs/PRIVACY.md](docs/PRIVACY.md).

## How this was built

This project was built in collaboration with the AI coding assistant Claude Code: the author
wrote the specification, supplied the clinical parameters and safety rules, and approved the
plan; the AI designed, implemented, tested and verified it.

## License

MIT. Mechanics were inspired by other projects; see [docs/INSPIRED-BY.md](docs/INSPIRED-BY.md).
No code was copied from GPL or unlicensed projects.
