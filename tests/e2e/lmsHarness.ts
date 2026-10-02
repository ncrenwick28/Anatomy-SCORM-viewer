import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A minimal "LMS" for testing exported packages: a parent page that hosts the package in an iframe and exposes
 * a SCORM 1.2 API adapter as window.API, exactly where a real LMS puts it. Modes:
 *   ok          – a conforming mock that records every call in window.__lms
 *   scorm-again – an independent SCORM 1.2 run-time implementation (scorm-again) that validates values
 *   initfail    – LMSInitialize returns "false"
 *   commitfail  – SetValue/Commit fail (error 391) while window.__lms.failing is true
 *   throw       – every call throws
 *   none        – no API at all (standalone)
 * Initial LMS data can be seeded with query parameters (status, entry, suspend, location, lesson_mode).
 */
export function harnessHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Test LMS</title></head><body style="margin:0">
<script src="/__lms/scorm12.js"></script>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var mode = q.get('mode') || 'ok';
  var data = {
    'cmi.core.lesson_status': q.get('status') || 'not attempted',
    'cmi.core.entry': q.get('entry') || 'ab-initio',
    'cmi.suspend_data': q.get('suspend') || '',
    'cmi.core.lesson_location': q.get('location') || '',
    'cmi.core.lesson_mode': q.get('lesson_mode') || 'normal',
    'cmi.core.student_id': 'learner-1', 'cmi.core.student_name': 'Learner, Test'
  };
  var log = [], err = '0';
  var lms = { mode: mode, data: data, log: log, failing: mode === 'commitfail' && q.get('failnow') !== '0', initialised: false, finished: false };
  window.__lms = lms;
  if (mode === 'none') return;
  if (mode === 'scorm-again') {
    var api = new window.Scorm12API({ logLevel: 5, autocommit: false });
    api.loadFromJSON({ cmi: { core: { lesson_status: q.get('status') || 'not attempted', entry: q.get('entry') || 'ab-initio', lesson_location: q.get('location') || '' }, suspend_data: q.get('suspend') || '' } }, '');
    var writes = {}; lms.writes = writes; lms.rejected = [];
    var orig = api.LMSSetValue.bind(api);
    api.LMSSetValue = function (n, v) { var r = orig(n, v); if (String(r) === 'true') writes[n] = v; else lms.rejected.push(n + '=' + v); return r; };
    lms.api = api;
    window.API = api;
    return;
  }
  function boom() { if (mode === 'throw') throw new Error('LMS exploded'); }
  window.API = {
    LMSInitialize: function () { log.push(['init']); boom(); if (mode === 'initfail') { err = '101'; return 'false'; } lms.initialised = true; err = '0'; return 'true'; },
    LMSFinish: function () { log.push(['finish']); boom(); lms.finished = true; err = '0'; return 'true'; },
    LMSGetValue: function (n) { log.push(['get', n]); boom(); err = '0'; return data[n] === undefined ? '' : data[n]; },
    LMSSetValue: function (n, v) { log.push(['set', n, v]); boom(); if (lms.failing) { err = '391'; return 'false'; } data[n] = v; err = '0'; return 'true'; },
    LMSCommit: function () { log.push(['commit']); boom(); if (lms.failing) { err = '391'; return 'false'; } err = '0'; return 'true'; },
    LMSGetLastError: function () { return err; },
    LMSGetErrorString: function (c) { return c === '391' ? 'General commit failure' : c === '101' ? 'General exception' : ''; },
    LMSGetDiagnostic: function () { return ''; }
  };
})();
</script>
<iframe id="sco" title="Course content" src="${'${SRC}'}" allowfullscreen style="width:100vw;height:100vh;border:0"></iframe>
<script>document.getElementById('sco').src = new URLSearchParams(location.search).get('src') || '/index.html';</script>
</body></html>`;
}

export function lmsRoutes(url: URL): { body: string | Buffer; type: string } | null {
  if (url.pathname === '/__lms/harness.html') return { body: harnessHtml(), type: 'text/html; charset=utf-8' };
  if (url.pathname === '/__lms/scorm12.js') return { body: readFileSync(join(process.cwd(), 'node_modules/scorm-again/dist/scorm12.js')), type: 'text/javascript' };
  return null;
}
