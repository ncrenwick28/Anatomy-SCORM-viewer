# Known limitations

**Packaging and LMS**
- Only **SCORM 1.2** is produced. SCORM 2004 is not offered (the player's LMS code is isolated in `src/player/scorm12.ts` and `tracker.ts`, so an adapter could be added).
- **Not tested against a real LMS** (no Moodle, Canvas, SCORM Cloud or similar was reachable). It was tested against a mock LMS and against `scorm-again`, an independent SCORM 1.2 run-time implementation. See `docs/LMS-NOTES.md` and `docs/TESTING.md`.
- The manifest was checked for well-formedness (`xmllint`) and structure, but **not validated against the IMS/ADL XSD schemas** (the schema files could not be obtained offline). The XSD files are not bundled in packages; most LMSs, including Moodle, do not require them, but a strict validator might.
- A package opened by double-clicking `index.html` (file://) cannot load models because browsers block `fetch` from the file system. Use a web server (`npm run serve:package`) or an LMS.
- Full screen uses the browser Fullscreen API. LMS iframes that do not allow it fall back to filling the frame.
- Completion "viewed" is judged by the information panel having shown the annotation, not by time spent reading.
- Progress is stored as bit masks keyed to the order of models and annotations in one build. If a package is re-exported with models or annotations added, removed or re-ordered and uploaded over an existing attempt, **all saved progress for that attempt is discarded** (opened models and viewed annotations), and the learner is told; the LMS completion status already recorded is kept. Renaming or re-describing items does not discard progress.
- Progress kept in the browser (the fallback when the LMS cannot be reached) is per device and per learner (keyed by the LMS student id). Two activities that use the same package share one local copy for the same learner.
- Leaving a model in the workspace with an unsaved camera or structure change does not prompt; the header says when the view differs from the saved default.
- With a very crowded cluster the label of the selected marker can still cover a few neighbouring markers.

**Authoring**
- Several tabs/windows can open the same project. Saves use optimistic concurrency: a tab that did not see another tab's newer save refuses to overwrite it and shows a banner asking which version to keep (both choices ask for confirmation). Models deleted in another tab are never brought back or copied into a record without files. There is no live co-editing.
- Storage is the browser's IndexedDB: per browser profile and per web address, subject to the browser's quota and eviction rules. Backups are the portability and recovery mechanism. There is no sync, login or multi-user editing.
- Backups are read into memory; very large projects (multi-GB) may exceed what a browser tab can hold.
- Import supports GLB/glTF 2.0 only (Draco and Meshopt compression included). KTX2/Basis textures, glTF 1.0, OBJ, FBX, STL, PLY and other formats are not supported. Animations are ignored; skinned meshes are shown in rest pose.
- Models with a single mesh cannot be split into structures (by design); the structure list says so.
- Annotation anchors are tied to the mesh index path inside the file. Re-importing a *different* file in place of an existing one may invalidate anchors; the pre-export check detects markers that no longer sit on a surface.
- Thumbnails and the viewer require WebGL 2. Very large models are limited by device memory; tablets may struggle above ~1.5 million triangles (warning shown).
- The native "unsaved changes" browser prompt is verified at event level only; headless Chromium does not display it.

**Content**
- The demonstration models are schematic shapes, not anatomically accurate, and their text is placeholder content.
