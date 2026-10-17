# Setting up cloud sync (optional)

Cloud sync lets a user sign in on several devices and keep the same training records. It is
**end-to-end encrypted**: data is compressed and encrypted on the device with a separate
sync passphrase before upload, so the server (and its operator) only ever stores ciphertext.
Without this setup the app works exactly as before: no accounts, no network requests.

## 1. Create a Supabase project (the project owner does this)

1. Sign up at <https://supabase.com> and create a new project (the free tier is enough).
2. **SQL Editor → New query**: paste [`supabase/schema.sql`](../supabase/schema.sql) and run it.
3. **Authentication → URL Configuration**: set _Site URL_ to the app's address
   (`https://cjy20040604-hub.github.io/eyes-training/`) and add it under _Redirect URLs_
   (used by email confirmation and password reset links).
4. **Authentication → Providers → Email**: keep _Confirm email_ on (recommended).
5. **Project Settings → API**: copy the _Project URL_ and the _anon public_ key. The anon key
   is meant to be public; access is limited by the row-level security in `schema.sql`.

## 2. Build with the project settings

- **GitHub Pages (CI):** in the repository, _Settings → Secrets and variables → Actions →
  Variables_, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The deploy build reads
  them; the next push deploys with sync enabled. (From a terminal:
  `gh variable set VITE_SUPABASE_URL --body "https://xxxx.supabase.co"`.)
- **Locally:** create `.env.local` (not committed) with the same two lines, then
  `npm run dev`.

When configured, the page's Content Security Policy allows exactly that Supabase origin.

## How it works

|                 |                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in         | Supabase Auth (email + password, at least 8 characters).                                                                                                                                                                               |
| Encryption      | A **separate** sync passphrase (at least 10 characters) → PBKDF2-SHA-256, 600 000 rounds, random salt → AES-256-GCM. The passphrase never leaves the device; the derived key can be remembered on the device as a non-extractable key. |
| Storage         | One row per user in `vaults`: version, salt, IV, ciphertext, device label.                                                                                                                                                             |
| Sync            | Download → decrypt → merge record by record (`src/sync/merge.ts`) → save → upload with `version + 1`, accepted only if nobody else uploaded meanwhile (otherwise retried).                                                             |
| When            | When the app starts and after each session (if signed in and the key is remembered), or with "Sync now".                                                                                                                               |
| Lost passphrase | The cloud copy cannot be decrypted by anyone. Delete it and set a new passphrase; local data on each device is unaffected.                                                                                                             |
| Delete          | "Delete cloud data" removes the vault row. Deleting the account itself is done in the Supabase dashboard (or by the project owner on request).                                                                                         |

## Testing

- `tests/unit/sync.test.ts`: encryption round trip, merge rules, two devices, conflicts,
  wrong passphrase — with an in-memory backend.
- `tests/e2e/sync.spec.ts`: sign-up, set passphrase, sync, a second "device" (fresh browser
  context) unlocks and receives the data — against a fake Supabase server intercepted by
  Playwright (`.env.e2e` points the e2e build at it).
