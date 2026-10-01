# Browser notes

- **HTTPS required** for the service worker and PWA install (localhost is exempt).
- **Browser zoom must be 100%.** The PPI calibration measures CSS pixels; a zoomed page
  changes `devicePixelRatio` and invalidates the card match. The wizard warns when
  `visualViewport.scale` is not 1.
- **Chromium / Firefox / Safari / mobile:** the Canvas 2D anaglyph path works everywhere
  Canvas 2D `globalCompositeOperation = 'lighter'` is supported (all modern browsers). The
  WebGL backend falls back to Canvas 2D if WebGL is unavailable.
- **Safari and CORS video (Phase 2):** Safari/iOS has historically had bugs drawing
  cross-origin `<video>` elements to canvas even with `crossOrigin="anonymous"` and correct
  headers. Prefer local files there. DRM/EME streams can never be drawn to canvas or WebGL;
  the app rejects them with a clear message. YouTube/Bilibili links may only be opened for
  plain viewing in a new tab; the app never downloads or pixel-processes them (YouTube's
  Terms of Service forbid downloading content except as expressly authorized).
- **Gamepad:** polled via `navigator.getGamepads()`; left stick moves, button 0 acts.
- **Reduced motion:** `prefers-reduced-motion` is picked up on first launch and can be
  toggled in Settings; modules slow their drift and reduce relocation frequency.
- **Storage:** IndexedDB + localStorage. Private/incognito windows may discard data on close.
