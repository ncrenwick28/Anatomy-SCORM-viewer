import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { assetUrl } from '../state/assets';

export function AssetThumb({ id, alt = '', className = '' }: { id: string | null | undefined; alt?: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    setDone(false);
    assetUrl(id).then((u) => {
      if (alive) {
        setUrl(u);
        setDone(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [id]);
  if (url) return <img className={className} src={url} alt={alt} loading="lazy" decoding="async" />;
  return (
    <div className={`${className} thumb-empty`} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
      {done && <ImageOff aria-hidden="true" />}
    </div>
  );
}
