import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Card, Progress } from '../ui';
import { EVAL_CASES, softChecks, type SoftCheck } from './evalCases';
import type { Draft } from './guardrails';
import {
  createTranslator,
  createWriter,
  modelAvailability,
  type Availability,
  type TextTranslator,
} from './onDevice';
import { runInsight, type InsightResult } from './pipeline';
import { PROMPT_VERSION } from './prompt';
import { templateDraft } from './template';

interface Row {
  id: string;
  about: string;
  outcome: 'pass-first' | 'pass-retry' | 'fallback';
  result: InsightResult;
  soft: SoftCheck[];
  baseline: Draft;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] ?? 0) : 0;
};
const p90 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)] ?? 0) : 0;
};
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');

function summarizeRows(rows: Row[]) {
  const soft = rows.flatMap((r) => r.soft);
  const ms = rows.map((r) => r.result.ms);
  return {
    cases: rows.length,
    passFirst: rows.filter((r) => r.outcome === 'pass-first').length,
    passAny: rows.filter((r) => r.outcome !== 'fallback').length,
    fallback: rows.filter((r) => r.outcome === 'fallback').length,
    failedCalls: rows.reduce((a, r) => a + r.result.errors.length, 0),
    timeouts: rows.reduce(
      (a, r) => a + r.result.errors.filter((e) => e.startsWith('TimeoutError')).length,
      0,
    ),
    softPassed: soft.filter((s) => s.passed).length,
    distinctHeadlines: new Set(rows.map((r) => r.result.draft.headline.toLowerCase())).size,
    softTotal: soft.length,
    medianMs: median(ms),
    p90Ms: p90(ms),
    problems: rows
      .flatMap((r) => r.result.problems.flat())
      .reduce<Record<string, number>>((acc, p) => ({ ...acc, [p]: (acc[p] ?? 0) + 1 }), {}),
  };
}

/**
 * Evaluation bench for the AI weekly recap (#/lab/insights). Runs the fixed case set through
 * this browser's on-device model with the production pipeline and guardrails, and reports
 * pass rates, retries, fallbacks, content checks and latency. Nothing leaves the device.
 */
