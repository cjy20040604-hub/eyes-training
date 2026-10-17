import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SYNC_MIN_PASSPHRASE } from '../data/crypto';
import { Banner, Button, Card, Field, Segmented } from '../ui';
import { syncConfigured } from './config';
import {
  WrongSyncPassphraseError,
  forgetKey,
  loadSyncState,
  newSyncKey,
  rememberKey,
  rememberedKey,
  syncNow,
  unlockVault,
  type SyncKey,
  type SyncResult,
  type SyncState,
} from './engine';
import {
  currentSession,
  sendPasswordReset,
  signIn,
  signOut,
  signUp,
  supabase,
  supabaseBackend,
} from './supabase';

type Msg = { tone: 'success' | 'warn' | 'info'; text: string } | null;

/**
 * Account and end-to-end encrypted sync.
 * Two secrets on purpose: the account password (for Supabase sign-in) and a separate sync
 * passphrase (for encryption, never sent anywhere). Using the login password for encryption
 * would hand the server everything it needs to decrypt.
 */
export function AccountPage() {
  const { t } = useTranslation();
  if (!syncConfigured) {
    return (
      <div>
        <h1>{t('account.title')}</h1>
        <Card title={t('account.notConfiguredTitle')}>
          <p data-testid="account-not-configured">{t('account.notConfigured')}</p>
        </Card>
      </div>
    );
  }
  return <ConfiguredAccount />;
}

function ConfiguredAccount() {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    void currentSession().then(setSession);
    const { data } = supabase().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <div data-testid="account">
      <h1>{t('account.title')}</h1>
      <p className="hint">{t('account.intro')}</p>
      {msg ? (
        <Banner tone={msg.tone} role="status">
          {msg.text}
        </Banner>
      ) : null}
      {session === undefined ? (
        <p>{t('common.loading')}</p>
      ) : session ? (
        <SignedIn session={session} setMsg={setMsg} />
      ) : (
        <SignedOut setMsg={setMsg} />
      )}
      <Card title={t('account.privacyTitle')}>
        <ul className="plain-list">
          <li>{t('account.privacy1')}</li>
          <li>{t('account.privacy2')}</li>
          <li>{t('account.privacy3')}</li>
        </ul>
      </Card>
    </div>
  );
}

