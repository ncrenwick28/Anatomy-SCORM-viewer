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

Recorded after the fixes for independent review 2 (build of commit `39200f1`):

| Suite | Result |
|---|---|
| Type-check (`npm run typecheck`) | clean |
| Unit tests (`npm test`) | **98 passed** of 98 (8 files) |
| Browser tests (`npx playwright test`, single worker, software WebGL) | **44 passed**, 1 skipped (`sample.spec.ts`, which only runs for `npm run sample:export`), 0 failed — 10.0 minutes |
| axe-core (WCAG 2.0/2.1 A + AA) | no serious or critical violations on any screen scanned (library, import dialog, export with and without listed checks, help, workspace tabs, player gallery/model/annotations) |

`tests/e2e/04-review-fixes.spec.ts` holds a regression test for each defect the independent reviews found and that was fixed (A-01, A-02, A-03/A-22, A-21, A-23, P-01, P-02, P-21 and several smaller ones).

### Independent reviews (a separate critic sub-agent, fresh build and fresh export each time)

| Cycle | Authoring app | Exported package | Critical defects | Report |
|---|---:|---:|---:|---|
| Review 1 | 7.1 / 10 | 8.2 / 10 | 2 | `docs/reviews/review-1.md` |
| Review 2 (shortened, at the lecturer's request) | 6.1 / 10 | 7.8 / 10 | 1 (a regression introduced by the review-1 fix) | `docs/reviews/review-2.md` |

**Neither deliverable reached the 9/10 target in either review.** No third review was run (it was stopped at the requester's instruction after review 2). All defects reported in review 2 — including the critical one (false "changed in another tab" conflict after a reload) and the four major ones — were fixed afterwards and have regression tests, but **those fixes were not independently re-reviewed or re-scored**, so no score is claimed for the final build. Review 2 was deliberately shortened and lists what it did not test (mock-LMS failure modes, dense-model performance, Draco in a package, axe, keyboard-only passes, clip planes, orphan sweep).

## What is not verified
- Behaviour in Moodle, Canvas, SCORM Cloud or any other real LMS (see `docs/LMS-NOTES.md`).
- Manifest validity against the IMS/ADL XSD schemas (only well-formedness and structure were checked).
- Other browsers (Firefox, Safari), real GPUs, touch input, screen readers (only axe-core automated checks), forced-colours mode.
- The native browser "unsaved changes" dialog (verified at the `beforeunload` event level because headless Chromium does not show it).
- Very large models (>100 MB) and very large projects; performance was checked only on the small demonstration models and a 3-mesh fixture.
