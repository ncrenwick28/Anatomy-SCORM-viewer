# Independent review – cycle 2 of 3

Reviewer: independent critic (did not build the software). Date: 2026-10-02. Commit reviewed: `3b0ff89` (branch `claude/friendly-pasteur-etcaci`), rebuilt from source by me.

This cycle was shortened at the coordinator's request. Section 2 lists exactly what I ran and what I did not get to. Every finding below is marked **verified** (I reproduced it) or **inferred** (from reading code only).

## 1. Summary, scores and verdict

| Deliverable | Weighted score | Unresolved critical defects |
|---|---:|---:|
| **A. Authoring application** | **6.1 / 10** | **1 (A-21, new, a regression from the A-02 fix)** |
| **B. Exported student package (SCORM 1.2)** | **7.8 / 10** | 0 (but see P-21, MAJOR) |

**Verdict: NOT SATISFACTORY.** Neither deliverable reaches 9.0, and the authoring application has a new critical defect.

**A-21 (CRITICAL, regression).** The revision check added for A-02 compares against a project revision that `ProjectStore.getProject()` never returns. As a result, in a **single tab**, after any reload or restart, the first project-level change triggers a false conflict:

- **Triggers:** ticking a model for export, deleting a model, changing a package setting, or editing categories. If the saved selection mentions a deleted model, it fires at start-up with no user action.
- **What the user sees:** a red banner says the project was changed in another tab, and saving stops.
- **Data loss:** all further work in the session is unsaved. The banner's highlighted primary button, "Load the latest version (discard changes made in this tab)", throws that work away. I reproduced this with an annotation.

What genuinely improved since review 1, all verified:

- **A-01 fixed.** Backups are repaired and restore.
- **P-01 fixed.** An annotation counts as viewed only after its detail is shown, even with the list off.
- **A-03 fixed for folder upload.** The right texture goes to each part and the package ships both.
- **A-12 fixed.** The empty-state icon is visible.
- **A-06 indicated.** The workspace title now says when the view differs from the saved default.

Strengths that still hold (verified on a fresh export):

- Annotation world positions and default cameras in the package are **bit-identical** to authoring (difference 0), including a rotated, non-uniformly scaled hierarchy with a hidden structure.
- The package is clean: CSP-confined, zero off-origin requests, and inert XSS.
- `scorm-again` accepts every value (0 rejected) and completion and resume work.

New major problems:

- **A-22:** A-03 reopened in the multi-select path.
- **A-23:** two-tab neighbours of A-02 create broken model records.
- **P-21:** the new "merge local progress" logic records **another learner's completion** on a shared computer.

## 2. What I tested and how, and what I did not test

**Environment.** Linux, Node 22.22, Chromium `/opt/pw-browsers/chromium` with SwiftShader, driven by Playwright from my own scripts. My scripts and evidence are in `/tmp/claude-0/review2-scratch/` (`out/*.json`, `shots/*.png`). That folder is outside the repo and may not persist. There was no real LMS, GPU, touch device or screen reader.

**Build and author tests.**

- `npm run build` (player, then `tsc --noEmit`, then app): succeeded in 3.9 s. Outputs: app JS 1,409 KB (397 KB gzip), player JS 1,075 KB.
- I served it with `vite preview --port 4373`.
- `npx vitest run`: **94/94 passed** (5.1 s).
- I did **not** run the author's Playwright suite this cycle.

**My own fixtures** (generated with `@gltf-transform/core`):

- a multi-file glTF with `organ data.bin`, plus `textures/a/diffuse.png` (red) and `textures/b/diffuse.png` (blue);
- a variant whose two textures are the same size;
- a folder holding two models, each with its own `textures/diffuse.png`;
- a glTF referencing `../shared/tex.png`;
- a textured GLB with a rotated parent, non-uniform scale, duplicate node names and an inner mesh;
- a 462k-triangle GLB (12.4 MB) and a Draco GLB;
- a GLB with HTML and 400-character node names;
- files with a Unicode name and a 200-character name;
- 8 bad files: empty, random bytes, glTF 1.0, invalid JSON, no meshes, remote URI, .txt and .obj.

**Authoring (verified in persistent browser profiles).**

