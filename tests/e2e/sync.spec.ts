import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { acceptDisclaimer, bundle, importBundle, unlockedHistory } from './helpers';

/**
 * Cloud sync end to end, against a fake Supabase server (Playwright intercepts the e2e
 * build's project URL from .env.e2e). Two browser contexts play two devices: the first
 * signs up and uploads; the second signs in, unlocks with the sync passphrase and receives
 * everything. The fake server checks it only ever sees ciphertext.
 */

test.setTimeout(3 * 60_000);

const ORIGIN = 'https://fake-project.supabase.test';

interface FakeServer {
  users: Map<string, { id: string; password: string }>;
  vault: Record<string, unknown> | null;
  requests: string[];
}

function makeServer(): FakeServer {
  return { users: new Map(), vault: null, requests: [] };
}

function sessionFor(email: string, id: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: `token-${id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: `refresh-${id}`,
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

async function handle(server: FakeServer, route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  server.requests.push(`${req.method()} ${url.pathname}`);
  const json = (status: number, body: unknown) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  if (req.method() === 'OPTIONS') {
    return route.fulfill({
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      },
    });
  }
  if (url.pathname === '/auth/v1/signup') {
    const { email, password } = req.postDataJSON() as { email: string; password: string };
    const id = `user-${server.users.size + 1}`;
    server.users.set(email, { id, password });
    return json(200, sessionFor(email, id));
  }
  if (url.pathname === '/auth/v1/token') {
    const { email, password } = req.postDataJSON() as { email: string; password: string };
    const u = server.users.get(email);
    if (!u || u.password !== password)
      return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    return json(200, sessionFor(email, u.id));
  }
  if (url.pathname === '/auth/v1/user') {
    const id = (req.headers()['authorization'] ?? '').replace('Bearer token-', '');
    const email = [...server.users.entries()].find(([, u]) => u.id === id)?.[0] ?? '';
    return json(200, sessionFor(email, id).user);
  }
  if (url.pathname === '/auth/v1/logout')
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  if (url.pathname === '/rest/v1/vaults') {
    const method = req.method();
    if (method === 'GET') return json(200, server.vault ? [server.vault] : []);
    if (method === 'POST') {
      if (server.vault) return json(409, { code: '23505', message: 'duplicate key' });
      server.vault = req.postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' } });
    }
    if (method === 'PATCH') {
      const expected = Number((url.searchParams.get('version') ?? '').replace('eq.', ''));
      if (!server.vault || Number(server.vault['version']) !== expected) return json(200, []);
      server.vault = { ...server.vault, ...(req.postDataJSON() as Record<string, unknown>) };
      return json(200, [{ version: server.vault['version'] }]);
    }
    if (method === 'DELETE') {
      server.vault = null;
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
  }
  return json(404, { message: `not faked: ${req.method()} ${url.pathname}` });
}

async function device(context: BrowserContext, server: FakeServer): Promise<Page> {
  await context.route(`${ORIGIN}/**`, (route) => handle(server, route));
  return context.newPage();
}

test('two devices: sign up and upload on one, unlock and receive on the other', async ({ browser }) => {
  const server = makeServer();
  const passphrase = 'blue-heron-river-42';

  // ---- Device A: has training history; signs up and turns on encrypted sync. ----
  const a = await device(await browser.newContext(), server);
  await acceptDisclaimer(a);
  await importBundle(a, bundle({ ...unlockedHistory(), balanceRatio: 0.6 }));
  await a.getByRole('link', { name: 'Account' }).click();
  await a.getByRole('button', { name: 'Create account' }).click();
  await a.getByLabel('Email').fill('me@example.org');
  await a.getByLabel('Account password').fill('account-pass-1');
  await a.getByTestId('account-submit').click();
  await expect(a.getByTestId('account-email')).toContainText('me@example.org');
  await expect(a.getByTestId('sync-create')).toBeVisible();
  await a.getByLabel('Sync passphrase', { exact: true }).fill(passphrase);
  await a.getByLabel('Repeat the sync passphrase').fill(passphrase);
  await a.getByTestId('sync-pass-submit').click();
  await expect(a.getByText('Your data is encrypted and stored in the cloud.')).toBeVisible({
    timeout: 30_000,
  });
  // The server holds ciphertext only.
  const stored = JSON.stringify(server.vault);
  expect(stored).not.toContain('cal_e2e');
  expect(stored).not.toContain('completed');
  expect(server.vault?.['version']).toBe(1);

  // ---- Device B: empty; signs in, unlocks with the passphrase, receives everything. ----
  const b = await device(await browser.newContext(), server);
  await acceptDisclaimer(b);
  await b.goto('/#/account');
  await b.getByLabel('Email').fill('me@example.org');
  await b.getByLabel('Account password').fill('account-pass-1');
  await b.getByTestId('account-submit').click();
  await expect(b.getByTestId('sync-unlock')).toBeVisible();
  await b.getByLabel('Sync passphrase', { exact: true }).fill('not the passphrase');
  await b.getByTestId('sync-pass-submit').click();
  await expect(b.getByText('That sync passphrase does not open the encrypted data.')).toBeVisible({
    timeout: 30_000,
  });
  await b.getByLabel('Sync passphrase', { exact: true }).fill(passphrase);
  await b.getByTestId('sync-pass-submit').click();
  await expect(b.getByText(/Synced\. New from other devices: 6 session/)).toBeVisible({ timeout: 30_000 });
  expect(server.vault?.['version']).toBe(2);
  await b.goto('/#/history');
  await expect(b.locator('tbody tr', { hasText: 'Completed' })).toHaveCount(6);

  // ---- Device A trains again; its next sync merges without losing B's upload. ----
  await a.goto('/#/account');
  await a.getByTestId('sync-now').click();
  await expect(a.getByText(/Synced\./)).toBeVisible({ timeout: 30_000 });
  expect(server.vault?.['version']).toBe(3);

  // Signing out keeps this device's data.
  await b.goto('/#/account');
  await b.getByTestId('account-signout').click();
  await b.goto('/#/history');
  await expect(b.locator('tbody tr', { hasText: 'Completed' })).toHaveCount(6);
});

test('without signing in, the app never contacts the sync server', async ({ page }) => {
  const server = makeServer();
  await page.context().route(`${ORIGIN}/**`, (route) => handle(server, route));
  await acceptDisclaimer(page);
  for (const hash of ['#/', '#/history', '#/report', '#/settings', '#/account']) {
    await page.goto(`/${hash}`);
    await expect(page.locator('main h1').first()).toBeVisible();
  }
  expect(server.requests).toEqual([]);
});
