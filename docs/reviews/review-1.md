# Independent review – cycle 1 of 3

Reviewer: independent critic (did not build the software). Date: 2026-10-02. Commit reviewed: `0c32d74` (branch `claude/friendly-pasteur-etcaci`), rebuilt from source for this review.

## 1. Summary, scores and verdict

| Deliverable | Weighted score | Unresolved critical defects |
|---|---:|---:|
| **A. Authoring application** | **7.1 / 10** | 2 (A-01, A-02) |
| **B. Exported student package (SCORM 1.2)** | **8.2 / 10** | 0 (but see P-01, MAJOR) |

**Verdict: NOT SATISFACTORY.** Neither deliverable reaches 9.0, and the authoring application has two unresolved critical defects, both of which lose saved work:

- **A-01 (CRITICAL):** a backup that the app creates and reports as successful cannot be restored if any annotation has an empty label. The app allows and autosaves that state, and the restore then rejects the *whole* project.
- **A-02 (CRITICAL):** with the app open in two tabs, a stale tab silently overwrites work saved in the other tab, while both tabs keep showing "All changes saved".

Much of the product is genuinely good, and I confirmed it by running it, not just reading the docs:

- Annotation positions and default views in the exported package match authoring to full floating-point precision, including on nested, rotated and non-uniformly scaled nodes.
- The SCORM runtime behaves correctly against the independent `scorm-again` SCORM 1.2 implementation: zero rejected values, correct status transitions, resume, failure handling, and honest standalone messaging.
- The package is clean: valid XML manifest, every file listed, only the selected models, relative paths, CSP-enforced, zero off-origin requests.
- XSS payloads are inert in every field I tried.
- The UI is calm, consistent and responsive.

The package's main weakness is **P-01 (MAJOR)**: when the annotation list feature is disabled, an annotation is recorded as "viewed" (and sent to the LMS) without its description ever being shown. This contradicts the package's own definition of "viewed".

## 2. What I tested and how

**Environment.** Linux container, Node 22.22, Chromium at `/opt/pw-browsers/chromium` driven by Playwright 1.63 with software WebGL (SwiftShader). There was no GPU, no real LMS, no Safari/Firefox, no physical touch device and no screen reader.

**Build.** I ran `npm run build` myself. It succeeded with `tsc --noEmit` clean in 3.7 s. Outputs: app JS 1.40 MB (394 KB gzip, a single chunk) and player JS 1.07 MB (294 KB gzip). I served it with `npx vite preview --port 4273 --strictPort`.

**Fixtures.** I wrote my own generator using `@gltf-transform/core`, independent of `tests/fixtures`:

| Fixture | Purpose |
|---|---|
| `organ.gltf` + `organ data.bin` + `textures/a/diffuse.png` + `textures/b/diffuse.png` | Multi-file glTF; two *different* textures with the same file name in different folders |
| `textured-nested.glb` | Embedded 128 px texture; rotated parent; non-uniform scale; duplicate node names; an inner mesh hidden inside an outer shell |
| `dense-460k.glb` | 462,400 triangles, 12.4 MB |
| `verydense-1.6M.glb` | 1,638,400 triangles, 43.8 MB |
| `draco-lobed.glb` | Draco-compressed |
| Bad files | Empty GLB, random bytes, remote-URI glTF, glTF 1.0, no meshes, KTX2-required, invalid JSON, missing `.bin`, and a GLB with a valid header but a buffer view past the end of the binary chunk |

**Authoring journeys (my own Playwright scripts, persistent browser profiles).**

- *Import:* bad-file import; demo load; multi-select and folder (`webkitdirectory`) import of the multi-file glTF; textured, dense and very dense imports.
- *Annotations:* placing three annotations by clicking; editing label, description, category and link with XSS payloads; `javascript:` links; maximum-length and empty labels; reposition, undo, redo, delete with confirmation, and undo of delete.
- *Viewer:* rotate 180° by keyboard to check occlusion; "Markers behind"; selecting an occluded annotation from the list; hiding and isolating structures; "Add at centre" via keyboard; saving the default view with a hidden structure; reset; reload persistence.
- *Saving:* the `beforeunload` guard and Ctrl+S; backup, then restore into a fresh profile; two-tab concurrent editing.
- *Robustness:* reload in the middle of a 44 MB import; double-click on "Save as default view"; duplicate and delete with shared assets; category management with a hostile name.
- *Export:* pre-export checks; "Verify annotation positions"; two builds through the real UI. The first had a hostile title, intro and description, an SVG logo containing `<script>` with a hostile file name, a very light accent, and the rule "open all + required annotations", with 4 of 10 models. The second had the Draco model, all optional features off, and 2 models.
- *Quality:* responsive checks at 390 × 844, 820 × 1180 and 1280 × 800; axe-core (WCAG 2.0/2.1 A and AA) on the library, import dialog, export, help and workspace; keyboard focus order.