- *Import:* bad-file messages; demo load; 6 imports with regions and systems.
- *Companion matching:* three-way test (simultaneous, two-step and folder).
- *Annotations:* placement by click; editing with XSS payloads; `javascript:` link refused; empty, whitespace and padded labels; move with undo and redo; delete with confirmation and undo.
- *Default view:* hiding a structure; "Save as default view"; reload persistence.
- *Crowding:* 29 annotations, with label-overlap measured.
- *Occlusion:* rotating 180°, then turn-to from the list; "Markers behind".
- *Library:* filters and search; selection.
- *Export:* hostile title, intro, description and SVG logo; light accent; "Verify annotation positions"; build.
- *Concurrency and backup:* the false-conflict scenarios; two-tab delete with stale edit or duplicate; backup with an injected empty label and an over-long link, restored into a second profile.

**Package (fresh ZIPs built through the UI, served by my own HTTP server and LMS stub).**

- *Hygiene:* `xmllint`; manifest list compared with the files; textures checked byte for byte; player hash compared; external-reference scan.
- *Standalone:* gallery, search, chips, intro and logo rendering; nested and Heart models; camera and world positions compared with authoring; marker selection; Next.
- *Features:* the structures tab; self-study (names, markers and search concealed; reveal counts); full screen; back-navigation focus; viewer disposal.
- *Quality:* axe on the gallery and model view; layouts at 390 and 820 px.
- *`scorm-again`:* a list-off export with "open all + required annotations"; completion; resume from `suspend_data`; a second learner on the same browser.

**Not tested this cycle.** None of these is verified by me:

- the mock-LMS failure modes (`initfail`, `throw`, `commitfail`, browse mode);
- dense-model frame rate or load time in the player;
- opening the Draco model inside the package (it was packaged correctly);
- axe and keyboard-only passes on the authoring screens (so A-09 and A-10 are not re-verified);
- the clip planes (A-07) and the rich-text fixes (A-08) visually;
- the orphan sweep (A-04);
- P-02 and P-04;
- touch gestures; the author's Playwright suite; any real LMS; XSD validation.

## 3. Scores

### A. Authoring application

| Criterion | Weight | Score | Weighted |
|---|---:|---:|---:|
| Functional completeness and correctness | 30% | 5.5 | 1.65 |
| Usability and workflow clarity | 20% | 6.5 | 1.30 |
| Visual quality and consistency | 15% | 8.0 | 1.20 |
| Reliability, persistence and error handling | 15% | 3.5 | 0.53 |
| Accessibility and responsive behaviour | 10% | 7.5 | 0.75 |
| Performance and maintainability | 10% | 7.0 | 0.70 |
| **Overall** | | | **6.1** (and capped by A-21) |

**Functional completeness and correctness – 5.5**

Working (verified):

- Placement lands exactly at the click point (marker centre 504.0 vs click 504.2 px). Move, undo, redo and delete restore identical coordinates.
- Persistence after a browser restart is exact: camera, quaternion, world positions and hidden structures all differ by 0.
- All 8 bad files are rejected with plain-English reasons.
- The folder import maps the red and blue textures correctly, and both ship in the package.
- Pre-export checks work, and so does the build: 14.1 MB, 24 files, 5.7 s.

Defects pulling the score down:

- **A-21 (CRITICAL):** saving breaks after every reload.
- **A-22 (MAJOR):** silently wrong textures in the realistic multi-select workflow.
- **A-23 (MAJOR):** broken model records from two-tab use.
- **A-24 (MINOR):** a false ambiguity rejects multi-model folders.

**Usability and workflow clarity – 6.5**

- Workflows are otherwise clear: good empty state, import dialog, pre-export panel with a fix for every warning, and Add at centre.
- In ordinary single-tab use, a reload followed by ticking a model shows a red "changed in another tab" banner. This happened twice during my normal export journey.
- The banner's primary action discards work.
- The ambiguity error tells users to "Use 'Choose a folder…'" when they already did.

**Visual quality and consistency – 8.0**

- Calm and consistent (`shots/a03`, `a10`, `a11`, `a30`), and the empty-state icon is now visible (`a01`).
- Very long titles are clipped on cards without an ellipsis (A-26).
- The selected label still covers up to 5 neighbouring markers in a crowded cluster (P-05, `shots/a20`).