export function InsightLab() {
  const { t, i18n } = useTranslation();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [zh, setZh] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState<{ done: number; download: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void modelAvailability().then(setAvailability);
  }, []);

  async function run() {
    setRows([]);
    setError(null);
    setRunning({ done: 0, download: null });
    const en = i18n.getFixedT('en');
    const zhT = i18n.getFixedT('zh-Hans');
    if (zh) await i18n.loadLanguages('zh-Hans');
    const onProgress = (p: number) => setRunning((r) => ({ done: r?.done ?? 0, download: p }));
    let translator: TextTranslator | null = null;
    try {
      // The first session triggers the one-time download (needs this click).
      const first = await createWriter(onProgress);
      first.destroy();
      if (zh) translator = await createTranslator(onProgress);
      const out: Row[] = [];
      for (const c of EVAL_CASES) {
        const writer = await createWriter(); // fresh context per case
        try {
          const result = await runInsight(
            c.facts,
            { kind: 'ok' },
            {
              lang: zh ? 'zh' : 'en',
              template: (f) => templateDraft(f, zh ? zhT : en),
              englishTemplate: (f) => templateDraft(f, en),
              writer,
              translator,
            },
          );
          const englishOut = result.source === 'model' ? (result.englishDraft ?? result.draft) : null;
          out.push({
            id: c.id,
            about: c.about,
            outcome:
              result.source === 'template' ? 'fallback' : result.attempts === 1 ? 'pass-first' : 'pass-retry',
            result,
            soft: englishOut ? softChecks(c.facts, englishOut) : [],
            baseline: templateDraft(c.facts, en),
          });
        } finally {
          writer.destroy();
        }
        setRows([...out]);
        setRunning({ done: out.length, download: null });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      translator?.destroy();
      setRunning(null);
    }
  }

  const s = summarizeRows(rows);
  const results = JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      promptVersion: PROMPT_VERSION,
      translate: zh,
      summary: s,
      rows: rows.map((r) => ({
        id: r.id,
        outcome: r.outcome,
        reason: r.result.reason,
        errors: r.result.errors,
        attempts: r.result.attempts,
        ms: r.result.ms,
        problems: r.result.problems,
        softFailed: r.soft.filter((x) => !x.passed).map((x) => x.id),
        draft: r.result.draft,
        englishDraft: r.result.englishDraft,
      })),
    },
    null,
    2,
  );

  return (
    <>
      <div className="no-print" data-testid="lab-notice">
        <Banner tone="info">
          {t('insights.labNotice')} <Link to="/">{t('insights.labBack')}</Link>
        </Banner>
      </div>
      {/* English-only developer page inside a possibly Chinese UI: not for page translation,
          which would rewrite the live results under React. */}
      <div className="insight-lab" data-testid="insight-lab" lang="en" translate="no">
        <h1>Weekly recap: evaluation</h1>
        <p className="hint">
          Runs {EVAL_CASES.length} fixed weeks through this browser&apos;s on-device model, using the same
          prompt, guardrails and fallback as the app. Developer page; English only.
        </p>
        <Card>
          <p>
            Model: <strong data-testid="lab-availability">{availability ?? 'checking…'}</strong>
          </p>
          <label className="row">
            <input type="checkbox" checked={zh} onChange={(e) => setZh(e.target.checked)} /> Also translate to
            Chinese (on-device Translator) and check the translation
          </label>
          <div className="row">
            <Button
              variant="primary"
              onClick={() => void run()}
              disabled={!!running || availability === 'unsupported' || availability === 'unavailable'}
              data-testid="lab-run"
            >
              Run {EVAL_CASES.length} cases
            </Button>
            {rows.length && !running ? (
              <Button onClick={() => void navigator.clipboard?.writeText(results)} data-testid="lab-copy">
                Copy results (JSON)
              </Button>
            ) : null}
          </div>
          {running ? (
            <div data-testid="lab-running">
              {running.download !== null && running.download < 1 ? (
                <>
                  <p className="hint">Downloading the model: {Math.round(running.download * 100)}%</p>
                  <Progress value={running.download} label="Model download" />
                </>
              ) : (
                <p className="hint">
                  Case {Math.min(running.done + 1, EVAL_CASES.length)} of {EVAL_CASES.length}…
                </p>
              )}
            </div>
          ) : null}
          {error ? <Banner tone="danger">{error}</Banner> : null}
        </Card>

        {rows.length ? (
          <Card title="Summary">
            <dl className="kv" data-testid="lab-summary">
              <dt>Cases</dt>
              <dd>{s.cases}</dd>
              <dt>Passed the guardrails first time</dt>
              <dd data-testid="lab-pass-first">
                {s.passFirst} ({pct(s.passFirst, s.cases)})
              </dd>
              <dt>Passed after one corrective retry</dt>
              <dd data-testid="lab-pass-any">
                {s.passAny} ({pct(s.passAny, s.cases)})
              </dd>
              <dt>Fell back to the rule-based recap</dt>
              <dd data-testid="lab-fallback">
                {s.fallback} ({pct(s.fallback, s.cases)})
              </dd>
              <dt>Failed model calls (of which timeouts)</dt>
              <dd data-testid="lab-errors">
                {s.failedCalls} ({s.timeouts})
              </dd>
              <dt>Prompt version</dt>
              <dd data-testid="lab-version">{PROMPT_VERSION}</dd>
              <dt>Distinct headlines</dt>
              <dd data-testid="lab-distinct">
                {s.distinctHeadlines} / {s.cases}
              </dd>
              <dt>Content checks passed</dt>
              <dd data-testid="lab-soft">
                {s.softPassed} / {s.softTotal} ({pct(s.softPassed, s.softTotal)})
              </dd>
              <dt>Latency per case</dt>
              <dd data-testid="lab-latency">
                median {(s.medianMs / 1000).toFixed(1)} s, p90 {(s.p90Ms / 1000).toFixed(1)} s
              </dd>
              <dt>Rejections and errors by kind</dt>
              <dd data-testid="lab-problems">
                {Object.entries(s.problems)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => `${k} ×${v}`)
                  .join(', ') || 'none'}
              </dd>
            </dl>
          </Card>
        ) : null}

        {rows.map((r) => (
          <Card key={r.id} title={`${r.id}: ${r.outcome}`}>
            <div data-testid={`lab-row-${r.id}`}>
              <p className="hint">
                {r.about} · {(r.result.ms / 1000).toFixed(1)} s · attempts {r.result.attempts}
                {r.result.reason ? ` · ${r.result.reason}` : ''}
              </p>
              {r.result.errors.length ? (
                <p>
                  Errors: <code>{r.result.errors.join(' | ')}</code>
                </p>
              ) : null}
              {r.result.problems.length ? (
                <p>
                  Rejected: <code>{r.result.problems.map((p) => p.join(', ')).join(' | ')}</code>
                </p>
              ) : null}
              {r.soft.some((x) => !x.passed) ? (
                <p>
                  Content checks failed:{' '}
                  <code>
                    {r.soft
                      .filter((x) => !x.passed)
                      .map((x) => x.id)
                      .join(', ')}
                  </code>
                </p>
              ) : null}
              <div className="insight-text">
                <h3>{r.result.draft.headline}</h3>
                <ul>
                  {r.result.draft.points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
                <p>{r.result.draft.suggestion}</p>
              </div>
              <details>
                <summary>Rule-based baseline</summary>
                <div className="insight-text">
                  <h3>{r.baseline.headline}</h3>
                  <ul>
                    {r.baseline.points.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                  <p>{r.baseline.suggestion}</p>
                </div>
              </details>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