function SignedOut({ setMsg }: { setMsg: (m: Msg) => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^\S+@\S+\.\S+$/.test(email) && password.length >= 8;

  return (
    <Card title={mode === 'in' ? t('account.signIn') : t('account.signUp')}>
      <Segmented
        value={mode}
        onChange={setMode}
        label={t('account.title')}
        options={[
          { value: 'in', label: t('account.signIn') },
          { value: 'up', label: t('account.signUp') },
        ]}
      />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          setMsg(null);
          try {
            if (mode === 'in') await signIn(email, password);
            else {
              const r = await signUp(email, password);
              if (r === 'confirm-email') setMsg({ tone: 'info', text: t('account.confirmEmail') });
            }
          } catch (err) {
            setMsg({
              tone: 'warn',
              text: t('account.authFailed', { error: err instanceof Error ? err.message : String(err) }),
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t('account.email')} htmlFor="account-email">
          <input
            id="account-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label={t('account.password')} htmlFor="account-password" hint={t('account.passwordHint')}>
          <input
            id="account-password"
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <div className="row">
          <Button type="submit" variant="primary" disabled={!valid || busy} data-testid="account-submit">
            {mode === 'in' ? t('account.signIn') : t('account.signUp')}
          </Button>
          {mode === 'in' ? (
            <Button
              type="button"
              variant="ghost"
              disabled={!/^\S+@\S+\.\S+$/.test(email)}
              onClick={async () => {
                try {
                  await sendPasswordReset(email);
                  setMsg({ tone: 'info', text: t('account.resetSent') });
                } catch (err) {
                  setMsg({ tone: 'warn', text: err instanceof Error ? err.message : String(err) });
                }
              }}
            >
              {t('account.forgot')}
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function SignedIn({ session, setMsg }: { session: Session; setMsg: (m: Msg) => void }) {
  const { t, i18n } = useTranslation();
  const userId = session.user.id;
  const backend = supabaseBackend(userId);
  const [key, setKey] = useState<SyncKey | null | undefined>(undefined);
  const [hasVault, setHasVault] = useState<boolean | null>(null);
  const [state, setState] = useState<SyncState | null>(null);
  const [last, setLast] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [remember, setRemember] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = useCallback(async () => {
    setKey(await rememberedKey(userId));
    setState(await loadSyncState());
    try {
      setHasVault((await backend.getVault()) !== null);
    } catch (e) {
      setMsg({
        tone: 'warn',
        text: t('account.syncFailed', { error: e instanceof Error ? e.message : String(e) }),
      });
    }
    // backend is rebuilt per render; userId identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (k: SyncKey) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await syncNow(backend, k, userId);
      setLast(r);
      setState(await loadSyncState());
      setHasVault(true);
      setMsg({
        tone: 'success',
        text: t(r.created ? 'account.syncCreated' : 'account.syncDone', r.received),
      });
    } catch (e) {
      setMsg({
        tone: 'warn',
        text:
          e instanceof WrongSyncPassphraseError
            ? t('account.wrongSyncPass')
            : t('account.syncFailed', { error: e instanceof Error ? e.message : String(e) }),
      });
    } finally {
      setBusy(false);
    }
  };

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(i18n.language === 'zh-Hans' ? 'zh-CN' : 'en-GB')
      : t('backup.neverShort');

  return (
    <>
      <Card title={t('account.signedInTitle')}>
        <p data-testid="account-email">{t('account.signedInAs', { email: session.user.email ?? '' })}</p>
        <Button
          onClick={async () => {
            await signOut();
            setMsg({ tone: 'info', text: t('account.signedOut') });
          }}
          data-testid="account-signout"
        >
          {t('account.signOut')}
        </Button>
      </Card>

      <Card title={t('account.syncTitle')}>
        {key === undefined || hasVault === null ? (
          <p>{t('common.loading')}</p>
        ) : key ? (
          <div data-testid="sync-ready">
            <dl className="kv">
              <dt>{t('account.lastSync')}</dt>
              <dd data-testid="sync-last">{fmt(state?.lastSyncedAt ?? null)}</dd>
              <dt>{t('account.version')}</dt>
              <dd>{state?.version ?? '—'}</dd>
            </dl>
            {last ? <p className="hint">{t('account.received', last.received)}</p> : null}
            <div className="row">
              <Button variant="primary" disabled={busy} onClick={() => void run(key)} data-testid="sync-now">
                {busy ? t('account.syncing') : t('account.syncNow')}
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  await forgetKey(userId);
                  setKey(null);
                }}
              >
                {t('account.forgetKey')}
              </Button>
            </div>
          </div>
        ) : (
          <form
            data-testid={hasVault ? 'sync-unlock' : 'sync-create'}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMsg(null);
              try {
                const k = hasVault ? await unlockVault(backend, pass) : await newSyncKey(pass);
                if (!k) throw new Error('no vault');
                if (remember) await rememberKey(userId, k);
                setKey(remember ? k : null);
                setPass('');
                setPass2('');
                await run(k);
              } catch (err) {
                setMsg({
                  tone: 'warn',
                  text:
                    err instanceof WrongSyncPassphraseError
                      ? t('account.wrongSyncPass')
                      : t('account.syncFailed', { error: err instanceof Error ? err.message : String(err) }),
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              {hasVault ? t('account.unlockIntro') : t('account.createIntro', { n: SYNC_MIN_PASSPHRASE })}
            </p>
            <Field label={t('account.syncPass')} htmlFor="sync-pass">
              <input
                id="sync-pass"
                type="password"
                autoComplete="off"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
            </Field>
            {!hasVault ? (
              <Field label={t('account.syncPass2')} htmlFor="sync-pass2">
                <input
                  id="sync-pass2"
                  type="password"
                  autoComplete="off"
                  value={pass2}
                  onChange={(e) => setPass2(e.target.value)}
                />
              </Field>
            ) : null}
            <label className="row">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>{t('account.remember')}</span>
            </label>
            <Button
              type="submit"
              variant="primary"
              disabled={
                busy || (hasVault ? pass.length === 0 : pass.length < SYNC_MIN_PASSPHRASE || pass !== pass2)
              }
              data-testid="sync-pass-submit"
            >
              {hasVault ? t('account.unlock') : t('account.createVault')}
            </Button>
          </form>
        )}
      </Card>

      {hasVault ? (
        <Card title={t('account.deleteTitle')}>
          <p className="hint">{t('account.deleteHint')}</p>
          {!confirmDelete ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t('account.deleteCloud')}
            </Button>
          ) : (
            <div className="row">
              <span>{t('account.deleteConfirm')}</span>
              <Button
                variant="danger"
                data-testid="sync-delete-confirm"
                onClick={async () => {
                  await backend.deleteVault();
                  await forgetKey(userId);
                  setConfirmDelete(false);
                  setKey(null);
                  setHasVault(false);
                  setMsg({ tone: 'info', text: t('account.deleted') });
                }}
              >
                {t('common.confirm')}
              </Button>
              <Button onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
            </div>
          )}
        </Card>
      ) : null}
    </>
  );
}