**Reliability, persistence and error handling – 3.5**

- A-01 is fixed, and reload persistence is exact.
- A-21 means every reload re-arms a state in which nothing is saved. Following the primary button lost my annotation: 8 annotations in memory, 7 stored, 7 after clicking the button.
- With A-23, two tabs can create models whose files are gone, while the tab shows "All changes saved".
- Deletions are not broadcast to other tabs.

**Accessibility and responsive behaviour – 7.5**

- "Add at centre" works from the keyboard (focus + Enter), and toolbar buttons are labelled.
- The structure panel still announces "Hide Part, pressed" (P-08 remains there).
- Duplicate node names give two indistinguishable "Part" entries.
- No authoring axe run this cycle, so the score leans on review-1 evidence plus the author's axe test.

**Performance and maintainability – 7.0**

- `tsc` is clean, 94 unit tests pass, and the build takes 3.9 s.
- Importing the 462k-triangle GLB took 4.2 s.
- Weaknesses: a single 1.4 MB chunk; `ViewerCore.ts` is still 1,007 lines.
- Test gap: the storage unit test never round-trips `getProject()` into `commitChanges()`, and the e2e A-02 test never reloads before making a project change. That is exactly why A-21 shipped.

### B. Exported student package

| Criterion | Weight | Score | Weighted |
|---|---:|---:|---:|
| Functional completeness and correctness | 30% | 7.5 | 2.25 |
| Usability and workflow clarity | 20% | 8.5 | 1.70 |
| Visual quality and consistency | 15% | 8.5 | 1.28 |
| Reliability, persistence and error handling | 15% | 6.5 | 0.98 |
| Accessibility and responsive behaviour | 10% | 7.5 | 0.75 |
| Performance and maintainability | 10% | 8.0 | 0.80 |
| **Overall** | | | **7.8** |

**Functional completeness and correctness – 7.5**

Working (verified):

- *Package contents:* the manifest is well-formed, every file is listed, only the 6 selected models of 10 are included, all paths are relative, and the Draco decoder is included only when needed. The shipped `player.js` hash equals `dist/player/player.js`.
- *Fidelity:* camera position, target and direction match authoring with a difference of 0 (the nested model and the Heart). The hidden structure (`0/2`) is preserved, and annotation world positions are identical.
- *Viewed semantics:* with the list off, clicking a marker switches to the Annotations tab and shows the detail before counting it (P-01 fixed).
- *Self-study:* names are concealed in the list, the markers and search, and only a reveal counts.
- *SCORM:* `completed` is reached under `scorm-again` with 0 rejected values; resume works.

Defects:

- **P-21 (MAJOR):** a false completion can be recorded for a different learner.
- **P-22 (MINOR):** "3/2 viewed" on gallery cards.
- **A-22** propagates a wrong texture into packages.

**Usability and workflow clarity – 8.5**

- Clear gallery, chips with counts, search across annotation labels, and "Back to gallery" restores focus to the card.
- The progress line is accurate.
- The card counter can exceed its total (P-22).

**Visual quality and consistency – 8.5**

- Polished and distinct from the authoring tool (`shots/p01`, `p02`, `p04`); the light accent is handled.
- At 390 px, long unbroken words or URLs in the title or description overflow the page by 116 px (P-24, `shots/p07-phone-gallery`).

**Reliability, persistence and error handling – 6.5**

- Status transitions, resume and the honest standalone status line all work.
- But on a shared PC the local mirror is merged into another learner's attempt (P-21). Learner 2 got `lesson_status=completed` with `session_time 0000:00:00.00`, without opening anything.
- I did not re-test the mock-LMS failure modes this cycle.

**Accessibility and responsive behaviour – 7.5**

- axe on the gallery: 0 violations.
- axe on the model view: 1 *serious* `color-contrast` issue, 4.19:1 on the Structures tab trigger with the light accent (P-23).
- The structure toggles keep the contradictory `aria-pressed` pattern (P-08).
- No horizontal scroll on the model view at 390 or 820 px, nor on the gallery at 820 px; the gallery at 390 px overflows (P-24).

**Performance and maintainability – 8.0**

