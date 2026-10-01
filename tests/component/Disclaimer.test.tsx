import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/i18n';
import { DisclaimerScreen } from '../../src/safety/DisclaimerScreen';

initI18n('en');

describe('DisclaimerScreen', () => {
  it('requires every acknowledgement before accepting', async () => {
    const onAccept = vi.fn();
    render(<DisclaimerScreen onAccept={onAccept} />);
    const accept = screen.getByTestId('accept-disclaimer');
    expect(accept).toBeDisabled();
    expect(screen.getByText(/not medical treatment/i)).toBeInTheDocument();
    expect(
      screen.getByText(/does NOT tell us whether breaking your long-standing suppression/i),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('ack-1'));
    await user.click(screen.getByTestId('ack-2'));
    await user.click(screen.getByTestId('ack-3'));
    expect(accept).toBeDisabled();
    await user.click(screen.getByTestId('ack-4'));
    expect(accept).toBeEnabled();
    await user.click(accept);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});
