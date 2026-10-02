import type { Plugin } from 'vite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * three's DRACOLoader builds its default decoder URLs with `new URL(..., import.meta.url)` at module
 * load. That throws in a classic (IIFE) script, where import.meta does not exist. The application always
 * calls setDecoderPath() with the package-local folder, so the defaults are replaced with plain strings.
 */
export function dracoUrlFix(): Plugin {
  return {
    name: 'draco-url-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!/DRACOLoader\.js$/.test(id.split('?')[0])) return null;
      return code.replace(/new URL\(\s*'\.\.\/libs\/draco\/(?:gltf\/)?([^']+)',\s*import\.meta\.url\s*\)\.toString\(\)/g, "'lib/draco/$1'");
    },
  };
}

/** Copies the Draco decoder into public/lib/draco so the app and exporter can serve it locally. */
export function copyDracoDecoder(): Plugin {
  const copy = () => {
    const src = resolve('node_modules/three/examples/jsm/libs/draco/gltf');
    const out = resolve('public/lib/draco');
    mkdirSync(out, { recursive: true });
    for (const f of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
      if (existsSync(resolve(src, f))) copyFileSync(resolve(src, f), resolve(out, f));
    }
  };
  return { name: 'copy-draco-decoder', buildStart: copy, configureServer: copy };
}