- After "Back to gallery", 0 viewer instances remain.
- The player is a deterministic 1.07 MB IIFE.
- Dense-model performance was not re-measured.

## 4. Defect list

### New and reopened (authoring)

**A-21 — CRITICAL — Single-tab false "changed in another tab" conflict after every reload; saving stops and the primary action discards work.** *Verified.* This is a regression from the A-02 fix.

Steps:

1. In a fresh profile, load the demonstration models (they save normally).
2. Reload the page.
3. Tick "Include in export" on any model. Deleting a model or typing a package title on the Export page triggers it the same way.

Expected: the change is saved.

Actual: within about 1 s the header shows "Not saved: changed in another tab" and a red banner appears (`shots/t01-after-reload-toggle.png`).

- The in-memory project `rev` is `null`, while the stored one is `rev-0o0c5z736g6y` (`out/t01.json`).
- It happens on every reload: three cycles out of three, and "Overwrite" clears it only until the next reload (`out/t03.json`).
- It fires at start-up with no action at all if the saved selection lists a deleted model (`out/t03.json` E).
- While in this state, workspace edits are not saved. I added an annotation and pressed Ctrl+S: 8 annotations in memory, 7 stored.
- Clicking the highlighted "Load the latest version (discard changes made in this tab)" leaves 7, so the annotation and the export selection are lost (`out/t02.json` C, `shots/t02c-workspace-conflict.png`).
- During my ordinary export journey it occurred twice (`out/t09.json`).

Cause: `ProjectStore.getProject()` (`src/storage/ProjectStore.ts` lines 99–104) rebuilds the project object without `rev`. So `knownProjectRev` is `undefined` after `init()`, `reload()` and `resolveConflict('reload')`, and `commitChanges` sees a mismatch with the stored `rev`.

Inferred side-effects of the conflict state:

- `regenerateThumbnail` still deletes the old thumbnail after a `flush()` that saved nothing, so the stored record points at a deleted file (A-05 regresses).
- Imports show "Imported 1 model." although the record is not saved.

**A-22 — MAJOR — Same-named companion files still map to the wrong texture in the multi-select workflow (A-03 reopened).** *Verified.*

Steps:

1. In Import, choose `organ.gltf` and `organ data.bin`. The dialog correctly reports "Missing 2 companion files: textures/a/diffuse.png, textures/b/diffuse.png".
2. With "Choose files…" (or "Add the missing files…"), add only `textures/a/diffuse.png`. Native pickers select within one folder, so this is the natural step.

Expected: `textures/b/diffuse.png` is still reported missing.

Actual:

- The dialog shows "3 companion files", no missing files, and "Import 1 model" is enabled (`shots/t05-organ-two-step.png`).
- The stored model has a single `diffuse.png` (the red one) used for both lobes. The blue texture is silently absent (`out/t05.json` B).

Variant with same-size files:

- Adding `textures/b/diffuse.png` after `a` silently *replaces* `a`, because `addFiles` de-duplicates by name and size.
- Both lobes then get blue (`out/t05.json` G).

Causes:

- The bare-name fallback in `matchCompanions` accepts one file for two distinct URIs.
- `ImportDialog.addFiles` drops an earlier file with the same name and size.

**A-23 — MAJOR — Two-tab neighbours of A-02 create broken model records.** *Verified* (`out/t04.json`).

- **Deletions are not broadcast.** After tab 2 deleted "Vertebral column", tab 1 showed no stale banner.
  - `removeModel` writes directly and broadcasts only after a later successful flush, which A-21 prevents.
- **"Overwrite" resurrects a deleted model with missing files.** Tab 1 edited the deleted model's details, got the conflict banner and chose "Overwrite with this tab's version".
  - The model was re-created with 1/1 model files and its thumbnail missing.
  - Opening it shows "The stored file … is missing". The banner gives no warning that this would happen.
- **A stale tab silently duplicates a deleted model.** Tab 1 deleted "Knee joint"; tab 2, with no banner, chose Duplicate.
  - The copy was saved with "All changes saved", and 1/1 of its files were missing.

**A-24 — MINOR — A folder holding several models, each with its own `textures/diffuse.png`, is rejected as ambiguous.** *Verified* (`shots/t05-twomodels-folder.png`).

