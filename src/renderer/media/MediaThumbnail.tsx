import { useEffect, useState } from 'react';
import { File, Film, Image as ImageIcon, Music2 } from 'lucide-react';
import type { InvokeRes } from '@shared/ipc';
import type { MediaFile } from '@shared/schema/media';
import { api } from '../lib/api';

export function MediaThumbnail({ file }: { file: MediaFile }) {
  const [sprite, setSprite] = useState<InvokeRes<'media.thumbnails'> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (file.kind !== 'video') return;
    let current = true;
    void api.invoke('media.thumbnails', { rel: file.rel }).then((value) => { if (current) setSprite(value); }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [file.rel, file.kind]);
  const frame = sprite?.frames[0];
  const Icon = file.kind === 'video' ? Film : file.kind === 'audio' ? Music2 : file.kind === 'image' ? ImageIcon : File;
  return <div className="media-thumbnail" aria-label={failed ? 'Thumbnail unavailable' : undefined}>
    {file.kind === 'image' && !failed ? <img src={file.url} alt="" loading="lazy" onError={() => setFailed(true)} /> : sprite && frame && !failed ?
      <svg className="thumbnail-sprite" viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <image href={sprite.imageUrl} width={sprite.columns * sprite.frameWidth} height={sprite.rows * sprite.frameHeight} onError={() => setFailed(true)} />
      </svg> : <Icon size={28} strokeWidth={1.5} aria-hidden="true" />}
  </div>;
}
