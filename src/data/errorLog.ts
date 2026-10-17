import { getDb, type AppDatabase } from './db';
import { sanitizeText } from './sanitize';
import { newId, nowIso } from './util';

/**
 * Local error log. Uncaught errors, unhandled promise rejections and React render errors
 * are kept in IndexedDB on this device only (no network, by design), so a problem such as
 * "the ball does not move" can be diagnosed later from an export the user chooses to share.
 * Entries hold the message, a trimmed stack, the in-app route and the app version: no
 * training data, no symptom answers, no free text the user typed.
 */
export interface ErrorLogEntry {
  id: string;
  at: string;
  kind: 'error' | 'unhandledrejection' | 'react';
  message: string;
  stack: string;
  /** Hash route at the time, e.g. "/train/l2". */
  route: string;
  appVersion: string;
}

export const MAX_ERROR_LOGS = 200;
/** Dispatched on window after an error was stored (the app offers to report it). */
export const ERROR_LOGGED_EVENT = 'bv-error-logged';
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
/** The same message within this window is counted once (avoids a per-frame error flood). */
const DEDUPE_MS = 5000;
/** At most this many entries per minute, whatever the message. */
const MAX_PER_MINUTE = 20;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

const recent = new Map<string, number>();
let minuteStart = 0;
let minuteCount = 0;

/** For tests: forget the de-duplication and rate-limit state. */
export function resetErrorLogLimiter(): void {
  recent.clear();
  minuteStart = 0;
  minuteCount = 0;
}

function currentRoute(): string {
  if (typeof window === 'undefined') return '';
  const hash = window.location.hash.replace(/^#/, '');
  // Only the path: never query strings.
  return hash.split('?')[0] ?? '';
}

/** Strip query strings and fragments from any URL in the text (blob:/https: etc.). */
function stripUrlParams(text: string): string {
  return text.replace(/((?:https?|blob):[^\s?#)]+)[?#][^\s)]*/g, '$1');
}

export function describeError(reason: unknown): { message: string; stack: string } {
  if (reason instanceof Error)
    return { message: `${reason.name}: ${reason.message}`, stack: reason.stack ?? '' };
  if (typeof reason === 'string') return { message: reason, stack: '' };
  try {
    return { message: JSON.stringify(reason) ?? String(reason), stack: '' };
  } catch {
    return { message: String(reason), stack: '' };
  }
}

/** Whether an error should be stored now (de-duplication and rate limit). */
export function shouldLog(message: string, nowMs: number): boolean {
  const last = recent.get(message);
  if (last !== undefined && nowMs - last < DEDUPE_MS) return false;
  if (nowMs - minuteStart >= 60_000) {
    minuteStart = nowMs;
    minuteCount = 0;
  }
  if (minuteCount >= MAX_PER_MINUTE) return false;
  minuteCount++;
  recent.set(message, nowMs);
  return true;
}

export async function logError(
  kind: ErrorLogEntry['kind'],
  reason: unknown,
  extraStack = '',
  db: AppDatabase = getDb(),
): Promise<ErrorLogEntry | null> {
  try {
    const { message, stack } = describeError(reason);
    const cleanMessage = stripUrlParams(sanitizeText(message)).slice(0, MAX_MESSAGE);
    if (!shouldLog(cleanMessage, Date.now())) return null;
    const entry: ErrorLogEntry = {
      id: newId('err'),
      at: nowIso(),
      kind,
      message: cleanMessage,
      stack: stripUrlParams([stack, extraStack].filter(Boolean).join('\n')).slice(0, MAX_STACK),
      route: currentRoute(),
      appVersion: APP_VERSION,
    };
    await db.errorLogs.put(entry);
    if (typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent(ERROR_LOGGED_EVENT, { detail: entry }));
    const count = await db.errorLogs.count();
    if (count > MAX_ERROR_LOGS) {
      const oldest = await db.errorLogs
        .orderBy('at')
        .limit(count - MAX_ERROR_LOGS)
        .primaryKeys();
      await db.errorLogs.bulkDelete(oldest);
    }
    return entry;
  } catch {
    // Logging must never cause another error.
    return null;
  }
}

export async function listErrorLogs(db: AppDatabase = getDb()): Promise<ErrorLogEntry[]> {
  return db.errorLogs.orderBy('at').reverse().toArray();
}

export async function clearErrorLogs(db: AppDatabase = getDb()): Promise<void> {
  await db.errorLogs.clear();
}

/** Record uncaught errors and unhandled rejections. Returns an uninstall function. */
export function installGlobalErrorHandlers(target: Window = window): () => void {
  const onError = (e: ErrorEvent) => {
    void logError('error', e.error ?? e.message);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    void logError('unhandledrejection', e.reason);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
