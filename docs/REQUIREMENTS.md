# Requirements brief (verbatim summary used for the independent reviews)

> This is the brief the application was built against. The independent critic is given this file.

## Role and outcome
A professional web application for an anatomy lecturer teaching medical students. It must allow importing anatomical 3D models, organising them by body region and system, adding interactive annotations, and exporting selected models as a **self-contained SCORM learning package**. Two complete experiences: (1) an **authoring application** and (2) a **student-facing learning package**. No placeholder buttons, simulated exports or unfinished core features. UK English throughout. Prioritise reliability, usability, visual quality and maintainability.

## Authoring application
**Model library:** title, description, thumbnail; multiple body-region and body-system assignments per model; search and filters (title, region, system); create/edit/duplicate/delete with confirmation; visible selection mechanism for export. Editable starting categories for common regions and systems; a model must not be forced into one category.

**Import and storage:** GLB and glTF minimum; document support/limits for other formats (no non-functional import options). Multiple meshes/materials/textures; companion-file workflow with clear missing-dependency reports. File validation and understandable errors; import progress; sensible initial camera framing; basic model info incl. file size; warnings for large assets; persistent storage for models, annotations, metadata and viewing settings. Refresh/restart must not silently lose work. Project backup and restore. Explain storage architecture and limits.

**3D viewer:** rotate/zoom/pan with mouse and touch; reset to saved default view; sensible camera limits and clipping; responsive resize and full-screen; adjustable background and lighting; clear separation of authoring and student-preview. Save each model's default camera position, target, zoom and orientation; generate the library thumbnail from the saved view; the student package opens in the same view. For multi-mesh models: structure list with visibility toggles and isolate; never imply a single mesh can be segmented automatically.

**Annotation authoring:** click the surface to place a marker; each has a short label, longer description, optional category/tag, optional reference link; edit, reposition, delete. Positions stored relative to the model/mesh and survive view changes, save, reload and export. Clicking a marker highlights it and opens its label/description in a readable panel; selecting in a searchable list highlights the marker. Show/hide controls. Markers hidden behind geometry handled deliberately and must not appear attached to the front surface. Crowded annotations usable without overlapping text. Readable description formatting; user markup handled safely.

**Workflow:** clear save status and unsaved-change warnings; undo/redo for annotation creation, movement and deletion; student-preview mode; empty states, validation, recoverable errors; pre-export check for missing assets/invalid content.

## Exported learning package
**Student experience:** polished interface (not the authoring dashboard). Browse by region and system; search; thumbnail gallery; read descriptions; rotate/pan/zoom/reset/full-screen; show/hide annotations; select annotations from model or searchable list; read descriptions without losing place; return easily to the gallery. Desktop and tablet layouts with a usable smaller-screen fallback. No authoring controls. Lightweight self-study mode (conceal annotation names until revealed).

**Export workflow:** choose models; package title, description, optional intro text; optional logo and accent colour; which student features are enabled; the completion rule (e.g. open all models; open all models and view all required annotations) with a precise definition of "viewed".

**SCORM:** genuine downloadable ZIP, SCORM 1.2 minimum; manifest, launch page, scripts, styles, models, textures, thumbnails. Only selected models and their assets; relative paths; no connection to the authoring app; no public CDN dependencies; initialise/commit/terminate correctly; record completion by the chosen rule; track session time and resume where supported; handle LMS API failures gracefully; standalone mode without an LMS must not display misleading tracking claims. Avoid storing large data in the LMS; explain progress storage and limits. Target Moodle and Canvas but verify deployment requirements; document required configuration. Without a real LMS, test locally and **explicitly distinguish verified from unverified**; never claim LMS testing that was not performed.

## Engineering and acceptance
Calm, contemporary design; consistent typography/spacing/colour; prioritise the viewport; keyboard-accessible controls, visible focus, sufficient contrast, labelled buttons, navigable annotation list; practical alternatives to precise pointer interactions. Validate uploaded files and imported project data; safe descriptions and links; upload/resource limits; dispose unused 3D resources; progress indicators; understandable failures and recovery. No embedded secrets or undocumented external services; no auth/paid services/multi-user infra unless necessary; deployment model explicit. Appropriately licensed demonstration assets, clearly identified.

**Tests and deliverables:** automated tests for data and packaging logic; browser tests for main journeys. Minimum verification: (1) import a supported model; (2) assign multiple regions and systems; (3) create, edit, move, delete annotations; (4) save a default view and generate its thumbnail; (5) reload and confirm persistence; (6) filter and select models for export; (7) export a valid package containing only the selected content; (8) open the exported package and test the student interface; (9) confirm annotations and default views match authoring; (10) exercise completion, resume and LMS failure handling. **Test the exported artifact itself.** Deliver source, setup/deployment instructions, dependency information, test results, a sample export, known limitations, documentation of main data structures and how to extend.

## Independent review rubric
| Criterion | Weight |
|---|---:|
| Functional completeness and correctness | 30% |
| Usability and workflow clarity | 20% |
| Visual quality and consistency | 15% |
| Reliability, persistence and error handling | 15% |
| Accessibility and responsive behaviour | 10% |
| Performance and maintainability | 10% |

Score each out of 10; compute a weighted overall for the **authoring application** and the **exported student package** separately. Cite concrete observations, test results and defects. Satisfactory = both deliverables ≥ 9/10 with no unresolved critical defects. Critical defects: broken exports, missing assets, lost saved work, incorrectly positioned annotations, failed core interactions. Maximum three review cycles.
