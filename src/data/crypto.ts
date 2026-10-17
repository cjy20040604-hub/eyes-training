/**
 * Encrypted backups with the browser's own Web Crypto API (no third-party code).
 *
 *  - Key: PBKDF2-SHA-256 from the passphrase, with a random 16-byte salt and 600 000
 *    iterations (OWASP 2023 guidance for PBKDF2-SHA-256).
 *  - Cipher: AES-GCM 256 with a random 12-byte IV; GCM's tag also detects a wrong
 *    passphrase or a modified file.
 *  - File: a small JSON envelope with the parameters and the base64 ciphertext.
 *
 * There is no recovery: without the passphrase the data cannot be read by anyone.
 */

export const ENCRYPTED_FORMAT = 'eyes-training-encrypted';
export const DEFAULT_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 8;

export interface EncryptedEnvelope {
  format: typeof ENCRYPTED_FORMAT;
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  data: string;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('The passphrase is wrong, or the file was changed.');
    this.name = 'WrongPassphraseError';
  }
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Encryption needs a secure (https) page in a current browser.');
  return s;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey(
    'raw',
    new TextEncoder().encode(passphrase.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptText(
  plain: string,
  passphrase: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error('Passphrase too short.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const cipher = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );
  const envelope: EncryptedEnvelope = {
    format: ENCRYPTED_FORMAT,
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(new Uint8Array(cipher)),
  };
  return JSON.stringify(envelope, null, 2);
}

export function parseEnvelope(text: string): EncryptedEnvelope | null {
  try {
    const v = JSON.parse(text) as Partial<EncryptedEnvelope>;
    if (
      v?.format === ENCRYPTED_FORMAT &&
      v.version === 1 &&
      v.kdf?.name === 'PBKDF2' &&
      typeof v.kdf.salt === 'string' &&
      Number.isInteger(v.kdf.iterations) &&
      (v.kdf.iterations ?? 0) >= 1000 &&
      v.cipher?.name === 'AES-GCM' &&
      typeof v.cipher.iv === 'string' &&
      typeof v.data === 'string'
    )
      return v as EncryptedEnvelope;
  } catch {
    // not JSON
  }
  return null;
}

export function isEncryptedBackup(text: string): boolean {
  return parseEnvelope(text) !== null;
}

export async function decryptText(text: string, passphrase: string): Promise<string> {
  const env = parseEnvelope(text);
  if (!env) throw new Error('Not an encrypted backup file.');
  const key = await deriveKey(passphrase, fromBase64(env.kdf.salt), env.kdf.iterations);
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(env.cipher.iv) as BufferSource },
      key,
      fromBase64(env.data) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new WrongPassphraseError();
  }
}

// ---- Sync: a key derived once per device, reused for every upload ----

export const SYNC_MIN_PASSPHRASE = 10;

export function randomSaltBase64(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

/** The AES key for cloud sync. Not extractable: it can be kept on the device, never read back. */
export async function deriveSyncKey(
  passphrase: string,
  saltBase64: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<CryptoKey> {
  return deriveKey(passphrase, fromBase64(saltBase64), iterations);
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** gzip, then AES-GCM with a fresh IV. */
export async function sealWithKey(key: CryptoKey, plain: string): Promise<{ iv: string; data: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    (await gzip(plain)) as BufferSource,
  );
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(cipher)) };
}

export async function openWithKey(key: CryptoKey, sealed: { iv: string; data: string }): Promise<string> {
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(sealed.iv) as BufferSource },
      key,
      fromBase64(sealed.data) as BufferSource,
    );
  } catch {
    throw new WrongPassphraseError();
  }
  return gunzip(new Uint8Array(plain));
}
