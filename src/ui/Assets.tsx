import { createContext, useContext, useEffect, useState } from 'react';

/** Resolves an asset path from package content to a URL the browser can load. */
export type AssetResolver = (path: string) => string | Promise<string>;

export const AssetResolverContext = createContext<AssetResolver>((p) => p);

export function useResolvedUrl(path: string | null | undefined): string | null {
  const resolve = useContext(AssetResolverContext);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!path) {
      setUrl(null);
      return;
    }
    Promise.resolve(resolve(path)).then(
      (u) => alive && setUrl(u),
      () => alive && setUrl(null),
    );
    return () => {
      alive = false;
    };
  }, [path, resolve]);
  return url;
}

export function AssetImage({ path, alt = '', className }: { path: string | null | undefined; alt?: string; className?: string }) {
  const url = useResolvedUrl(path);
  if (!url) return <div className={`${className ?? ''} img-placeholder`} aria-hidden="true" />;
  return <img src={url} alt={alt} className={className} loading="lazy" decoding="async" />;
}
