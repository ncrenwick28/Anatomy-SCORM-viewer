# Anatomy SCORM Studio

A browser-based tool for anatomy lecturers. **Import** GLB/glTF 3D models, **organise** them by body region and system, **annotate** them, then **export** a self-contained **SCORM 1.2** package that students open inside an LMS.

It is two products in one repository:

1. **Authoring application** – library, importer, 3D viewer, annotation editor, student preview, backup/restore, export wizard with pre-export checks.
2. **Student player** – the learning package itself: thumbnail gallery, browse by region/system, search, interactive 3D viewer, annotations (model + searchable list), self-study mode, completion tracking and resume.

> **Status and honesty:** this was built and tested with automated unit tests (98) and browser tests (44, including tests of the *exported* package), but **never against a real Moodle or Canvas**. Two independent reviews scored the authoring app 7.1 then 6.1 and the exported package 8.2 then 7.8 out of 10 — **below the 9/10 target** — and the defects they found have since been fixed but not independently re-reviewed. See [`docs/TESTING.md`](docs/TESTING.md), [`docs/LMS-NOTES.md`](docs/LMS-NOTES.md) and [`docs/KNOWN-LIMITATIONS.md`](docs/KNOWN-LIMITATIONS.md) for what is and is not verified, and [`docs/reviews/`](docs/reviews) for the independent review reports.

## Quick start

Requires Node.js 20 or newer.

```bash
npm ci
npm run dev          # builds the student player, then starts the authoring app (http://127.0.0.1:5173)
```

Production build and local preview:

```bash
npm run build        # player → public/player, then the app → dist/
npm run preview      # http://127.0.0.1:4173
```

**Deploy:** copy `dist/` to any static web host (it uses relative URLs, so any sub-folder works). There is no server component, database, login or external service. Use HTTPS (or localhost) so the browser can grant persistent storage.

### Make a first package in five minutes
1. Open the app → **Load demonstration models** (four schematic CC0 models) – or **Import models** to use your own `.glb` / `.gltf`.
2. Tick **Include in export** on some models → **Export**.
3. Set title, optional intro, logo and accent colour, student features and the completion rule. Check the **Pre-export checks**.
4. **Build SCORM 1.2 package** → a ZIP downloads. Upload it to your LMS as a SCORM activity.

A ready-made example is in [`sample/anatomy-demo-package-scorm12.zip`](sample) (built through the UI by the e2e suite; completion rule: open every model and view every required annotation).

### Previewing a package without an LMS
Browsers will not load models when `index.html` is opened from disk. Serve it instead:

```bash
npm run serve:package -- sample/anatomy-demo-package-scorm12.zip      # → http://127.0.0.1:8080/index.html
```
Without an LMS the player says so ("Standalone mode… not sent to an LMS") and keeps progress in the browser only.

## Where is my work stored?
In your browser's **IndexedDB**, automatically, with a visible *Saved / Saving / Unsaved changes* indicator. It does **not** leave your computer, and it is **tied to this browser profile and web address**: clearing site data or using another browser loses it. Use **Backup → Download project backup** regularly; **Restore** can add to or replace the current project. Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#storage-architecture-authoring).

## Supported model formats
GLB and glTF 2.0 (`.gltf` + `.bin` + PNG/JPEG/WebP textures; upload them together or add missing files afterwards), including Draco and Meshopt compressed meshes. OBJ, FBX, STL, PLY, COLLADA, USDZ, .blend, KTX2 textures, glTF 1.0 and animations are **not supported** – convert to GLB first (e.g. Blender → Export → glTF 2.0). Models over 25 MB warn; over 300 MB are refused.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Build player, start dev server |
| `npm run build` | Build player + type-check + build app |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (Vitest) – shared logic, storage, backup, importer, exporter, SCORM client/tracker |
| `npm run test:e2e` | Build, then Playwright browser tests of the app **and the exported package** (needs Chromium; uses software WebGL) |
| `npm run test:all` | Everything |
| `npm run sample:export` | Rebuild `sample/…zip` through the real UI |
| `npm run serve:package -- <zip\|folder> [port]` | Static server for previewing a package |
| `npm run demo:generate` | Regenerate the demonstration models |

Set `CHROMIUM_PATH` to use a specific Chromium/Chrome binary for Playwright.

## Documentation
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) – structure, storage, data structures, SCORM runtime, how to extend
- [`docs/TESTING.md`](docs/TESTING.md) – what was tested, where, results, what is unverified
- [`docs/LMS-NOTES.md`](docs/LMS-NOTES.md) – SCORM details, Moodle/Canvas notes, verification status
- [`docs/KNOWN-LIMITATIONS.md`](docs/KNOWN-LIMITATIONS.md)
- [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) – packages and licences
- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) – the brief and review rubric
- An in-app **Help** page covers formats, storage, LMS notes and keyboard use.

## Licence of this code and content
The source in this repository has no licence file yet – add the one your institution requires. Demonstration models are original CC0 shapes generated by `scripts/generate-demo-models.ts`.
