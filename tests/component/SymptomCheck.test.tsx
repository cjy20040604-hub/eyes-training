import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/i18n';
import { SymptomCheckForm } from '../../src/safety/SymptomCheckForm';

initI18n('en');

describe('SymptomCheckForm', () => {
  it('submits a PEDIG-style check with the chosen diplopia frequency', async () => {
    const onSubmit = vi.fn();
    render(<SymptomCheckForm phase="post" sessionId="ses_1" onSubmit={onSubmit} />);
    const user = userEvent.setup();
    const group = screen.getByRole('group', { name: /double vision/i });
    await user.click(within(group).getByRole('button', { name: 'Sometimes' }));
    await user.click(screen.getByTestId('symptom-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0]![0];
    expect(arg.check.phase).toBe('post');
    expect(arg.check.sessionId).toBe('ses_1');
    expect(arg.check.diplopia).toBe(2);
    expect(Object.values(arg.redFlags).some(Boolean)).toBe(false);
  });

  it('carries red-flag reports and changes the submit label', async () => {
    const onSubmit = vi.fn();
    render(<SymptomCheckForm phase="pre" sessionId={null} onSubmit={onSubmit} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('redflag-ptosis'));
    expect(screen.getByTestId('symptom-submit')).toHaveTextContent(/red flag/i);
    await user.click(screen.getByTestId('symptom-submit'));
    expect(onSubmit.mock.calls[0]![0].redFlags.ptosis).toBe(true);
  });
});

function within(el: HTMLElement) {
  return {
    getByRole: (role: string, opts: { name: string }) =>
      Array.from(el.querySelectorAll<HTMLElement>(role === 'button' ? 'button' : '*')).find(
        (b) => b.textContent?.trim() === opts.name,
      )!,
  };
}
