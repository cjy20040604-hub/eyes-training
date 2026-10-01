/** Strip control characters and cap length for any free-text the user enters. */
export function sanitizeText(input: unknown, maxLength = 2000): string {
  if (typeof input !== 'string') return '';
  // Remove C0/C1 control chars except tab/newline, and bidi override characters.
  const cleaned = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[‪-‮⁦-⁩]/g, '');
  return cleaned.slice(0, maxLength);
}

/** Neutralise spreadsheet formula injection when writing CSV cells. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
