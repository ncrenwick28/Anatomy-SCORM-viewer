# Architecture and extension guide

## Deployment model
A **static, client-only web application**. There is no server, database, account system or third-party service. Build once (`npm run build`) and host `dist/` on any static web server (a folder on a web host, a university web space, GitHub Pages, `npx serve dist`). It needs a modern browser with WebGL 2 and IndexedDB. Use HTTPS (or `localhost`) so the browser may grant persistent storage; it also works over plain HTTP.

The same repository builds two artefacts:

| Artefact | Entry | Output |
|---|---|---|
| Authoring application | `index.html` → `src/authoring/main.tsx` | `dist/` (ES modules; includes `dist/player/*` and `dist/lib/draco/*` as static files) |
| Student player | `src/player/main.tsx` | `public/player/player.js` (**classic IIFE script**) and `player.css` (via `vite.player.config.ts`). The exporter fetches these two files from the app's own origin and writes them into each package. |

`npm run build` builds the player first, then the app, so the exporter always finds `player/player.js`.

## Source layout

```
src/
  shared/      framework-free logic shared by everything (unit-tested)
    types.ts          data model + limits + defaults (the single source of truth)
    schema.ts         zod schemas used to validate backups on restore
    richtext.ts       safe description format → AST (no HTML ever interpreted)
    completion.ts     completion rules and the Progress structure
    progressCodec.ts  compact bit-mask encoding for cmi.suspend_data
    gltfInspect.ts    GLB/glTF header validation, dependency discovery, URI rewriting
    zip.ts            streaming ZIP read/write with zip-bomb limits (fflate)
    content.ts        PackageContent: the exporter ↔ player contract
  viewer/      Three.js viewer (no React)
    ViewerCore.ts     load, orbit, lighting, structure visibility, picking, markers, occlusion, thumbnails
    MarkerLayer.ts    DOM markers, clustering, "+n" popover
    meshKeys.ts       stable mesh identifiers and anchor ↔ world conversion
    framing.ts        camera framing maths (shared with the demo generator)
    loader.ts         GLTFLoader (+ Draco, Meshopt), BVH preparation, disposal
  storage/     ProjectStore (IndexedDB), backup/restore, importer
  export/      manifest, launch page, package builder, preflight checks, preview content
  player/      student app: Player, Gallery, ModelView, SCORM client, tracker
  authoring/   authoring app: store, pipeline (import/thumbnail/anchor checks), pages, components
  ui/          components shared by both apps (Viewport, annotation list/detail, structure panel, CSS tokens)
scripts/       demo-model generator, static package server
tests/         unit (Vitest), e2e (Playwright), fixtures
```

## Storage architecture (authoring)
IndexedDB database `anatomy-scorm-studio` with three object stores:

| Store | Key | Holds |
|---|---|---|
| `meta` | `"project"` | `Project`: region and system lists, export configuration (incl. selected model ids and their order) |
| `models` | model id | `ModelRecord`: metadata, annotations, saved view, stats, references to assets |
| `assets` | asset id | `AssetRecord`: the binary `Blob` (model files, thumbnails, logo) |

The Zustand store (`authoring/state/store.ts`) holds the working copy and writes dirty records after 450 ms (or on Ctrl+S / navigation). The header shows *Saved / Saving / Unsaved changes / Save failed*; failures are retried by the user and a `beforeunload` prompt guards unsaved work. Duplicating a model shares its immutable asset files; deleting a model removes only assets nothing else references.

**Backup format** (`.zip`): `project.json` (validated with zod on restore) + `assets/<id>/<name>`. Restore verifies the ZIP signature, expansion limits, schema, file presence and sizes *before* changing anything; *replace* is a single IndexedDB transaction (all or nothing); *merge* mints fresh ids.

