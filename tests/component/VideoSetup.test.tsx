import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/i18n';
import type { ModuleConfig } from '../../src/modules/types';
import { VideoSetup } from '../../src/modules/video/VideoSetup';

void initI18n('en');

let created: string[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:test/${++n}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});

afterEach(() => vi.restoreAllMocks());

function setup() {
  const onChange = vi.fn<(c: ModuleConfig | null) => void>();
  render(<VideoSetup onChange={onChange} />);
  return { onChange, user: userEvent.setup(), last: () => onChange.mock.calls.at(-1)?.[0] ?? null };
}

/** Switch from the default built-in scene to "File on this device". */
async function useFile() {
  const s = setup();
  await s.user.click(screen.getByRole('button', { name: 'File on this device' }));
  return s;
}

describe('video setup', () => {
  it('offers a built-in calm scene by default, ready without any file', async () => {
    const { user, last } = setup();
    expect(last()).toMatchObject({ kind: 'scene', scene: 'aquarium', name: 'Aquarium' });
    await user.click(screen.getByRole('button', { name: 'Floating lanterns' }));
    expect(last()).toMatchObject({ kind: 'scene', scene: 'lanterns' });
    expect(created).toEqual([]);
  });

  it('reports nothing until a video is chosen, then a local blob URL that never leaves the device', async () => {
    const { user, last } = await useFile();
    expect(last()).toBeNull();
    const file = new File([new Uint8Array([1, 2, 3])], 'calm.webm', { type: 'video/webm' });
    await user.upload(screen.getByTestId('video-file'), file);
    expect(last()).toMatchObject({
      kind: 'file',
      src: 'blob:test/1',
      name: 'calm.webm',
      loop: true,
      muted: false,
    });
    expect(screen.getByText('Chosen: calm.webm')).toBeInTheDocument();
  });

  it('replacing the file revokes the previous blob URL', async () => {
    const { user, last } = await useFile();
    await user.upload(screen.getByTestId('video-file'), new File(['a'], 'a.webm', { type: 'video/webm' }));
    await user.upload(screen.getByTestId('video-file'), new File(['b'], 'b.webm', { type: 'video/webm' }));
    expect(revoked).toContain('blob:test/1');
    expect(last()).toMatchObject({ src: 'blob:test/2', name: 'b.webm' });
  });

  it('loop and mute options are passed on', async () => {
    const { user, last } = await useFile();
    await user.upload(screen.getByTestId('video-file'), new File(['a'], 'a.webm', { type: 'video/webm' }));
    const [loop, muted] = screen.getAllByRole('checkbox');
    await user.click(loop!);
    await user.click(muted!);
    expect(last()).toMatchObject({ loop: false, muted: true });
  });

  it('accepts a direct https video link but not plain http', async () => {
    const { user, last } = setup();
    await user.click(screen.getByRole('button', { name: 'Direct video link' }));
    const input = screen.getByLabelText('Video link (https)');
    await user.type(input, 'http://example.org/clip.mp4');
    expect(last()).toBeNull();
    expect(screen.getByText('Use a full https:// link.')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'https://example.org/media/clip.mp4');
    expect(last()).toMatchObject({
      kind: 'url',
      src: 'https://example.org/media/clip.mp4',
      name: 'clip.mp4',
    });
  });

  it('never processes YouTube or Bilibili: they are refused as training sources', async () => {
    const { user, last } = setup();
    await user.click(screen.getByRole('button', { name: 'Direct video link' }));
    const input = screen.getByLabelText('Video link (https)');
    for (const url of [
      'https://www.youtube.com/watch?v=x',
      'https://youtu.be/x',
      'https://www.bilibili.com/video/BV1',
    ]) {
      await user.clear(input);
      await user.type(input, url);
      expect(last()).toBeNull();
      expect(screen.getByText(/cannot be used for training/)).toBeInTheDocument();
    }
  });

  it('offers streaming sites only as plain viewing in a new tab, without referrer', async () => {
    const { user } = setup();
    await user.click(screen.getByText('Plain viewing (not training)', { exact: false }));
    await user.type(
      screen.getByPlaceholderText('https://www.youtube.com/…'),
      'https://www.youtube.com/watch?v=x',
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=x');
  });
});