**Exported package (the fresh ZIPs, unzipped and served by `scripts/serve-package.ts` with the author's `tests/e2e/lmsHarness.ts` routes).**

- *Package hygiene:* manifest checked with `xmllint`; manifest file list compared with the actual files; external-reference scan; checked that only the selected models were included; byte comparison of shipped textures.
- *Standalone:* gallery, search, filters, the About panel, the annotation list and model markers, self-study mode, structures, full screen, back navigation, request-origin capture, viewer disposal, and standalone resume.
- *`scorm-again`:* full completion; partial exit then resume; content-hash mismatch; corrupt `suspend_data`; relaunch of an already completed attempt.
- *Mock LMS:* `none`, `initfail`, `throw`, `commitfail` with recovery, and browse mode.
- *Fidelity:* default view and world positions compared with the authoring values; aspect compensation at phone width.
- *Other:* Draco model under the package CSP; "viewed" semantics with the list disabled; touch taps on markers at phone and tablet sizes; axe on the gallery and model view; keyboard tab order; frame rate with a small vs. dense model (software GL only).

**Author's own suites (run by me).**

- `npm test`: **80/80 passed** (8 files, 4.5 s).
- `npx playwright test` (all specs except `sample.spec.ts`, which rewrites a tracked file), run from my scratch directory against my server: **31/32 passed in 5.5 min**. `01 › duplicates and deletes models with confirmation` failed with a strict-mode violation: two "Delete…" menu items existed because the previous Radix menu was still mounted. It **passed on a rerun** of spec 01 (11/11), so it is a timing-dependent flaky test.

**Could not test.** The following are not verified:

- Moodle, Canvas or SCORM Cloud.
- XSD validation of the manifest (schemas not available offline).
- Real-GPU performance: SwiftShader frame rates are only relative.
- Pinch and two-finger pan (only single taps were simulated).
- Safari and Firefox; screen readers; forced-colours mode.
- The display of the native `beforeunload` dialog (event-level only).
- The full-screen fallback in an iframe without `allowfullscreen`: headless Chromium granted native full screen even after I removed the attribute, so the fallback path was only code-reviewed.
- Storage-quota exhaustion; the 300 MB refusal (code-reviewed only).

Evidence (scripts, JSON results and 84 screenshots) is in `/tmp/claude-0/review1-scratch/`. File names below refer to that folder (`shots/…`, `out/…`). It is outside the repo and may not persist.

## 3. Scores with justification

### A. Authoring application

| Criterion | Weight | Score | Weighted |
|---|---:|---:|---:|
| Functional completeness and correctness | 30% | 6.5 | 1.95 |
| Usability and workflow clarity | 20% | 8.0 | 1.60 |
| Visual quality and consistency | 15% | 8.0 | 1.20 |
| Reliability, persistence and error handling | 15% | 5.0 | 0.75 |
| Accessibility and responsive behaviour | 10% | 8.0 | 0.80 |
| Performance and maintainability | 10% | 7.5 | 0.75 |
| **Overall** | | | **7.05 → 7.1** |

**Functional completeness and correctness – 6.5**

Almost every brief item exists and works.

- *Import and library:* GLB and glTF import with companion files. All 9 bad files are rejected with specific, readable messages (`out/a1.json`, `shots/a03`). Import progress is shown. Models can have multiple regions and systems (verified 2 regions + 3 systems, and 2 + 3 in the details dialog). Search and filters work, including counts and "selected only".
- *Annotations:* placement lands exactly where clicked (marker centre identical to the click point, `out/a3.json`). Edit, move, delete, undo and redo all work. Positions survive reload exactly.
- *Viewer:* occlusion works. At 180° all three markers are `occluded` and none are drawn, and selecting one from the list turns the camera so it is `visible`. Structure hide and isolate work, and annotations on hidden structures report `structure-hidden`.
- *Default view and thumbnail:* the default view and thumbnail are regenerated from the saved view, and respect hidden structures (`shots/a22`, `shots/a32`).
- *Other:* student preview, backup, the pre-export checks (an empty label blocks the build) and the export all work.

Correctness defects pull the score down:

- **A-01 (CRITICAL):** backups the app produces can be unrestorable.
- **A-02 (CRITICAL):** two tabs silently overwrite each other's saved work.
- **A-03 (MAJOR):** same-named companion textures are mapped to the wrong file, including in the folder workflow designed for this case, and the export then ships the wrong texture.

**Usability and workflow clarity – 8.0**

- Strengths: a clear empty state; a pre-export panel that gives a fix for every warning; "Add at centre" for keyboard users; a status line under the workspace title showing whether the current view has been saved as the default; delete confirmations that say what is lost; and a restore dialog that requires an explicit "I understand" for replace.
- Hiding or showing structures, or moving the camera, is not saved until "Save as default view", and is lost on navigation without any prompt. The workspace title still says "Default view saved" after structures have been changed (A-06).
- In the import dialog, a failed import leaves "Import 1 model" enabled. A 0-byte file is shown as "1 KB". The corrupt-GLB error is technical: "Invalid typed array length: 9".
- A rejected restore shows a raw schema path: `models.6.annotations.2.label: Too small…`.

**Visual quality and consistency – 8.0**

- Calm, consistent tokens, spacing and typography (`shots/a06`, `a14`, `a32`).
- The primary "Import a model" button on the empty state, which is the very first screen, has an invisible icon. `.empty-state svg { color: var(--accent) }` paints it teal on teal (`shots/a51`, A-12).
- The selected marker's label tooltip covers neighbouring markers. Marker 2 was hidden under label 1 (`shots/a14`, `shots/p17`).
- The completion-rule descriptions are set in heavy bold.
- Minor pluralisation error: "1 materials".

**Reliability, persistence and error handling – 5.0**

- Reload persistence is excellent: the camera and annotation world positions are bit-identical after reload.
- The save indicator and Ctrl+S work, and the `beforeunload` guard prevents default while state is dirty.
- But both critical defects fall under this criterion: the unrestorable backup (A-01) and the two-tab silent overwrite (A-02).
- A reload in the middle of an import leaves 2 orphaned assets, about 44 MB, in IndexedDB that nothing ever cleans up. No warning is shown while the import is running (A-04).
- Thumbnails and logos are deleted from storage before the record that replaces them is flushed (A-05, inferred from code).

**Accessibility and responsive behaviour – 8.0**

- axe found no violations on the library, import dialog, help or workspace. On the export page it found one *serious* issue: the scrollable `.issue-list` is not keyboard-focusable (A-09).
- Visible focus rings (`shots/a49`); labelled icon buttons; an arrow-key navigable annotation list.
- Practical alternatives to precise pointing: Add at centre, Move to centre, list selection, on-screen rotate and pan buttons.
- No horizontal scroll at 390 or 820 px on the library, workspace or export pages (`out/a9.json`).
- The DOM focus order reaches the bottom view controls *before* the annotation toolbar that sits visually at the top (A-10).

**Performance and maintainability – 7.5**

- Strengths: TypeScript typecheck is clean; clear module boundaries (`shared`, `viewer`, `storage`, `export`, `player`, `authoring`); 80 unit tests and 32 browser tests.
- Measured times (software GL): import of the 1.6M-triangle, 44 MB model in 5.7 s; opening it in about 7.5 s; building a 13.9 MB package in 6.9 s.
- No WebGL viewer leaks during in-app navigation (0/1 viewers alternating, `out/a10.json`).
- Weaknesses:
  - one 1.4 MB application chunk with no code splitting;
  - `eslint-disable` comments with no ESLint configured or installed;
  - `ViewerCore.ts` is 1,000 lines;
  - one flaky e2e test;
  - several tests are weaker than their titles (section 6).

### B. Exported student package

| Criterion | Weight | Score | Weighted |
|---|---:|---:|---:|
| Functional completeness and correctness | 30% | 8.0 | 2.40 |
| Usability and workflow clarity | 20% | 8.5 | 1.70 |
| Visual quality and consistency | 15% | 8.5 | 1.28 |
| Reliability, persistence and error handling | 15% | 8.0 | 1.20 |
| Accessibility and responsive behaviour | 10% | 8.0 | 0.80 |
| Performance and maintainability | 10% | 8.0 | 0.80 |
| **Overall** | | | **8.18 → 8.2** |

**Functional completeness and correctness – 8.0**

Verified on a freshly built ZIP:

- *Package contents:* `imsmanifest.xml` at the root and well-formed; every one of 16 files listed; only the 4 selected models out of 10; relative paths only.
- *Gallery and model view:* browse chips by region and system with counts; search, which also matches annotation labels; a thumbnail gallery; rotate, pan, zoom, reset and full screen; show and hide annotations; select from a marker or the list; Previous/Next; self-study with no name leaks in the list, markers or search; a structure list with hide and isolate; "Back to gallery" restores focus to the card.
- *Default view:* the camera is **identical** to the authored one, with position, target and quaternion equal to about 1e-16 (`out/p1.json` vs `out/a3.json`).
- *Phone width:* the camera backs off along the same direction (normalised direction equal to 3 decimal places), as documented.
- *Annotation positions:* world positions are **identical** to authoring, including on the rotated and scaled hierarchy.
- *Draco:* the Draco model decodes under the package CSP.

Defects:

- **P-01 (MAJOR):** "viewed" can be recorded without the description being shown.
- **A-03** propagates: the package ships two copies of the red texture and no blue one (`cmp` shows they are identical).
- **P-02 (MINOR):** a status gap after an LMS failure at launch.

**Usability and workflow clarity – 8.5**

- Intuitive gallery and model view.
- "Welcome back… Continue" on resume.
- A progress line such as "4 of 4 models opened · 10 of 10 annotations viewed" with a "Completed" chip.
- Per-card "Opened" and "2/3 viewed" badges.
- A "How to move the model" explainer.
- At 1280 × 800 with a long description, the list collapses to about one visible row while a detail is open (`shots/p04`). With short descriptions it shows 3 of 7 rows (`listHeight` 196 px). On a phone, reading a description scrolls the model out of view. Both are acceptable fallbacks, but not "without losing place" in every case (P-04).

**Visual quality and consistency – 8.5**

- Polished, clearly not the authoring dashboard (`shots/p01`, `p03`, `p08`).
- Accent theming works even with an extreme yellow, because the text ink is darkened automatically.
- The selected label covers adjacent markers (P-05).
- One chip falls just below 4.5:1 contrast with a very light accent (P-06).

**Reliability, persistence and error handling – 8.0**

Against `scorm-again`:

- On first launch `incomplete` is written and committed immediately.
- Status stays `incomplete` with all models opened but only 1 of 10 annotations viewed.
- `completed` is written only when 10/10 were viewed.
- `session_time` has the format `0000:00:31.16`. There were **zero rejected values**.
- `LMSFinish` is called on unload, and `exit=suspend` is written for an incomplete attempt.
- Resume restores "1 of 4 opened · 2 of 10 viewed" and "Continue" opens the right model.
- A content-hash mismatch and corrupt `suspend_data` are both handled without errors.
- Relaunching a completed attempt keeps it `completed`.

Against the mock LMS:

- No API gives an honest "Standalone mode… not sent to an LMS".
- `initfail` and `throw` give "Course tracking unavailable", with a clear notice.
- `commitfail` gives "Course not reachable… retrying" and recovers after the 15 s retry.
- Browse mode writes nothing.

Deductions:

- P-02: `lesson_status` is never re-sent after recovery.
- P-03: the hash-mismatch message understates what was lost.
- P-07: the local mirror is never used for resume in LMS mode.

**Accessibility and responsive behaviour – 8.0**

- axe found no violations on the gallery. On the model view it found 1 serious `color-contrast` issue: 4.45:1 on `.chip--accent` with the light accent.
- A skip link, a 3 px focus outline everywhere, a keyboard-operable canvas (arrow keys, +/−, 0), Enter on a card opens the model and focuses the H1, and touch taps on markers work at 390 and 820 px.
- No horizontal scroll at 390, 820 or 1180 px.
- Markers are not in the tab order; the list is the keyboard alternative, which is acceptable.
- Toggle buttons change their label *and* use `aria-pressed` ("Hide annotations" with pressed=true), which is confusing for screen-reader users (P-08).

**Performance and maintainability – 8.0**

- Load times: 0.2–2.8 s per model (the 460k model took 2.8 s).
- Viewer instances drop to 0 after "Back to gallery".
- Frame rate in SwiftShader: Heart 9.4 fps, 460k model 3.2 fps. These are only relative figures with no GPU.
- The player is a single 1.07 MB IIFE with no streaming or partial loading. It is deterministic: the shipped `player.js` hash equals `dist/player/player.js` and the hash in the repo's `sample/` ZIP.

## 4. Defect list

Severity: CRITICAL / MAJOR / MINOR. "Verified" means I reproduced it; "inferred" means from code reading only.

### Authoring application

**A-01 — CRITICAL — A backup the app creates successfully cannot be restored (all models lost from that backup).** *Verified.*

- Steps:
  1. Open any model and add an annotation.
  2. Clear its Label field. The app shows "Enter a short label." but autosaves it: the header shows "All changes saved".
  3. Choose Backup → Download project backup. The toast reads "Backup downloaded: 9 models, 61.1 MB. Keep it somewhere safe."
  4. In a fresh browser profile, choose Backup → Restore and select the file.
- Expected: the project is restored, or the backup is refused or repaired at creation time.
- Actual: "The backup contents are invalid: models.6.annotations.2.label: Too small: expected string to have >=1 characters". "Add to project" stays disabled, so none of the 9 models can be recovered.
- Cause: `annotationSchema.label` is `min(1)` (`src/shared/schema.ts`), but the editor allows `''` and `createBackup` never validates against the schema.
- The same class of mismatch exists for link URLs over 2,000 characters (the URL input has no limit) and glTF node names over 300 characters (inferred).
- Evidence: `out/a5.json`, `shots/a28-restore-dialog.png`, `out/backup-with-empty-label.zip`.

**A-02 — CRITICAL — Two open tabs silently overwrite each other's saved work.** *Verified.*

- Steps:
  1. Open the app in tab 1 and tab 2.
  2. In tab 1, open "Organ via folder", add an annotation and wait for "All changes saved".
  3. In tab 2, which was loaded earlier, open ⋯ → Edit details on the same model, change the description and save.
  4. Open a third tab.
- Expected: tab 1's annotation is kept, or a conflict or "open elsewhere" warning is shown.
- Actual: the stored record has the tab 2 description and **0 annotations**. Tab 1 still displays the annotation and "All changes saved".
- Ctrl-clicking the header's Library, Export or Help links naturally opens a second instance.
- Cause: the whole-record `put` of stale in-memory copies (`store.flush`), with no revision check, Web Locks or BroadcastChannel.
- Evidence: `out/a7.json`.

**A-03 — MAJOR — Companion files with the same name in different folders are mapped to the wrong file, silently, including in the folder-upload workflow.** *Verified.*

- Steps: import `organ.gltf` with `organ data.bin` and two different `diffuse.png` files from `textures/a/` and `textures/b/`, either by multi-select or with "Choose a folder…".
- Expected: the right lobe uses the blue texture, or the dialog reports the ambiguity.
- Actual: both lobes are red. The exported package contains `diffuse.png` and `diffuse-2.png`, which are byte-identical (`cmp` → identical, both equal to `textures/a/diffuse.png`). The blue texture is missing from the package.
- With multi-select, the dialog even claims the second file is "Not referenced by any selected .gltf file".
- Cause: `planImports` resolves `matched[uri]` (a *file name*) back to an input with `pool.find(p => p.file.name === name)`, discarding the path match.
- Evidence: `shots/a11-library-all.png`, `out/a2.json`, `pkg/models/organ-via-folder-*/`.

**A-04 — MINOR — An interrupted import leaves orphaned blobs forever, with no warning while it runs.** *Verified.*

- Steps: import the 44 MB GLB and reload the page during "Saving…".
- Result: models stay at 10, but assets go from 27 to 29 with **2 orphans** and no clean-up sweep at start-up.
- `hasUnsavedWork()` ignores a running import, so no `beforeunload` prompt appears.
- Evidence: `out/a10.json`.

**A-05 — MINOR — Old thumbnail and logo blobs are deleted before the record referencing the new one is persisted.** *Inferred.*

- In `regenerateThumbnail`, `db.deleteAssets([old])` runs immediately after `updateModel`, which only *schedules* a flush 450 ms later. `ExportPage.uploadLogo` and `removeLogo` do the same.
- A reload or crash in that window leaves the stored record pointing at a deleted asset. Export can regenerate a thumbnail, but a deleted logo is lost.

**A-06 — MINOR — Unsaved view state is not indicated or guarded.** *Verified.*

- After "Show all" changes structure visibility, the workspace title still says "Default view saved".
- Leaving the model discards the change without a prompt. The only hint is a callout on the Appearance tab.

**A-07 — MINOR — Viewer camera limits and clipping (shared with the player).** *Verified, with the clip-plane amounts computed.*

- After panning with Shift+arrows, then rotating 90°, the far plane is about 61 units. That is computed from the panned target, not the model bounds, so it is less than the distance to the model's far side (about 62.6). The back of the model is clipped (`shots/a44`).
- At maximum zoom, `minDistance = 0.04 × radius` puts the camera inside the model (`shots/a45`).

**A-08 — MINOR — Rich-text parser glitches.** *Verified.*

- `window.__pwned=1 … window.__pwned` renders an `<em>` across the two underscores.
- A bare URL inside literal HTML text is auto-linked.
- Labels are not trimmed: `" (inner bone)"` is exported with a leading space.
- None of these are security issues: all payloads stayed inert.

**A-09 — MINOR — Export page: the issue list is a scrollable region that cannot be focused by keyboard.** axe reports `scrollable-region-focusable` as *serious*. *Verified.*

**A-10 — MINOR — Workspace focus order differs from the visual order.** Tab goes to the view controls (bottom of the viewport), then the annotation toolbar (top). *Verified.*

**A-11 — MINOR — Import dialog details.** *Verified.*

- A 0-byte file is shown as "1 KB".
- After a failed import, "Import 1 model" stays enabled.
- The corrupt-GLB message exposes "Invalid typed array length: 9".
- With many rows, the footer buttons are below the fold.
- The over-1.5-million-triangle warning appears only in Info and the pre-export checks, not at import.

**A-12 — MINOR — The empty-state primary button's icon is invisible** (accent on accent). *Verified.* Evidence: `shots/a51-empty-import-button.png`.

**A-13 — MINOR — A link field showing invalid text keeps the previous valid URL in storage**, so what is displayed differs from what is stored. *Inferred* from `commitLink`.

### Student package

**P-01 — MAJOR — "Viewed" is recorded without the label or description being shown when the annotation list is disabled.** *Verified.*

- Steps:
  1. Export with "Searchable annotation list" unticked and the rule "open every model and view every required annotation".
  2. Open a model; the About tab is active.
  3. Click a marker.
- Expected: the information panel shows the annotation and only then counts it. That is the definition printed in the export wizard and Help: "when its label and description were shown in the information panel".
- Actual: the active tab stays "About" and `annotation-detail` is not visible. The header nevertheless shows "1 of 9 annotations viewed" and `suspend_data` sent to `scorm-again` is `…|0:1`.
- Learners can complete the package by clicking markers without reading anything.
- Cause: `ModelView.select` switches tab only when `f.annotationList !== false`, but the effect that records "viewed" runs on selection alone.
- Evidence: `out/p3.json`, `shots/p17`.

**P-02 — MINOR — After an LMS failure at launch, `lesson_status=incomplete` is never re-sent.** *Verified.*

- Run `mode=commitfail` (failing from the start), open a model, then let the LMS recover.
- The final LMS data is `cmi.core.lesson_status: "not attempted"`, with valid `suspend_data` and session time.
- Status only changes when the learner reaches completion. Cause: the initial write is attempted once in `startLms`.
- The author's test starts this scenario with a healthy LMS (`failnow=0`) and so misses it.
- Evidence: `out/p2.json` (`commitfail_after`).

**P-03 — MINOR — The content-update message understates the reset.** *Verified.*

- On a content-hash mismatch the learner sees "your earlier annotation progress could not be restored". In fact *all* progress, including opened models, is reset: the result was "0 of 4 models opened".
- `KNOWN-LIMITATIONS.md` says the same ("saved annotation progress is discarded").
- Because the hash includes model titles, renaming a model and re-uploading resets everyone's progress.

**P-04 — MINOR — The list is cramped while reading.**

- At 1280 × 800 with a long description, about 1 list row is visible beside the open detail (`shots/p04`).
- With short descriptions, 3 of 7 rows are visible (196 px).
- On a phone, the model scrolls out of view while reading.

**P-05 — MINOR — Crowding: the selected marker's label overlaps nearby markers.** The selected marker is excluded from clustering, but its label is not collision-checked (`shots/p17`, `shots/a14`). *Verified.*

**P-06 — MINOR — Contrast below 4.5:1 for the accent chip with a very light accent.** axe: 4.45:1 (`#847508` on `#fefbe7`), although the wizard reports "12.3:1". *Verified.*

**P-07 — MINOR — In LMS mode the local-storage mirror is written but never read on relaunch**, so the notice "Your progress is kept in this browser" overstates what happens if the LMS lost the data. *Inferred* from `tracker.ts`.

**P-08 — MINOR — Toggle buttons both change their label and set `aria-pressed`**: "Hide annotations" with `aria-pressed=true`, and the same pattern for "Markers behind". Screen readers announce contradictory state. *Verified* in the DOM.

## 5. Requirement checklist against the brief

Status: ✔ met · ◐ partly met · ✘ not met.

### Authoring – model library

| Requirement | Status | Evidence |
|---|---|---|
| Title, description, thumbnail | ✔ | Cards and details dialog |
| Multiple regions and systems per model | ✔ | 2 + 3 at import, 2 + 3 in details (`out/a2`, `a6`) |
| Search and filters by title, region and system | ✔ | Thorax → 3/9, thorax + "heart" → 1/9, selected-only → 4/9 |
| Create, edit, duplicate and delete with confirmation | ✔ | Duplicate shares files; deleting the copy kept the original's files (`out/a11`) |
| Visible selection for export | ✔ | Checkbox, counts, nav badge |
| Editable starting categories; not forced into one | ✔ | Add, rename, delete, restore; "Uncategorised" allowed |

### Authoring – import and storage

| Requirement | Status | Evidence |
|---|---|---|
| GLB and glTF | ✔ | |
| Other formats documented; no non-functional options | ✔ | OBJ, FBX and others explained |
| Multiple meshes, materials and textures | ◐ | Works, except same-named textures (A-03) |
| Companion workflow with missing-dependency report | ◐ | Missing files reported clearly; ambiguous names mis-mapped (A-03) |
| Validation and understandable errors | ✔ | 9/9 bad files explained; one technical message (A-11) |
| Import progress | ✔ | |
| Sensible initial framing | ✔ | |
| Model info including file size | ✔ | |
| Large-asset warnings | ◐ | Size warning at import; triangle warning only after import (A-11) |
| Persistent storage of models, annotations, metadata and view settings | ✔ | Reload is bit-identical |
| Refresh or restart must not silently lose work | ◐ | Reload fine; two tabs lose saved work (A-02); interrupted import leaves orphans (A-04) |
| Backup and restore | ◐ | Works for valid data; backups can be unrestorable (A-01) |
| Storage architecture and limits explained | ✔ | Help, README, ARCHITECTURE, usage in the Backup menu |

### Authoring – 3D viewer

| Requirement | Status | Evidence |
|---|---|---|
| Rotate, zoom and pan with mouse and touch | ◐ | Mouse and keyboard verified; touch taps verified; pinch and two-finger pan not tested |
| Reset to saved default | ✔ | Exact |
| Camera limits and clipping | ◐ | A-07 |
| Responsive resize and full screen | ✔ | |
| Background and lighting | ✔ | |
| Authoring separate from student preview | ✔ | Banner; 0 authoring controls (`shots/a47`) |
| Default view saves position, target, zoom and orientation | ✔ | |
| Thumbnail generated from the saved view | ✔ | |
| Package opens in the same view | ✔ | Identical camera |
| Multi-mesh structure list with toggles and isolate; no implied segmentation | ✔ | |

### Authoring – annotations

| Requirement | Status | Evidence |
|---|---|---|
| Click the surface to place a marker | ✔ | Exact to the click point |
| Label, description, category and link fields | ✔ | |
| Edit, reposition, delete | ✔ | |
| Positions relative to the mesh; survive view changes, save, reload and export | ✔ | Identical world positions, nested and scaled nodes included |
| Marker click opens the panel; list selection highlights the marker | ✔ | |
| Show and hide | ✔ | |
| Markers behind geometry handled deliberately | ✔ | Occluded markers not drawn; ghosts on request; turn-to |
| Crowding without overlapping text | ◐ | Clusters exist; the selected label overlaps neighbours (P-05) |
| Readable formatting; markup safe | ✔ | Minor parser quirks (A-08) |

### Authoring – workflow

| Requirement | Status | Evidence |
|---|---|---|
| Save status and unsaved-change warnings | ◐ | Works; false "All changes saved" in A-02; unsaved view state not flagged (A-06) |
| Undo and redo for create, move and delete | ✔ | |
| Student preview | ✔ | |
| Empty states, validation, recoverable errors | ✔ | |
| Pre-export check | ✔ | Empty label blocks the build; deep anchor check |

### Package – student experience

| Requirement | Status | Evidence |
|---|---|---|
| Polished, not the authoring UI | ✔ | |
| Browse by region and system | ✔ | |
| Search | ✔ | |
| Thumbnail gallery | ✔ | |
| Read descriptions | ✔ | |
| Rotate, pan, zoom, reset, full screen | ✔ | |
| Show and hide annotations | ✔ | |
| Select from the model or the list | ✔ | |
| Read without losing place | ◐ | P-04 |
| Easy return to the gallery | ✔ | Focus restored |
| Desktop, tablet and small-screen layouts | ✔ | |
| No authoring controls | ✔ | |
| Self-study mode | ✔ | |

### Package – export workflow

| Requirement | Status | Evidence |
|---|---|---|
| Choose models; title, description, intro; logo and accent; feature toggles | ✔ | |
| Completion rule with a precise definition of "viewed" | ◐ | Definition stated precisely, but not honoured with the list disabled (P-01) |

### Package – SCORM

| Requirement | Status | Evidence |
|---|---|---|
| Genuine ZIP, SCORM 1.2 | ✔ | |
| Manifest, launch page, scripts, styles, models, textures, thumbnails | ✔ | Wrong texture in the A-03 case |
| Only selected content | ✔ | 4 of 10 models; Draco decoder only when needed |
| Relative paths | ✔ | |
| No link to the authoring app; no CDN | ✔ | 0 foreign requests; CSP `default-src 'none'` |
| Initialise, commit, terminate | ✔ | scorm-again |
| Completion by rule | ◐ | P-01 |
| Session time and resume | ✔ | |
| LMS failures handled gracefully | ✔ | With P-02 |
| Standalone mode makes no misleading claims | ✔ | |
| Small LMS data; storage explained | ✔ | Doc number wrong, see section 6 |
| Moodle and Canvas requirements documented; verified vs unverified distinguished | ◐ | Honest documentation; no real LMS (expected); the results table promised in TESTING.md is missing |

### Engineering

| Requirement | Status | Evidence |
|---|---|---|
| Calm, consistent design | ✔ | |
| Keyboard access, focus, contrast, labels | ◐ | A-09, A-10, P-06, P-08 |
| Practical alternatives to precise pointing | ✔ | |
| Validation of uploads and project data | ◐ | Validation stricter than what the app itself produces (A-01) |
| Safe descriptions and links | ✔ | Every XSS payload inert; `javascript:` and `data:` links refused; SVG logo shown via `<img>` |
| Upload and resource limits | ✔ | `maxCompanionFiles` is not enforced at import (inferred) |
| 3D resources disposed | ✔ | Verified |
| No secrets or external services; deployment model explicit | ✔ | |
| Licensed demo assets, clearly identified | ✔ | CC0, flagged "Demonstration model" in the player |

### Tests and deliverables

| Requirement | Status | Evidence |
|---|---|---|
| Unit tests for data and packaging | ✔ | 80/80 |
| Browser tests for main journeys | ✔ | 31/32 plus 1 flaky |
| Exported artefact tested | ✔ | |
| Source, setup, dependencies, sample export, limitations, data structures and extension guide | ✔ | |
| Test results delivered | ◐ | See section 6 |

Minimum verification list 1–10: each item was reproduced by me in my own scripts, with the gaps noted above (items 5, 7 and 10 partly undermined by A-01, A-02, A-03 and P-02).

## 6. Unverified or overstated claims, and test-quality problems

- **Missing test results.** `docs/TESTING.md` says "See the table at the end of this file (updated after the final run)", but no results table exists. The only results file in the repo, `test-results/e2e-results.json`, records a single test (`sample.spec.ts`). The claim that the full suite passes was therefore not evidenced in the deliverable. My own run: 31/32 passed, with 1 flaky.
- **Wrong `suspend_data` figure.** `docs/LMS-NOTES.md` says "a package with 20 models and 200 annotations needs well under 100 characters". The real `encodeProgress` gives **138** characters. This is still far below 4096, but the stated number is wrong.
- **Progress loss understated.** `KNOWN-LIMITATIONS.md` and the player message say only *annotation* progress is discarded on a content change. In fact all progress is discarded (P-03).
- **Contrast claim.** The export wizard says "Text on the accent is set to dark (12.3:1 contrast)", yet the player's accent chips measure 4.45:1 for that accent (P-06).
- **Local fallback overstated.** The LMS-failure notice "Your progress is kept in this browser" is true only for the current session in LMS mode (P-07).
- **Tautological assertion.** `tests/e2e/02-package.spec.ts` test 10b is labelled "Self-study: annotations only count once revealed". It toggles self-study and then asserts on a `suspend_data` string captured *before* the toggle. Nothing about concealment is tested there.
- **404s hidden.** Test 8 filters console errors with `/favicon|404/`, so a missing texture or other asset returning 404 would not fail the test.
- **Healthy-start commit-failure test.** The commit-failure test starts with a healthy LMS (`failnow=0`) and so cannot catch P-02.
- **Skipped manifest check.** The unit and e2e manifest checks skip `xmllint` silently if it is not installed (`if (!r.error)`).
- **Flaky test.** `01 › duplicates and deletes models with confirmation` is flaky: it failed under load and passed on rerun.
- **Untested data states.** No test creates a backup from data in states the UI permits (A-01), uses two tabs (A-02), uses ambiguous companion names (A-03), or exports with optional features disabled (P-01). All the browser tests exercise the all-features-on configuration.
- **Honesty about LMS testing is good.** README, LMS-NOTES, Help and the export result all state plainly that no real LMS was tested. I found no false claim of Moodle or Canvas testing.

## 7. Prioritised fixes

1. **A-01 – make backups always restorable.**
   - Never persist an invalid label: fall back to "Annotation n" on blur, or block leaving the field.
   - Validate with `backupSchema` *when creating* a backup and repair or refuse with a clear message.
   - Make restore tolerant: repair cosmetic violations with warnings instead of rejecting the whole project.
   - Add a property-style test that every state the editor can save round-trips through backup and restore.
   - Align every UI `maxLength` with the schema (link URL, node names).
2. **A-02 – multi-tab safety.** Use a single-writer lock (Web Locks or BroadcastChannel heartbeat) with an "open in another tab" banner, or per-record revision checks before `put`, refusing and reloading on conflict. Never show "All changes saved" for data that has been overwritten.
3. **P-01 – honour the "viewed" definition.** When a marker is selected, always make the detail panel visible: switch to the annotations tab even if the list is disabled, or render the detail elsewhere. Record "viewed" only once the detail element is actually rendered. Add an e2e test with features disabled.
4. **A-03 – companion matching.**
   - Keep the matched `ImportInput` object instead of re-finding it by name.
   - When names are ambiguous and no paths are available, report "ambiguous: N files named diffuse.png" instead of guessing.
   - Fix the false "not referenced" message.
5. **P-02 – status recovery.** Track whether `lesson_status=incomplete` was accepted (like `completionWritten`) and re-send it in `save()` until it is.
6. **A-04 / A-05 – storage hygiene.** Sweep orphaned assets at start-up, guard `beforeunload` while an import is running, and delete replaced thumbnails and logos only after the referencing record has been flushed.
7. **A-07 – viewer clipping and limits.** Derive near and far planes from the camera's distance to the model's bounding sphere, not the target. Raise `minDistance`, or stop the camera at the surface.
8. **UI polish.**
   - Empty-state icon colour (A-12).
   - Collision handling for the selected label (P-05).
   - Minimum list height in the player (P-04).
   - Contrast for the accent chip (P-06).
   - Focusable export issue list (A-09).
   - Focus order in the workspace (A-10).
   - A fixed label with `aria-pressed`, or a changing label without it (P-08).
   - Import-dialog details (A-11).
   - Indicate unsaved structure visibility (A-06).
9. **Docs and tests.**
   - Add the real results table to TESTING.md.
   - Correct the `suspend_data` size claim and the "annotation progress discarded" wording.
   - Fix the flaky duplicate/delete test and the tautological assertion in test 10b.
   - Stop filtering `/404/` console errors.
   - Fail, rather than skip, when `xmllint` is missing.
