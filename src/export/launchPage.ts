const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The launch page. The Content-Security-Policy confines the package to its own files: it cannot load
 * scripts, styles, fonts, images or data from any other origin, which is also how "no CDN / no
 * external services" is enforced rather than merely promised.
 */
export function generateLaunchPage(title: string): string {
  const csp = [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="stylesheet" href="assets/player.css">
</head>
<body>
<div id="root"><p class="boot-message" role="status">Loading learning package…</p></div>
<noscript><p class="boot-message">This learning package needs JavaScript. Please enable it in your browser and reload.</p></noscript>
<script src="data/content.js"></script>
<script src="assets/player.js"></script>
</body>
</html>
`;
}
