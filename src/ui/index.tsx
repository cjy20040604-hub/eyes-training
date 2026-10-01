import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/* Accessible, colour-independent UI primitives. All chrome lives OUTSIDE the anaglyph
   stimulus area; warnings always use shape + text + contrast, never colour alone. */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  variant = 'secondary',
  small,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }) {
  const cls = ['btn', variant === 'secondary' ? '' : variant, small ? 'small' : '', className]
    .filter(Boolean)
    .join(' ');
  return <button type="button" className={cls} {...rest} />;
}

export function Card({
  title,
  children,
  muted,
  className = '',
}: {
  title?: ReactNode;
  children: ReactNode;
  muted?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${muted ? 'muted' : ''} ${className}`}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="label">{label}</span>}
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

const GLYPH: Record<'info' | 'warn' | 'danger' | 'success', string> = {
  info: 'i',
  warn: '!',
  danger: '✕',
  success: '✓',
};

export function Banner({
  tone,
  title,
  children,
  role,
}: {
  tone: 'info' | 'warn' | 'danger' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  role?: string;
}) {
  return (
    <div className={`banner ${tone}`} role={role ?? (tone === 'danger' ? 'alert' : 'status')}>
      <span className="glyph" aria-hidden="true">
        {GLYPH[tone]}
      </span>
      <div>
        {title ? <strong>{title}</strong> : null}
        {title && children ? <br /> : null}
        {children}
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabledValues,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  label: string;
  disabledValues?: T[];
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabledValues?.includes(o.value)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({
  value,
  max = 1,
  tone,
}: {
  value: number;
  max?: number;
  tone?: 'warn' | 'danger';
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={`progress ${tone ?? ''}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="stat">
      <span className="value">{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}

export function Dialog({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  onClose?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        ref={ref}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="app-footer">
      <strong>{t('footer.notMedical')}</strong> {t('footer.body')}
    </footer>
  );
}
