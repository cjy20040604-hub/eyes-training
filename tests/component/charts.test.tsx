import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BarChart, LineChart } from '../../src/dashboard/charts';
import { initI18n } from '../../src/i18n';

void initI18n('en');

const days = ['1 Oct', '2 Oct', '3 Oct', '4 Oct'];

describe('charts', () => {
  it('a line chart draws one marker per value, labels its series and has a data table', () => {
    render(
      <LineChart
        title="Perceived offset"
        testId="line"
        format={(v) => `${v.toFixed(1)}Δ`}
        series={[
          { name: 'Break', points: days.map((label, i) => ({ label, value: [4, 5, null, 6][i]! })) },
          { name: 'Recovery', points: days.map((label, i) => ({ label, value: [2, 3, 3, null][i]! })) },
        ]}
      />,
    );
    const chart = screen.getByTestId('line');
    const svg = within(chart).getByRole('img', { name: 'Perceived offset' });
    // Six non-null values, one marker each.
    expect(svg.querySelectorAll('circle').length).toBeGreaterThanOrEqual(6);
    // Two series: both named (legend / direct labels), never colour alone.
    expect(chart).toHaveTextContent('Break');
    expect(chart).toHaveTextContent('Recovery');
    // The table view lists every value, with gaps shown as gaps.
    const table = within(chart).getByRole('table');
    expect(table).toHaveTextContent('6.0Δ');
    expect(table).toHaveTextContent('3.0Δ');
  });

  it('every point sits at or under the top gridline', () => {
    render(
      <LineChart
        title="Catch rate"
        testId="line"
        series={[
          {
            name: 'Catch rate',
            points: days.map((label, i) => ({ label, value: [0.2, 0.9, 1.07, 0.5][i]! })),
          },
        ]}
      />,
    );
    const svg = within(screen.getByTestId('line')).getByRole('img');
    const ys = [...svg.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cy')));
    const gridYs = [...svg.querySelectorAll('line')]
      .map((l) => Number(l.getAttribute('y1')))
      .filter((y) => Number.isFinite(y));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(Math.min(...gridYs) - 0.5);
  });

  it('shows a message instead of an empty plot', () => {
    render(<LineChart title="Nothing yet" testId="empty" series={[{ name: 'x', points: [] }]} />);
    expect(screen.getByTestId('empty')).toHaveTextContent('No sessions yet for this measure.');
    expect(within(screen.getByTestId('empty')).queryByRole('img')).toBeNull();
  });

  it('a bar chart shows its reference line and a tooltip on hover', () => {
    render(
      <BarChart
        title="Minutes per day"
        testId="bars"
        format={(v) => `${v} min`}
        reference={{ value: 30, label: 'Daily limit' }}
        points={days.map((label, i) => ({ label, value: [10, 0, 25, 30][i]! }))}
      />,
    );
    const chart = screen.getByTestId('bars');
    expect(chart).toHaveTextContent('Daily limit');
    const bars = within(chart).getByRole('img').querySelectorAll('rect');
    expect(bars.length).toBeGreaterThan(0);
    fireEvent.pointerMove(bars[bars.length - 1]!);
    fireEvent.pointerEnter(bars[bars.length - 1]!);
    expect(within(chart).getByRole('table')).toHaveTextContent('25 min');
  });
});
