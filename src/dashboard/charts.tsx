import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Small, dependency-free SVG charts for progress trends.
 * Method (dataviz skill): one y-axis, thin 2px lines, ≥8px markers, recessive grid,
 * a legend + direct labels whenever there are two series (identity never by colour
 * alone), hover tooltips, and a data-table view for every chart.
 * Palette validated with the dataviz validator against both surfaces:
 *   light: series-1 #2847b5, series-2 #c95220 · dark: #6f8cf0, #d95926.
 */

export interface SeriesPoint {
  /** x label, e.g. a short date */
  label: string;
  value: number | null;
}

export interface Series {
  name: string;
  points: SeriesPoint[];
}

function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!el) return;
    const update = () => setW(Math.max(240, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

/** Rough text width for tick labels (12px font), so long labels are never clipped. */
function labelWidth(labels: string[]): number {
  return Math.max(0, ...labels.map((l) => l.length)) * 7 + 12;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? mag * 10;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  // Always end on a tick at or above the maximum, so no point sits above the top gridline.
  for (let v = start; v < max + step - 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function ChartFrame({
  title,
  subtitle,
  children,
  table,
  empty,
  testId,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  table: ReactNode;
  empty: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <figure className="chart" data-testid={testId}>
      <figcaption>
        <strong>{title}</strong>
        {subtitle ? <span className="hint">{subtitle}</span> : null}
      </figcaption>
      {empty ? <p className="hint chart-empty">{t('trends.noData')}</p> : children}
      {!empty ? (
        <details className="chart-table no-print">
          <summary>{t('trends.showTable')}</summary>
          {table}
        </details>
      ) : null}
    </figure>
  );
}

export function LineChart({
  title,
  subtitle,
  series,
  format = (v) => String(v),
  yDomain,
  yTickFormat,
  testId,
}: {
  title: string;
  subtitle?: string;
  series: Series[];
  format?: (v: number) => string;
  yDomain?: [number, number];
  yTickFormat?: (v: number) => string;
  testId?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();
  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const values = series.flatMap((s) => s.points.map((p) => p.value)).filter((v): v is number => v !== null);
  const empty = values.length === 0;
  const H = 190;
  const lo = yDomain ? yDomain[0] : Math.min(...values, 0);
  const hi = yDomain ? yDomain[1] : Math.max(...values, 1);
  const ticks = yDomain ? niceTicks(lo, hi, 4).filter((t) => t >= lo && t <= hi) : niceTicks(lo, hi, 4);
  const tickFmt = yTickFormat ?? format;
  const m = {
    top: 14,
    right: series.length > 1 ? 96 : 20,
    bottom: 26,
    left: Math.max(40, labelWidth(ticks.map((v) => tickFmt(v)))),
  };
  const y0 = yDomain ? lo : Math.min(lo, ticks[0] ?? lo);
  const y1 = yDomain ? hi : Math.max(hi, ticks[ticks.length - 1] ?? hi);
  const plotW = width - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const n = labels.length;
  const x = (i: number) => m.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => m.top + plotH - ((v - y0) / (y1 - y0 || 1)) * plotH;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (n === 0) return;
    const i = n <= 1 ? 0 : Math.round(((px - m.left) / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const table = (
    <table>
      <thead>
        <tr>
          <th>{''}</th>
          {series.map((s) => (
            <th key={s.name}>{s.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {labels.map((l, i) => (
          <tr key={`${l}-${i}`}>
            <td>{l}</td>
            {series.map((s) => {
              const v = s.points[i]?.value;
              return <td key={s.name}>{v === null || v === undefined ? '—' : format(v)}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame title={title} subtitle={subtitle} table={table} empty={empty} testId={testId}>
      {series.length > 1 ? (
        <div className="legend chart-legend">
          {series.map((s, i) => (
            <span key={s.name}>
              <i className={`swatch s${i + 1}`} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="chart-plot" ref={ref}>
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={title}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={m.left - 6} y={m.top - 6} width={plotW + 12} height={plotH + 12} />
            </clipPath>
          </defs>
          {ticks.map((tv) => (
            <g key={tv}>
              <line className="grid" x1={m.left} x2={m.left + plotW} y1={y(tv)} y2={y(tv)} />
              <text className="tick" x={m.left - 8} y={y(tv)} textAnchor="end" dominantBaseline="middle">
                {tickFmt(tv)}
              </text>
            </g>
          ))}
          {n > 0 ? (
            <>
              <text className="tick" x={x(0)} y={H - 6} textAnchor={n > 1 ? 'start' : 'middle'}>
                {labels[0]}
              </text>
              {n > 1 ? (
                <text className="tick" x={x(n - 1)} y={H - 6} textAnchor="end">
                  {labels[n - 1]}
                </text>
              ) : null}
            </>
          ) : null}
          {hover !== null ? (
            <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + plotH} />
          ) : null}
          <g clipPath={`url(#${clipId})`}>
            {series.map((s, si) => {
              const pts = s.points
                .map((p, i) => (p.value === null ? null : { i, v: p.value }))
                .filter((p): p is { i: number; v: number } => p !== null);
              const d = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i)},${y(p.v)}`).join(' ');
              return (
                <g key={s.name} className={`series s${si + 1}`}>
                  <path d={d} fill="none" />
                  {pts.map((p) => (
                    <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={hover === p.i ? 5 : 4} />
                  ))}
                </g>
              );
            })}
          </g>
          {series.length > 1
            ? series.map((s, si) => {
                const last = [...s.points].reverse().find((p) => p.value !== null);
                const li = last ? s.points.lastIndexOf(last) : -1;
                return last && last.value !== null ? (
                  <text
                    key={s.name}
                    className="direct-label"
                    x={x(li) + 10}
                    y={y(last.value) + (si === 0 ? -6 : 12)}
                  >
                    {s.name}
                  </text>
                ) : null;
              })
            : null}
        </svg>
        {hover !== null ? (
          <div
            className="chart-tip"
            style={{ left: Math.min(Math.max(x(hover), 70), width - 70), top: 0 }}
            role="status"
          >
            <strong>{labels[hover]}</strong>
            {series.map((s, si) => {
              const v = s.points[hover]?.value;
              return (
                <span key={s.name}>
                  {series.length > 1 ? <i className={`swatch s${si + 1}`} /> : null}
                  {series.length > 1 ? `${s.name}: ` : ''}
                  {v === null || v === undefined ? '—' : format(v)}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </ChartFrame>
  );
}

export function BarChart({
  title,
  subtitle,
  points,
  format = (v) => String(v),
  reference,
  testId,
}: {
  title: string;
  subtitle?: string;
  points: SeriesPoint[];
  format?: (v: number) => string;
  /** Optional reference line, e.g. the daily limit. */
  reference?: { value: number; label: string };
  testId?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 170;
  const m = { top: 14, right: 16, bottom: 26, left: 40 };
  const values = points.map((p) => p.value ?? 0);
  const empty = values.every((v) => v === 0);
  const hi = Math.max(1, ...values, reference?.value ?? 0);
  const ticks = niceTicks(0, hi, 3);
  const top = Math.max(hi, ticks[ticks.length - 1] ?? hi);
  const plotW = width - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const n = points.length;
  const slot = plotW / Math.max(1, n);
  const barW = Math.max(3, Math.min(22, slot - 2));
  const y = (v: number) => m.top + plotH - (v / top) * plotH;

  const table = (
    <table>
      <tbody>
        {points.map((p, i) => (
          <tr key={`${p.label}-${i}`}>
            <td>{p.label}</td>
            <td>{format(p.value ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame title={title} subtitle={subtitle} table={table} empty={empty} testId={testId}>
      <div className="chart-plot" ref={ref}>
        <svg width={width} height={H} role="img" aria-label={title} onPointerLeave={() => setHover(null)}>
          {ticks.map((tv) => (
            <g key={tv}>
              <line className="grid" x1={m.left} x2={m.left + plotW} y1={y(tv)} y2={y(tv)} />
              <text className="tick" x={m.left - 8} y={y(tv)} textAnchor="end" dominantBaseline="middle">
                {format(tv)}
              </text>
            </g>
          ))}
          {reference ? (
            <g>
              <line
                className="reference"
                x1={m.left}
                x2={m.left + plotW}
                y1={y(reference.value)}
                y2={y(reference.value)}
              />
              <text className="tick" x={m.left + plotW} y={y(reference.value) - 5} textAnchor="end">
                {reference.label}
              </text>
            </g>
          ) : null}
          {points.map((p, i) => {
            const v = p.value ?? 0;
            const bx = m.left + i * slot + (slot - barW) / 2;
            const h = Math.max(v > 0 ? 2 : 0, plotH - (y(v) - m.top));
            return (
              <g key={`${p.label}-${i}`} onPointerEnter={() => setHover(i)}>
                <rect className="hit" x={m.left + i * slot} y={m.top} width={slot} height={plotH} />
                {v > 0 ? (
                  <path
                    className={`bar ${hover === i ? 'active' : ''}`}
                    d={roundedTopBar(bx, y(v), barW, h, Math.min(4, barW / 2))}
                  />
                ) : null}
              </g>
            );
          })}
          {n > 0 ? (
            <>
              <text className="tick" x={m.left} y={H - 6}>
                {points[0]?.label}
              </text>
              <text className="tick" x={m.left + plotW} y={H - 6} textAnchor="end">
                {points[n - 1]?.label}
              </text>
            </>
          ) : null}
        </svg>
        {hover !== null ? (
          <div
            className="chart-tip"
            style={{ left: Math.min(Math.max(m.left + hover * slot + slot / 2, 70), width - 70), top: 0 }}
            role="status"
          >
            <strong>{points[hover]?.label}</strong>
            <span>{format(points[hover]?.value ?? 0)}</span>
          </div>
        ) : null}
      </div>
    </ChartFrame>
  );
}

function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}
