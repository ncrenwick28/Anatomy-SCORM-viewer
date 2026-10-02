# LMS notes (Moodle, Canvas) and what has / has not been verified

## Verification status (read this first)

| Claim | Status |
|---|---|
| Package is a ZIP with `imsmanifest.xml` at the root, a launch page, all assets listed in the manifest, relative paths only, no CDN | **Verified** (unit tests + e2e on the exported ZIP; manifest checked with `xmllint` for well-formedness) |
| Manifest validates against the IMS CP 1.1.2 / ADL 1.2 XSDs | **Not verified** (schemas not obtainable in the build environment) |
| SCO finds `window.API` in parent/opener frames; calls `LMSInitialize`, `LMSSetValue`, `LMSCommit`, `LMSFinish`; sets `incomplete` then `completed` by the chosen rule; writes `session_time`, `lesson_location`, `suspend_data`, `exit` | **Verified against a mock LMS and against `scorm-again`** (an independent SCORM 1.2 run-time that validates values), in a real browser, using the exported package in an iframe |
| Resume from `suspend_data` / `entry=resume`; no downgrade of a completed status; browse mode writes nothing | **Verified** (same environment) |
| Behaviour when the API is absent, `LMSInitialize` fails, writes fail then recover, or every call throws | **Verified** (same environment) |
| Works in Moodle | **Not tested** – no Moodle instance was reachable |
| Works in Canvas | **Not tested** – no Canvas/SCORM tool instance was reachable |
| Full screen inside LMS frames | **Not tested in an LMS**; the code falls back to filling the frame when the Fullscreen API is refused |

The network sandbox used to build this blocked moodle.org, docs.moodle.org and the Canvas community site, so the documentation below comes from web-search summaries only (full pages could not be opened). Treat it as a starting point and check with your LMS administrator.

## What the package does in an LMS

- Data model elements used (SCORM 1.2): `cmi.core.lesson_status`, `cmi.core.lesson_location`, `cmi.core.session_time`, `cmi.core.exit` (only `suspend` while incomplete), `cmi.suspend_data`; reads `cmi.core.entry` and `cmi.core.lesson_mode`. No score is reported.
- `lesson_status` is `incomplete` on first launch and `completed` once the chosen rule is met; it is never reverted. In browse/review mode nothing is written.
- **Progress storage:** `cmi.suspend_data` holds `a1|<content hash>|<last model>|<opened-models bitmask>|<per-model annotation bitmasks>`. Measured sizes with everything completed: 20 models × 10 annotations (200 annotations) = 138 characters; 20 models × 200 annotations (4,000 annotations) = 1,078 characters; a typical half-finished attempt is about 20–30. The encoder falls back to models-only data if it would ever exceed SCORM 1.2's 4096-character limit (unit-tested with 300 models × 400 annotations). A content hash covering which models and annotations exist, and in what order, protects against loading progress saved for a different structure; renaming or re-describing items does not change it.
- Commits are debounced (about 0.8 s after a change) and immediate on completion. On `pagehide`, `beforeunload` and `unload` the session is terminated once (`terminate()` is idempotent). If an LMS call fails the learner is told, progress is kept (also mirrored in the browser's local storage), and the package retries every 15 s, re-sending `incomplete`, `suspend_data` and (if reached) `completed`. On the next launch of the *same attempt* (`entry=resume`), progress kept locally for *that learner* (the local copy is keyed by package id and `cmi.core.student_id`) is merged with what the LMS returns (progress only ever grows), so data the LMS never received is not lost on this device. A brand-new attempt ignores the local copy, other learners on the same computer never see it, and local data is never used to mark an LMS attempt completed: completion is recomputed from the merged progress by the package's own rule. Limitation: two activities in one course that use the *same* package share one local copy for the same learner.

## Moodle (from public documentation; unverified here)

- Add the ZIP with **Add an activity or resource → SCORM package**. Moodle's SCORM activity supports SCORM 1.2 natively and expects `imsmanifest.xml` at the root of the ZIP, which this package provides.
- The maximum upload size comes from your site and PHP limits (`upload_max_filesize`, `post_max_size`, course upload limit); a package with several models can be tens of MB.
- Moodle has a "SCORM 1.2 standards mode" admin setting that enforces the 4096-character `suspend_data` limit; this package stays inside it.
- To report completion to the course, set the activity's completion tracking to require the SCORM status "completed".
- If the full-screen button only fills the frame, configure the SCORM activity to open in a new window.

## Canvas (from public documentation; unverified here)

- Canvas does not import SCORM natively. Institutions that offer SCORM typically enable an LTI-based SCORM tool or a third-party SCORM player, and support differs between institutions. Ask your Canvas administrator which tool is enabled, which SCORM versions it accepts (reports indicate SCORM 1.2 and 2004), and any size limits.
- Completion reporting depends on that tool. Verify it in a test course.

## Sources consulted (via web search summaries)
- University guidance on SCORM in Canvas (e.g. University of Melbourne, University of Wisconsin KB, Ohio University KB).
- Moodle forum/FAQ material on SCORM 1.2 `suspend_data` limits and package structure.

## Suggested acceptance test in your own LMS
1. Upload `sample/anatomy-demo-package-scorm12.zip` (completion rule: open every model and view every required annotation).
2. Launch; confirm the models load and the status chip says progress is recorded in the course.
3. Open all four models and select every annotation; confirm the activity completes.
4. Relaunch partway through a fresh attempt and confirm "Welcome back" and the opened ticks.
5. Report anything different to the maintainers with the LMS name and version.
