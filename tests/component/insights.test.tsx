import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dayKeyOffset } from '../../src/data/util';
import { changeLocale, initI18n } from '../../src/i18n';
import type { InsightData } from '../../src/insights/facts';
import { InsightCard } from '../../src/insights/InsightCard';
import { RecapTeaser } from '../../src/insights/RecapTeaser';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { makeCheck, makeSession } from '../fixtures/factories';

beforeAll(async () => {
  await initI18n('en');
});

const g = globalThis as unknown as { LanguageModel?: unknown };
afterEach(() => {
  delete g.LanguageModel;
});

function week(): InsightData {
  const day = (n: number) => dayKeyOffset(-n);
  return {
    sessions: [0, 1].map((n) =>
      makeSession({
        day: day(n),
        startedAt: `${day(n)}T10:00:00.000Z`,
        moduleId: 'l2',
        actualMinutes: 10,
        metrics: { catchShownLeft: 5, catchHitLeft: 4, catchShownRight: 5, catchHitRight: 5 },
      }),
    ),
    checks: [],
    safetyEvents: [],
  };
}

/** A fake on-device model answering with the given texts in turn. */
function installModel(...answers: string[]) {
  const prompt = vi.fn((_input: string) => Promise.resolve(answers.shift() ?? '{}'));
  const create = vi.fn(() => Promise.resolve({ prompt, destroy: () => {} }));
  g.LanguageModel = { availability: () => Promise.resolve('available'), create };
  return { prompt, create };
}

const draft = (points: string[]) =>
  JSON.stringify({ headline: '2 sessions, 20 minutes', points, suggestion: 'Keep the same calm routine.' });

describe('weekly recap card', () => {
  it('shows the rule-based recap and says when the browser has no model', async () => {
    render(<InsightCard data={week()} />);
    expect(screen.getByTestId('insight-source')).toHaveTextContent('Rule-based summary');
    expect(screen.getByTestId('insight-recap')).toHaveTextContent('2 sessions and 20 minutes');
    expect(screen.getByTestId('insight-recap')).toHaveTextContent('80% on the left and 100% on the right');
    expect(await screen.findByTestId('insight-unsupported')).toBeInTheDocument();
    expect(screen.getByTestId('insight-facts')).toHaveTextContent('"seenPercent": 80');
  });

  it('rewrites the recap with the on-device model after a click, checked against the numbers', async () => {
    const model = installModel(draft(['You reported seeing 80% on the left and 100% on the right.']));
    render(<InsightCard data={week()} />);
    await userEvent.click(await screen.findByTestId('insight-generate'));
    await waitFor(() =>
      expect(screen.getByTestId('insight-source')).toHaveTextContent('Written by on-device AI'),
    );
    expect(screen.getByTestId('insight-recap')).toHaveTextContent('80% on the left');
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ initialPrompts: [expect.objectContaining({ role: 'system' })] }),
    );
    expect(model.prompt.mock.calls[0]![0]).toContain(
      'reported seeing 80% of the check symbols shown only to the left eye',
    );
  });

  it('retries a draft with an invented number, then falls back and says why', async () => {
    installModel(draft(['You saw 95% on the left.']), draft(['Your weak eye saw 80%.']));
    render(<InsightCard data={week()} />);
    await userEvent.click(await screen.findByTestId('insight-generate'));
    expect(await screen.findByTestId('insight-fallback')).toHaveTextContent('did not pass the checks twice');
    expect(screen.getByTestId('insight-fallback')).toHaveTextContent('number:95');
    expect(screen.getByTestId('insight-source')).toHaveTextContent('Rule-based summary');
  });

  it('is switched off in a week with double vision, without asking the model', async () => {
    const model = installModel(draft(['x']));
    const data = week();
    data.checks = [makeCheck({ at: `${dayKeyOffset(0)}T10:15:00.000Z`, diplopia: 3 })];
    render(<InsightCard data={data} />);
    expect(screen.getByTestId('insight-safety')).toHaveTextContent('talk to your orthoptist');
    expect(screen.queryByTestId('insight-generate')).toBeNull();
    expect(model.create).not.toHaveBeenCalled();
  });

  it('asks for more sessions first', () => {
    const data = week();
    data.sessions = data.sessions.slice(0, 1);
    render(<InsightCard data={data} />);
    expect(screen.getByTestId('insight-too-little')).toHaveTextContent('at least 2 sessions');
  });
});

describe('page language', () => {
  it('keeps <html lang> in step with the UI, so the browser does not offer to translate it', async () => {
    await changeLocale('zh-Hans');
    expect(document.documentElement.lang).toBe('zh-Hans');
    await changeLocale('en');
    expect(document.documentElement.lang).toBe('en');
  });
});

function Landing() {
  const location = useLocation();
  return <p data-testid="landed">{JSON.stringify(location.state)}</p>;
}

describe('recap card on the overview', () => {
  const inRouter = (data: InsightData) =>
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<RecapTeaser data={data} />} />
          <Route path="/report" element={<Landing />} />
        </Routes>
      </MemoryRouter>,
    );

  it('shows the headline and a key point, and opens the full recap', async () => {
    inRouter(week());
    expect(screen.getByTestId('recap-teaser-text')).toHaveTextContent('2 sessions and 20 minutes');
    expect(screen.getByTestId('recap-teaser-text')).toHaveTextContent('80% on the left');
    await userEvent.click(screen.getByTestId('recap-teaser-open'));
    expect(screen.getByTestId('landed')).toHaveTextContent('{"focus":"recap"}');
  });

  it('mentions the on-device AI only when this browser has it', async () => {
    installModel();
    inRouter(week());
    expect(await screen.findByText(/rewritten in plain words by the on-device AI/)).toBeInTheDocument();
  });

  it('asks for more sessions, without a link, when the week is too short', () => {
    const data = week();
    data.sessions = data.sessions.slice(0, 1);
    inRouter(data);
    expect(screen.getByTestId('recap-teaser-too-little')).toHaveTextContent('at least 2 sessions');
    expect(screen.queryByTestId('recap-teaser-open')).toBeNull();
  });

  it('says why there is no recap in a week with symptoms', () => {
    const data = week();
    data.checks = [makeCheck({ at: `${dayKeyOffset(0)}T10:15:00.000Z`, diplopia: 3 })];
    inRouter(data);
    expect(screen.getByTestId('recap-teaser-safety')).toHaveTextContent('talk to your orthoptist');
  });
});

describe('arriving at the recap', () => {
  it('brings the recap card into view and focus when asked to', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<InsightCard data={week()} focus />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('insight-card')));
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
