import { APP_VERSION, type ErrorLogEntry } from './errorLog';

/**
 * One-click problem reports, with no server: the user reviews a plain-text report (app
 * version, browser, the last errors) and chooses to open a pre-filled GitHub issue or copy
 * the text. Nothing is sent automatically; training data is never part of it.
 */

export const ISSUES_URL = 'https://github.com/cjy20040604-hub/eyes-training/issues/new';
/** Keep the issue URL well under the length browsers and GitHub accept. */
const MAX_URL_LENGTH = 7000;
const MAX_ERRORS = 8;

export interface ErrorReport {
  title: string;
  body: string;
}

export function buildErrorReport(
  entries: ErrorLogEntry[],
  env: { userAgent: string; language: string; note?: string },
): ErrorReport {
  const recent = [...entries].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ERRORS);
  const first = recent[0];
  const title = `Error report: ${first ? first.message.slice(0, 80) : 'problem'} (v${APP_VERSION})`;
  const lines = [
    '<!-- Sent by the user from the app. Contains no training data. -->',
    `**App version:** ${APP_VERSION}`,
    `**Browser:** ${env.userAgent}`,
    `**Language:** ${env.language}`,
    '',
  ];
  if (env.note?.trim()) lines.push('**What happened:**', env.note.trim().slice(0, 1000), '');
  lines.push(`**Last ${recent.length} error(s):**`, '');
  for (const e of recent) {
    lines.push(`- ${e.at} · ${e.kind} · \`${e.route || '/'}\` · v${e.appVersion}`);
    lines.push(`  ${e.message}`);
    const stack = e.stack.split('\n').slice(0, 6).join('\n');
    if (stack) lines.push('', '  ```', ...stack.split('\n').map((l) => `  ${l}`), '  ```');
  }
  return { title, body: lines.join('\n') };
}

/** A pre-filled "new issue" link; the body is shortened to keep the URL within limits. */
export function issueUrl(report: ErrorReport): string {
  const make = (body: string) =>
    `${ISSUES_URL}?${new URLSearchParams({ title: report.title, body, labels: 'bug,from-app' }).toString()}`;
  let body = report.body;
  let url = make(body);
  while (url.length > MAX_URL_LENGTH && body.length > 200) {
    body = `${body.slice(0, Math.floor(body.length * 0.8))}\n\n… (shortened; use "Copy report" for the full text)`;
    url = make(body);
  }
  return url;
}