## Main data structures (`src/shared/types.ts`)
- **`ModelRecord`** – `id`, `title`, `description` (rich-text string), `credit`, `regionIds[]`, `systemIds[]` (many-to-many), `format`, `entryName`, `assets[]` (`AssetRef`: flat safe file names), `thumbnailAssetId`, `stats`, `view` (`ViewSettings`), `annotations[]`, `meshLabels`.
- **`ViewSettings`** – `camera` (`CameraView`: position, target, up, quaternion, zoom, fov, **aspect**), `background`, `lighting`, `hiddenMeshKeys[]`.
- **`Annotation`** – `label`, `description`, `category`, `link {url,title}|null`, `required`, and `anchor`.
- **`AnnotationAnchor`** – `{ meshKey, meshName, position, normal }` in the **local space of the mesh**. `meshKey` is the child-index path from the scene root ("0/3/1"; `viewer/meshKeys.ts`). Because the stored model file is shipped byte-for-byte in the package, the same keys resolve in the player. A name check and a unique-name fallback guard against re-ordered files.
- **`ExportConfig`** – title/description/intro, logo asset, accent, `features`, `completion` (`launch` | `open-all` | `open-all-and-annotations`), `selectedModelIds`.
- **`PackageContent`** (`shared/content.ts`) – what `data/content.js` assigns to `window.__ANATOMY_CONTENT__`: package metadata, used categories, and `PackageModel[]` with relative paths and the same `view` / `annotations`.
- **`Progress`** (`shared/completion.ts`) – `{ opened[], viewed{modelId: annotationId[]}, lastModelId }`.

### Default views and "same view"
A saved `CameraView` includes the `aspect` of the viewport it was saved in. When a screen is narrower, `ViewerCore.applyView` backs the camera off along the same line of sight by `savedAspect / currentAspect` (max ×3) so the same *width* of the model stays visible; target, direction, up and fov are identical. The e2e suite asserts this relationship.

### Annotation occlusion, clustering, crowding
Each frame the markers' world positions are projected. Every ≈70 ms after the camera moves, a BVH-accelerated ray is cast from the camera to each marker; if geometry is hit first the marker is *occluded*. Occluded markers are not drawn (so they never look attached to the front surface), can be shown as dashed ghosts on request, are flagged in the list, and selecting one turns the camera to its surface normal. Markers within 20 px merge into a "+n" badge that opens a keyboard-navigable list; the selected marker is never merged. Only numbers sit on the model; the label appears for the selected marker or on hover/focus.

## SCORM runtime (`src/player/`)
`scorm12.ts` – API discovery (this window → parents → opener), a defensive client wrapper (every call try/caught, errors read via `LMSGetLastError`), session-time formatting. `tracker.ts` – modes `lms | browse | standalone`, health `ok | degraded`, debounced saves, immediate completion commit, retry timer, idempotent `terminate()`. `useTracker.ts` exposes state to React. The UI (`StatusBar.tsx`) only claims LMS tracking when `mode === 'lms' && health === 'ok'`.

## Extending
- **New student feature flag:** add it to `PlayerFeatures` and `DEFAULT_FEATURES` (`types.ts`), the zod schema (`schema.ts`), the checkbox list in `ExportPage.tsx`, and read it in `player/ModelView.tsx` / `Gallery.tsx`.
- **New completion rule:** add it to `CompletionRule`, `computeCompletion` and `COMPLETION_RULE_LABELS` (`completion.ts`), the zod enum, and unit-test it.
- **SCORM 2004:** write a manifest generator beside `export/manifest.ts`, an API client beside `scorm12.ts` (`API_1484_11`, ISO-8601 durations, `cmi.completion_status`), and pick the client in `tracker.ts` `start()`.
- **Another import format:** convert to glTF in `storage/importer.ts` (output a GLB blob and treat it like an upload) so the rest of the pipeline is unchanged.
- **Schema changes:** bump `SCHEMA_VERSION`, add a migration in `parseBackup` (`storage/backup.ts`) and keep reading older versions.
- **Debug hooks:** both apps expose `window.__ANATOMY_DEBUG__` (read-only state: camera, marker states, tracker) for automated tests and support.
