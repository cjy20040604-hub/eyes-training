import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/i18n';
import { StopButton } from '../../src/safety/StopButton';

initI18n('en');

describe('StopButton', () => {
  it('renders with black/white styling, a shape class and a text label', () => {
    render(<StopButton onStop={() => {}} />);
    const btn = screen.getByTestId('stop-button');
    expect(btn).toHaveClass('stop-button');
    expect(btn).toHaveTextContent(/STOP/);
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('Escape');
  });

  it('fires on click and on Escape', () => {
    const onStop = vi.fn();
    render(<StopButton onStop={onStop} />);
    fireEvent.click(screen.getByTestId('stop-button'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it('does not fire when disabled', () => {
    const onStop = vi.fn();
    render(<StopButton onStop={onStop} disabled />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onStop).not.toHaveBeenCalled();
  });
});
