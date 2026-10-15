import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Field, Segmented } from '../../ui';
import type { ModuleSetupProps } from '../types';

const PLAIN_VIEWING_HOSTS = /(^|\.)(youtube\.com|youtu\.be|bilibili\.com|b23\.tv)$/i;

function parseHttpsUrl(text: string): URL | null {
  try {
    const u = new URL(text.trim());
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/**
 * Chooses the video for a dichoptic session.
 *  - Local file (recommended): read with the File API into a blob: URL; never uploaded.
 *  - Direct https video URL: only works if the server allows cross-origin reading (CORS);
 *    otherwise the frames cannot be processed or checked for flashing, and playback stops.
 *  - YouTube / Bilibili and other streaming sites cannot be processed (their players and
 *    DRM do not allow it, and downloading breaks their terms). They are offered only as
 *    plain viewing in a new tab, clearly labelled as not training.
 */
export function VideoSetup({ onChange }: ModuleSetupProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<'file' | 'url'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [loop, setLoop] = useState(true);
  const [muted, setMuted] = useState(false);
  const [plain, setPlain] = useState('');
  const blobRef = useRef<string | null>(null);

  const parsedUrl = parseHttpsUrl(url);
  const urlIsStreamingSite = parsedUrl ? PLAIN_VIEWING_HOSTS.test(parsedUrl.hostname) : false;
  const plainUrl = parseHttpsUrl(plain);

  useEffect(() => {
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
    if (source === 'file' && file) {
      const src = URL.createObjectURL(file);
      blobRef.current = src;
      onChange({ kind: 'file', src, name: file.name, loop, muted });
    } else if (source === 'url' && parsedUrl && !urlIsStreamingSite) {
      onChange({
        kind: 'url',
        src: parsedUrl.href,
        name: parsedUrl.pathname.split('/').pop() || parsedUrl.hostname,
        loop,
        muted,
      });
    } else {
      onChange(null);
    }
    // The blob URL is revoked when the session's video module stops, not on unmount here,
    // because the session keeps using it after this setup step is hidden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, file, url, loop, muted]);

  return (
    <section className="video-setup" data-testid="video-setup">
      <h2>{t('modules.video.setup.title')}</h2>
      <Banner tone="warn" title={t('modules.video.setup.safetyTitle')}>
        {t('modules.video.setup.safetyBody')}
      </Banner>
      <Field label={t('modules.video.setup.source')}>
        <Segmented
          value={source}
          onChange={setSource}
          label={t('modules.video.setup.source')}
          options={[
            { value: 'file', label: t('modules.video.setup.fromFile') },
            { value: 'url', label: t('modules.video.setup.fromUrl') },
          ]}
        />
      </Field>
      {source === 'file' ? (
        <Field
          label={t('modules.video.setup.file')}
          htmlFor="video-file"
          hint={
            file ? t('modules.video.setup.chosen', { name: file.name }) : t('modules.video.setup.fileHint')
          }
        >
          <input
            id="video-file"
            type="file"
            accept="video/*"
            data-testid="video-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
      ) : (
        <>
          <Field
            label={t('modules.video.setup.url')}
            htmlFor="video-url"
            hint={t('modules.video.setup.urlHint')}
          >
            <input
              id="video-url"
              type="text"
              inputMode="url"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          {url && !parsedUrl ? <Banner tone="warn">{t('modules.video.setup.httpsOnly')}</Banner> : null}
          {urlIsStreamingSite ? <Banner tone="warn">{t('modules.video.setup.streamingSite')}</Banner> : null}
        </>
      )}
      <div className="row">
        <label className="row">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          <span>{t('modules.video.setup.loop')}</span>
        </label>
        <label className="row">
          <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
          <span>{t('modules.video.setup.muted')}</span>
        </label>
      </div>

      <details className="plain-viewing">
        <summary>{t('modules.video.setup.plainTitle')}</summary>
        <p className="hint">{t('modules.video.setup.plainBody')}</p>
        <div className="row">
          <input
            type="text"
            inputMode="url"
            placeholder="https://www.youtube.com/…"
            value={plain}
            onChange={(e) => setPlain(e.target.value)}
            aria-label={t('modules.video.setup.plainTitle')}
          />
          {plainUrl ? (
            <a className="btn" href={plainUrl.href} target="_blank" rel="noopener noreferrer">
              {t('modules.video.setup.plainOpen')}
            </a>
          ) : null}
        </div>
      </details>
    </section>
  );
}
