# Privacy notice

- **All data stays on your device.** Settings live in `localStorage`; calibration
  profiles, sessions, symptom checks and safety events live in IndexedDB, both scoped to
  the browser origin you use.
- **No network.** The app makes no requests after loading its own static files, has no
  accounts, no analytics, no crash reporting and no third-party scripts. A strict Content
  Security Policy (`index.html`, `public/_headers`) blocks anything else, and an end-to-end
  test asserts that no non-local request happens.
- **Local error log.** If the app hits an error, it notes the error message, a shortened
  technical trace, the in-app page (path only) and the app version in IndexedDB, at most
  200 entries. No training results, symptom answers or text you typed. It is never sent
  anywhere; you can view and clear it in Settings → Diagnostics, and it goes into a backup
  file only if you tick "Include the error log".
- **Optional remote video URLs** (Phase 2) are the single exception: if _you_ paste a video
  URL, your browser fetches that video directly. Nothing about you is sent besides the
  normal HTTP request for the file.
- **Export / import.** You can export everything as JSON or CSV and delete everything from
  Settings. Plain exports are unencrypted: treat them as sensitive health data. The
  encrypted backup protects the file with your passphrase (AES-256-GCM, PBKDF2-SHA-256 with
  600 000 rounds, in the browser). Nobody, including us, can recover a lost passphrase.
- **Automatic backup folder (optional).** In Chrome / Edge you can choose a folder on your
  device; after each session the app writes a backup file there. It is your folder: if it is
  synced (for example by a cloud drive), that sync is between you and that service.
- **Persistent storage.** The app asks the browser to keep its data (so it is not cleared to
  free space). This is a browser setting; nothing is sent anywhere.
- **Reminders.** The calendar reminder is a file you download and import into your own
  calendar; the app does not send notifications.
- **VR.** In a headset the app uses WebXR on the device only; no camera images or tracking
  data are stored or sent.
- **Service worker.** Used only to cache the app shell for offline use.
- Clearing site data in the browser deletes everything. Keep a backup if you need one.
