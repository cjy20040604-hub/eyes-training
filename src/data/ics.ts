/**
 * Training reminders as a calendar file (RFC 5545). The user imports it into the calendar
 * they already use (phone or computer), which reminds them reliably: a web app without a
 * server cannot schedule notifications on its own.
 */

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export interface ReminderIcsInput {
  /** 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  /** Local time HH:MM. */
  time: string;
  title: string;
  description: string;
  /** Link to open the app from the calendar entry. */
  url?: string;
  now?: Date;
  uid?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Escape TEXT values: backslash, semicolon, comma and newlines. */
export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold content lines longer than 75 octets (continuation lines start with a space). */
export function foldIcsLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(
    d.getUTCMinutes(),
  )}${pad(d.getUTCSeconds())}Z`;
}

/** The next local date (today included, if the time is still ahead) on one of the weekdays. */
export function firstOccurrence(weekdays: number[], time: string, now: Date): Date {
  const [h, m] = time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h ?? 19, m ?? 0, 0);
    if (weekdays.includes(d.getDay()) && d > now) return d;
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, h ?? 19, m ?? 0, 0);
}

export function buildReminderIcs(input: ReminderIcsInput): string {
  const days = [...new Set(input.weekdays)].filter((d) => d >= 0 && d <= 6).sort();
  if (days.length === 0) throw new Error('Choose at least one day.');
  const now = input.now ?? new Date();
  const start = firstOccurrence(days, input.time, now);
  // Floating local time: the reminder follows the user's clock, wherever they are.
  const dtStart = `${start.getFullYear()}${pad(start.getMonth() + 1)}${pad(start.getDate())}T${pad(
    start.getHours(),
  )}${pad(start.getMinutes())}00`;
  const uid =
    input.uid ?? `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}@eyes-training`;
  const description = input.url ? `${input.description}\n${input.url}` : input.description;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Binocular Vision Explorer//Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${dtStart}`,
    'DURATION:PT15M',
    `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(',')}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    ...(input.url ? [`URL:${input.url}`] : []),
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(input.title)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
