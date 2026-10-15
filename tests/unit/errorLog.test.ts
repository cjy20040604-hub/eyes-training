import { beforeEach, describe, expect, it } from 'vitest';
import { resetDbForTests } from '../../src/data/db';
import {
  MAX_ERROR_LOGS,
  clearErrorLogs,
  describeError,
  installGlobalErrorHandlers,
  listErrorLogs,
  logError,
  resetErrorLogLimiter,
  shouldLog,
} from '../../src/data/errorLog';
import { buildExportBundle } from '../../src/data/exportImport';
import { exportBundleSchema } from '../../src/data/schema';

beforeEach(() => {
  resetDbForTests();
  resetErrorLogLimiter();
  window.location.hash = '#/train/l2?secret=1';
});

describe('local error log', () => {
  it('stores message, trimmed stack, route (path only) and app version', async () => {
    const e = new Error('ball does not move');
    const entry = await logError('error', e);
    expect(entry).not.toBeNull();
    const [stored] = await listErrorLogs();
    expect(stored).toMatchObject({
      kind: 'error',
      message: 'Error: ball does not move',
      route: '/train/l2',
      appVersion: expect.any(String),
    });
    expect(stored!.stack.length).toBeGreaterThan(0);
  });

  it('removes query strings from URLs and control characters from messages', async () => {
    await logError('unhandledrejection', 'failed https://example.org/v.mp4?token=abc#t=3 \u0007done');
    const [stored] = await listErrorLogs();
    expect(stored!.message).toBe('failed https://example.org/v.mp4 done');
  });

  it('describes non-Error reasons', () => {
    expect(describeError('plain').message).toBe('plain');
    expect(describeError({ code: 7 }).message).toBe('{"code":7}');
    expect(describeError(new TypeError('x')).message).toBe('TypeError: x');
  });

  it('counts a repeating error once per 5 s and at most 20 errors per minute', () => {
    expect(shouldLog('same', 0)).toBe(true);
    expect(shouldLog('same', 1000)).toBe(false);
    expect(shouldLog('same', 6000)).toBe(true);
    resetErrorLogLimiter();
    let stored = 0;
    for (let i = 0; i < 50; i++) if (shouldLog(`m${i}`, 100 + i)) stored++;
    expect(stored).toBe(20);
    expect(shouldLog('later', 61_000)).toBe(true);
  });

  it(`keeps only the newest ${MAX_ERROR_LOGS} entries`, async () => {
    for (let i = 0; i < MAX_ERROR_LOGS + 5; i++) {
      resetErrorLogLimiter();
      await logError('error', `error ${i}`);
    }
    const all = await listErrorLogs();
    expect(all).toHaveLength(MAX_ERROR_LOGS);
    expect(all.some((e) => e.message === 'error 0')).toBe(false);
  });

  it('is exported only when asked, and the bundle stays valid', async () => {
    await logError('react', new Error('render failed'));
    const without = await buildExportBundle();
    expect(without.errorLogs).toBeUndefined();
    const withLog = await buildExportBundle({ includeErrorLog: true });
    expect(withLog.errorLogs).toHaveLength(1);
    expect(exportBundleSchema.safeParse(JSON.parse(JSON.stringify(withLog))).success).toBe(true);
    await clearErrorLogs();
    expect(await listErrorLogs()).toHaveLength(0);
  });

  it('records uncaught errors and unhandled rejections from window events', async () => {
    const uninstall = installGlobalErrorHandlers(window);
    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('from window'), message: 'from window' }),
    );
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: new Error('from promise') });
    window.dispatchEvent(rejection);
    uninstall();
    // After uninstalling, nothing is logged. (A stand-in listener marks the event as handled,
    // otherwise the test runner itself would report it as an uncaught error.)
    const handled = (e: Event) => e.preventDefault();
    window.addEventListener('error', handled);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('after uninstall'), cancelable: true }));
    window.removeEventListener('error', handled);
    await expect.poll(async () => (await listErrorLogs()).length).toBe(2);
    const messages = (await listErrorLogs()).map((e) => e.message).sort();
    expect(messages).toEqual(['Error: from promise', 'Error: from window']);
  });
});