- Both models fail with "2 selected files could be it (twomodels/modelB/textures/diffuse.png, twomodels/modelA/…)".
- The message advises using "Choose a folder…", which is what was used.
- Cause: path matching is a suffix match, not resolved relative to each `.gltf`'s own folder. The same suffix rule can also match a same-named file in a *different* folder when the right one is missing (inferred).

**A-25 / P-25 — MINOR — The structure panel still uses a changing label *and* `aria-pressed`.** *Verified.*

- Screen readers hear "Hide Part, pressed" and "Show Side lobe, not pressed", in both authoring and player. This is the remaining part of P-08.
- Duplicate node names give two indistinguishable "Part" rows; the mesh names "Shell" and "Inner bone" are not shown.

**A-26 — MINOR — A 120-character unbroken title is clipped on the library card** with no ellipsis, and the meta line is cut off ("No default vie"). *Verified* (`shots/a03-library-all.png`).

### New (package)

**P-21 — MAJOR — On a shared computer, the package merges another learner's local progress into a different learner's attempt and reports completion to the LMS.** *Verified* (`out/t12.json`, `shots/p11-learner2-shared-pc.png`).

Steps:

1. Learner 1 completes the package in browser X, with `scorm-again` as the LMS.
2. Learner 2, whose attempt is already in progress elsewhere (`entry=resume`, `lesson_status=incomplete`, a different `student_id`), launches the same package in browser X.

Expected: learner 2 sees only their own progress.

Actual:

- Learner 2 immediately sees "7 of 7 annotations viewed" and "Completed".
- The tracker writes `cmi.core.lesson_status=completed` and `cmi.suspend_data=a1|054ltv5|0|1|0:f7` to learner 2's record, with `session_time 0000:00:00.00`.

Cause: `tracker.readLocal()` uses the key `anatomy-scorm:<packageId>`, which is not scoped to `cmi.core.student_id` (or to the course or attempt). `startLms` then merges any matching local data whenever the attempt is a resume.

Related (inferred): two course activities that use the same package share the same key.

**P-22 — MINOR — The gallery card shows "3/2 viewed".** *Verified.* `Gallery.tsx` divides *all* viewed annotations, optional ones included, by the *required* count. The nested model has 2 required and 1 optional annotation, and viewing all three shows "3/2 viewed".

**P-23 — MINOR — Contrast below 4.5:1 with a light accent.** *Verified* (axe, serious): the selected Structures tab trigger measures 4.19:1 (`#7c7532` on `#eef2f5`) with accent `#f5e663`. The export wizard says "Text on the accent is set to dark (13.6:1 contrast)". This is a remaining part of P-06.

**P-24 — MINOR — Horizontal overflow at 390 px when the title or description contains a long unbroken word or URL.** *Verified*: the gallery is 116 px wider than the viewport (`shots/p07-phone-gallery.png`). The hero text needs `overflow-wrap: anywhere`.

### Still open from review 1 (re-verified)

- **P-05 — MINOR — Partly fixed.** The selected label covers 0–5 neighbouring markers in a crowded cluster (measured at 5 positions: 0, 1, 2, 0, 5; `out/t08.json`, `shots/a20`).
- **A-06 — MINOR — Partly fixed.** It is now indicated in the title ("View differs from the saved default…"), but leaving the workspace with an unsaved view still gives no prompt.

## 5. Status of review-1 findings

