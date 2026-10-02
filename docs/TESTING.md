# Testing

## Environment used for the results below
- Linux container, Node.js 22, Chromium 141 (headless) driven by Playwright 1.63, **software WebGL** (SwiftShader, `--use-angle=swiftshader`), one worker.
- No Moodle, Canvas or other real LMS, and no GPU, Safari, Firefox or physical touch device were available. **Those are untested.**
- Touch is covered only by code review (the OrbitControls touch mapping and pointer-event tap detection) and by the phone-width layout test; no touch input was simulated.

## How to run
```bash
npm test                 # unit tests (≈5 s)
npm run test:e2e         # builds, then runs the browser tests (≈6 minutes)
npm run test:all         # type-check + both
npm run sample:export    # rebuild sample/anatomy-demo-package-scorm12.zip through the real UI
```
Reports: `test-results/e2e-results.json`; traces for failures in `test-results/artifacts/`. Accessibility results: `test-results/e2e-files/axe-results.json`.

## Automated unit tests (Vitest) – `tests/unit`
| File | Covers |
|---|---|
| `richtext.test.ts` | Safe description format: paragraphs, lists, bold/italic, links; `javascript:`/`data:` URLs rejected; raw HTML stays literal text |
| `completion.test.ts` | Completion rules (launch / open all / open all + required annotations), idempotent progress updates, compact `suspend_data` codec incl. 4096-character guard and stale-content handling |
| `gltfInspect.test.ts` | GLB header validation (bad magic, version, truncation), glTF JSON, dependency discovery, companion matching, safe file names, URI rewriting, refusal of remote URIs and KTX2-required models |
| `color.test.ts` | WCAG contrast and accent handling |
| `storage.test.ts` | IndexedDB store (via fake-indexeddb): persistence across reopen, orphan-asset clean-up, shared assets; backup → restore round trip (replace and merge), invalid/corrupt/unsafe backups rejected without changing data |
| `importer.test.ts` | Valid GLB, truncated/non-GLB/empty files, unsupported formats explained, missing companions reported then resolved, flat safe names, large-model warning and hard limit |
| `export.test.ts` | Package builder: manifest at root, every listed file present and nothing unlisted, relative paths only, only selected models, `content.js` round trip, reproducibility, failure modes; XML escaping and well-formedness (`xmllint`); launch page CSP; pre-export checks |
| `tracker.test.ts` | SCORM 1.2 discovery (parent/opener/cross-origin), time format, **against `scorm-again`**: first launch → incomplete, completion by each rule, valid values, resume, no downgrade, content-hash mismatch, single termination, browse mode; failure handling: failing writes with recovery, failed initialise, an LMS that throws on every call, standalone mode |

## Browser tests (Playwright) – `tests/e2e`
They drive the built application and **the exported ZIP itself** (unzipped and served over HTTP, then hosted in an iframe beneath a mock LMS).

| Brief item | Test(s) |
|---|---|
| 1. Import a supported model | `01` GLB import with progress, glTF + companions workflow (missing files reported, then supplied), invalid/truncated/non-model files and unsupported formats explained; `03` Draco-compressed import |
| 2. Assign multiple regions and systems | `01` import dialog and details dialog (2 regions, 3 systems), validation, discard warning |
| 3. Create, edit, move, delete annotations | `01` place by click, edit label/description/category/link (unsafe link rejected), keyboard alternative, reposition, delete with confirmation, undo/redo; `03` clustering, occlusion |
| 4. Save a default view and thumbnail | `01` camera + appearance saved, thumbnail asset replaced, reset returns to it |
| 5. Reload and persistence | `01` reload on the workspace route and library; `03` failing storage writes reported, retried and recovered; unsaved-work prompt |
| 6. Filter and select for export | `01` region/system/search filters, selection, "selected only" filter, export list |
| 7. Export a valid package containing only selected content | `02` builds through the UI with logo/accent/intro/rule; ZIP inspected (manifest, listed files, only the 2 chosen models, no remote references, size); `03` Draco decoder shipped only when needed |
| 8. Open the exported package and test the student UI | `02` gallery, branding, search, region/system filters, model view, list ⇄ marker selection, show/hide, self-study conceal/reveal, structure list, reset, back, no external requests, no console errors |
| 9. Annotations and default views match authoring | `02` camera target/up/direction/fov identical, distance differs only by the documented aspect compensation, every annotation's world position identical |
| 10. Completion, resume, LMS failure | `02` (with `scorm-again` and the mock LMS): completion by rule, nothing completes early, valid values, `suspend_data` ≤ 4096, resume with "Welcome back", no API → standalone claims, `LMSInitialize` failure, failing writes then recovery, LMS that throws |
| Regression tests for review findings | `04`: restorable backups, two-tab conflicts, "viewed" with the list switched off, same-named textures in folders, `incomplete` re-sent after a failed launch, orphan sweep, saved-view indicator and focus order, axe on a populated export page, corrupt-model message |
| Other requirements | `03`: markers hidden behind geometry; structure hide/isolate/persist; keyboard control of the viewer and list; no leaked viewers after leaving a model; student preview separate from authoring; backup/restore into a fresh browser profile; responsive layouts (390/820/1280 px, no horizontal scroll); **axe-core** (WCAG 2.0/2.1 A and AA) on library, import dialog, export, help, workspace tabs, player gallery/model/annotations |

## Results

Recorded after the fixes for independent review 1 (build of commit `66c821c`):

| Suite | Result |
|---|---|
| Type-check (`npm run typecheck`) | clean |
| Unit tests (`npm test`) | **94 passed** of 94 (8 files) |
| Browser tests (`npx playwright test`, single worker, software WebGL) | **41 passed**, 1 skipped (`sample.spec.ts`, which only runs for `npm run sample:export`), 0 failed — 8.8 minutes |
| axe-core (WCAG 2.0/2.1 A + AA) | no violations of any impact on any screen scanned; the export page was also scanned with check results listed |

Independent review 1 (`docs/reviews/review-1.md`) ran the suites itself and found 31/32 passing with one flaky test; that test and the findings it exposed are fixed (see the review file and `tests/e2e/04-review-fixes.spec.ts`, which holds a regression test for each fixed defect).

## What is not verified
- Behaviour in Moodle, Canvas, SCORM Cloud or any other real LMS (see `docs/LMS-NOTES.md`).
- Manifest validity against the IMS/ADL XSD schemas (only well-formedness and structure were checked).
- Other browsers (Firefox, Safari), real GPUs, touch input, screen readers (only axe-core automated checks), forced-colours mode.
- The native browser "unsaved changes" dialog (verified at the `beforeunload` event level because headless Chromium does not show it).
- Very large models (>100 MB) and very large projects; performance was checked only on the small demonstration models and a 3-mesh fixture.
