import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/en.json';
import zh from '../../src/i18n/zh-Hans.json';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

const EN = flatten(en as Tree);
const ZH = flatten(zh as Tree);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('translations', () => {
  it('English and Chinese have exactly the same keys', () => {
    const missingInZh = Object.keys(EN).filter((k) => !(k in ZH));
    const missingInEn = Object.keys(ZH).filter((k) => !(k in EN));
    expect({ missingInZh, missingInEn }).toEqual({ missingInZh: [], missingInEn: [] });
  });

  it('every string uses the same {{placeholders}} in both languages', () => {
    const mismatched = Object.keys(EN).filter(
      (k) => k in ZH && placeholders(EN[k]!).join() !== placeholders(ZH[k]!).join(),
    );
    expect(mismatched).toEqual([]);
  });

  it('no string is empty', () => {
    const empty = [...Object.entries(EN), ...Object.entries(ZH)].filter(([, v]) => !v.trim()).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('every literal t("…") key used in the source exists', () => {
    const used = new Set<string>();
    for (const file of sourceFiles(join(__dirname, '../../src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !(k in EN));
    expect(used.size).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });
});