| ID | Status | Evidence |
|---|---|---|
| A-01 unrestorable backup | **Fixed** (verified) | Injected an empty label and a 2,100-character link; the backup toast reports "2 small text problems were tidied"; restore into a second profile succeeded, and the label became "Annotation 1" (`out/t12.json`). The editor now replaces empty or whitespace labels on blur and trims them (`out/t07.json`). |
| A-02 two-tab overwrite | **Partly fixed / regressed** | A stale tab's model edit is now refused (verified, `out/t04.json`). But A-21 (critical regression) and A-23 (broken records, missing broadcasts) are new. |
| A-03 same-name companions | **Partly fixed** | Folder upload correct, byte-verified (`out/t05.json` D; package `cmp`). The two-step multi-select is still wrong (A-22), and multi-model folders are falsely rejected (A-24). Simultaneous multi-select is covered by the author's test; I did not re-run it. |
| A-04 orphaned blobs | Fixed per code, not verified | Start-up sweep (10-minute grace) and a busy guard exist. |
| A-05 delete-before-flush | Partly (inferred) | `flush()` now runs before the delete, but under A-21 the flush saves nothing and the delete still happens. |
| A-06 unsaved view | Partly | Indicated (verified); not guarded on navigation (verified: no prompt). |
| A-07 clipping and zoom | Changed, not verified | Planes come from the bounding sphere; `minDistance` is 0.08 × radius, which is probably still inside compact models (inferred). |
| A-08 rich text | Partly verified | Label trimming verified; parser changes not visually re-checked. |
| A-09, A-10 | Not re-verified | The author's axe and DOM-order tests exist. |
| A-11 import details | Partly verified | 0 bytes is shown as "0 bytes" (verified). The triangle warning toast was not exercised (462k is below the threshold). |
| A-12 empty-state icon | **Fixed** (verified) | `shots/a01` |
| A-13 link shown vs stored | Disclosed | The hint now says "(it is not saved until valid)". |
| P-01 viewed without detail | **Fixed** (verified) | List off: the marker click switches to the Annotations tab, the detail is visible, then the count goes from 0 to 1 of 7 (`out/t12.json`). |
| P-02 status after launch failure | Not re-verified | The code retries `incomplete`; the author has a test. |
| P-03 understated reset | Fixed (code and UI text read) | The hash now covers structure only. |
| P-04 cramped list | Not re-verified | |
| P-05 label overlap | Partly | 0–5 markers covered (verified). |
| P-06 accent contrast | Partly | P-23 (4.19:1 on the tab trigger). |
| P-07 local mirror unused | "Fixed", but the fix introduced **P-21 (MAJOR)** | |
| P-08 aria-pressed with a changing label | Partly | Annotation toggles fixed; structure toggles still contradictory (A-25). |

## 6. Requirement checklist (brief walk; ✔ met, ◐ partly, ✘ not met)

### Authoring application

- **Library:**
  - ✔ title, description and thumbnail;
  - ✔ multiple regions and systems (verified: 2 regions and 3 systems on import);
  - ✔ search and filters (Thorax 4/10, Thorax + "heart" 1/10, selected-only 6/10);
  - ✔ create, edit, duplicate and delete with confirmation;
  - ✔ visible selection mechanism;
  - ✔ editable categories (not re-tested).
- **Import and storage:**
  - ✔ GLB and glTF;
  - ✔ other formats explained (OBJ message);
  - ◐ multiple textures and companion workflow (A-22, A-24);
  - ✔ validation messages;
  - ✔ import progress shown;
  - ✔ initial framing;
  - ✔ file size shown;
  - ◐ persistence: exact after reload, but saving breaks after reload (A-21);
  - ◐ refresh must not silently lose work (A-21: following the banner's primary button discards work);
  - ✔ backup and restore (A-01 fixed).
- **Viewer:**
  - ✔ rotate, zoom, pan and reset;
  - ✔ full screen;
  - ✔ background and lighting;
  - ✔ authoring kept separate from preview;
  - ✔ default view saved, with a thumbnail from that view;
  - ✔ the package opens in the identical view;
  - ✔ structure list with hide and isolate;
  - ◐ camera limits and clipping (A-07 not verified).
- **Annotations:**
  - ✔ click placement (exact);
  - ✔ label, description, category and link;
  - ✔ edit, move and delete with undo and redo;
  - ✔ positions survive view changes, save, reload and export (difference 0);
  - ✔ marker and list selection;
  - ✔ show and hide;
  - ✔ occluded markers handled (28/29 occluded at 180°; turn-to works; ghosts on request);
  - ◐ crowding (P-05);
  - ✔ safe markup (no XSS fired anywhere).
- **Workflow:**
  - ◐ save status: a false conflict status after reload (A-21);
  - ✔ undo and redo;
  - ✔ student preview (not re-tested);
  - ✔ empty states;
  - ✔ pre-export checks.

### Exported package

- **Student experience:**
  - ✔ polished gallery, browse, search, thumbnails, descriptions and 3D controls;
  - ✔ show and hide annotations; selection from the model or the list; return to the gallery;
  - ◐ small-screen fallback (P-24);
  - ✔ no authoring controls;
  - ✔ self-study.
- **Export workflow:** ✔ every option present; ✔ "viewed" now honoured (P-01).
- **SCORM:**
  - ✔ genuine ZIP with manifest, launch page, assets and thumbnails;
  - ✔ only selected content; relative paths; no CDN (0 external requests, CSP);
  - ✔ completion rule (`scorm-again`);
  - ✔ resume;
  - ◐ tracking integrity (P-21);
  - ? LMS failure handling (not re-tested this cycle);
  - ✔ honest standalone status ("Standalone mode: progress is saved in this browser only, not sent to an LMS").
  - ✔ The build result says "LMS compatibility has not been verified by this application".

### Engineering

- ◐ accessibility (P-23, A-25/P-25);
- ✔ safe text and links (`javascript:` links refused; HTML shown literally; SVG logo loaded through `<img>`, its script inert);
- ✔ viewers disposed after leaving a model.

## 7. Unverified or overstated claims, and test-quality problems

- **`docs/KNOWN-LIMITATIONS.md` and `docs/ARCHITECTURE.md` on tabs.** They say a tab "that did not see another tab's newer save refuses to overwrite it". In practice the *same* tab refuses after its own reload (A-21).
- **Broadcast claim.** ARCHITECTURE says "a BroadcastChannel also tells other tabs immediately that something changed". It does not for deletions, nor whenever the follow-up save conflicts (A-23).
- **Thumbnail-deletion claim.** "Replaced thumbnails/logos are deleted only after the record pointing at their replacement has been saved" is not true in the conflict state (inferred).
- **Commit message for 74b8d84.** "a stale tab cannot silently overwrite another tab's work" is overstated: see A-23, the silent broken duplicate.
- **TESTING.md axe claim.** "No violations of any impact on any screen scanned" does not hold for a light accent (P-23); the scans evidently used the default accent.
- **Test gaps behind A-21.** `tests/unit/storage.test.ts` builds its project records by hand and never feeds `getProject()` output into `commitChanges()`. The A-02 e2e test opens both tabs and edits without any reload, so the regression is invisible to both.
- **Test gaps behind A-22.** The A-03 e2e test selects both same-named files in a *single* `setInputFiles` call. It never exercises the two-step "Add the missing files…" path that real users take.
- **Test gaps behind P-21.** The tracker tests never vary `cmi.core.student_id`, so cross-learner leakage is untested.
- **No false claims of LMS testing found.** The UI and docs say plainly that no real LMS was tested.

## 8. Prioritised fixes

1. **A-21:**
   - Return `rev` from `ProjectStore.getProject()` (spread the stored record or copy `rev`).
   - Add a unit test (`getProject` → `commitChanges` with `baseRev: project.rev`) and an e2e test (reload → tick model → expect "saved").
   - Make the conflict banner's primary action non-destructive, or state exactly what will be discarded.
2. **P-21:**
   - Scope the local mirror key to `student_id`, plus a course or attempt discriminator when available.
   - Never import a local "completed" flag into an LMS attempt.
   - Add tracker tests with two learners on the same storage.
3. **A-22:**
   - Never satisfy two distinct URIs with one bare-name file; report the second as missing or ambiguous.
   - De-duplicate inputs by path and content, not by name and size.
   - Add an e2e test of the two-step flow.
4. **A-23:**
   - Broadcast deletions, and duplicates of a stale record.
   - On "overwrite" of a model deleted elsewhere, check that its assets exist and warn or refuse.
   - Before `addModel` of a duplicate, verify that the source assets still exist.
5. **A-24:** resolve companion URIs relative to each `.gltf`'s folder before falling back to suffix or name matching.
6. **Polish:**
   - The "x/required viewed" counter (P-22).
   - Accent contrast on tabs (P-23).
   - `overflow-wrap` on the hero and cards (P-24, A-26).
   - Structure-toggle semantics and duplicate names (A-25).
   - Label collision in clusters (P-05).
   - A prompt for an unsaved view on navigation (A-06).
7. **Re-run** the LMS failure-mode suite and the full Playwright suite after these fixes, and record the results.
