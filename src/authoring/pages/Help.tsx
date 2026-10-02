import { APP_NAME, APP_VERSION } from '../../shared/version';

/** Built-in documentation: formats, storage model, LMS notes, shortcuts and limitations. */
export function HelpPage() {
  return (
    <div className="help">
      <div className="page-head"><div><h1>Help and notes</h1><p className="hint">{APP_NAME} {APP_VERSION}</p></div></div>
      <div className="help-grid">
        <nav className="help-toc card" aria-label="On this page">
          <ul>
            {['start', 'formats', 'storage', 'annotations', 'student', 'lms', 'keys', 'limits'].map((id) => (
              <li key={id}><a href={`#help-${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: 'smooth' }); }}>{({ start: 'Getting started', formats: 'Model formats', storage: 'Where your work is stored', annotations: 'Annotations and views', student: 'The student package', lms: 'LMS notes (Moodle, Canvas)', keys: 'Keyboard and accessibility', limits: 'Known limitations' } as Record<string, string>)[id]}</a></li>
            ))}
          </ul>
        </nav>
        <div className="help-body">
          <section id="help-start" className="card">
            <h2>Getting started</h2>
            <ol>
              <li><strong>Import</strong> one or more GLB or glTF models in the Library (or add the demonstration models).</li>
              <li><strong>Organise</strong>: tick any number of body regions and systems on each model.</li>
              <li><strong>Open</strong> a model, rotate it to a good starting view and choose “Save as default view”. This also renders the library thumbnail.</li>
              <li><strong>Annotate</strong>: “Add annotation”, then click the surface. Add a label, description, optional category and link.</li>
              <li><strong>Select</strong> models with their checkboxes, open “Export”, set the title, features and completion rule, and build the package.</li>
              <li><strong>Upload</strong> the ZIP to your LMS as a SCORM 1.2 activity.</li>
            </ol>
          </section>

          <section id="help-formats" className="card">
            <h2>Model formats</h2>
            <p><strong>Supported:</strong> GLB (binary glTF 2.0) and glTF 2.0 (<code>.gltf</code>) with its <code>.bin</code> buffers and PNG, JPEG or WebP textures. Draco and Meshopt compressed meshes are supported. Models may contain many meshes, materials and textures.</p>
            <p><strong>glTF with companion files:</strong> select the <code>.gltf</code> together with its <code>.bin</code> and image files (or drop the whole folder). Missing files are listed by name and you can add them afterwards. Files are renamed to safe names and the glTF is updated to match.</p>
            <p><strong>Not supported:</strong> OBJ, FBX, STL, PLY, COLLADA, 3DS, USDZ and .blend files cannot be imported, and the import dialog says so rather than offering them. Convert them to GLB first, for example in Blender (File → Export → glTF 2.0), or with <code>gltf-transform</code>. KTX2/Basis textures, animations, and glTF 1.0 are not supported.</p>
            <p><strong>Limits:</strong> models over 25 MB trigger a warning; over 300 MB are refused. More than 1.5 million triangles triggers a warning because tablets may render slowly.</p>
            <p>A model made of a <em>single</em> mesh cannot be separated into anatomical structures automatically. The structure list only shows meshes that exist in the file.</p>
          </section>

          <section id="help-storage" className="card">
            <h2>Where your work is stored</h2>
            <p>This is a local-first, single-user tool with no server and no account. Models, annotations, views and settings are saved automatically in this browser’s <strong>IndexedDB</strong> storage for this site address. The “Saved / Saving / Unsaved changes” indicator in the header shows the state; a warning appears if you try to leave with unsaved changes.</p>
            <ul>
              <li>Clearing site data, using a private window, or switching browser or computer means the work is <strong>not there</strong>. Use <strong>Backup → Download project backup</strong> regularly; it produces a ZIP of everything. “Restore from backup” can add the models to the current project or replace it.</li>
              <li>The browser decides how much space is available. The Backup menu shows usage, and whether the browser has agreed to keep the data (persistent storage).</li>
              <li>You can open the project in several tabs, but only one should be edited at a time. If another tab saved first, this tab stops saving, says so, and lets you load the latest version or overwrite it on purpose, so work is never overwritten silently.</li>
              <li>The project is tied to the web address it was opened from. A different address (for example <code>localhost:5173</code> versus a deployed copy) has its own, separate storage.</li>
            </ul>
          </section>

          <section id="help-annotations" className="card">
            <h2>Annotations and views</h2>
            <ul>
              <li>Markers are stored relative to the <em>mesh</em> they sit on (a mesh key plus a local position), so they stay attached when the view changes and after saving, reloading and exporting.</li>
              <li>Markers on the far side of the model, or behind other structures, are hidden by default so they never appear attached to the front surface. “Markers behind” shows them as faint dashed circles. Selecting one in the list turns the model to face it.</li>
              <li>Markers close together merge into a “+n” badge that opens a short list.</li>
              <li>Undo and redo cover creating, moving, deleting and editing annotations for the open model (Ctrl+Z, Ctrl+Shift+Z).</li>
              <li>If you replace a model file with a different one, annotations may no longer fit; the pre-export check detects markers that no longer sit on a surface.</li>
              <li>Descriptions are plain text with light formatting. HTML is never executed, and links must be http(s).</li>
            </ul>
          </section>

          <section id="help-student" className="card">
            <h2>The student package</h2>
            <ul>
              <li>Self-contained: manifest, launch page, player script, styles, models, thumbnails and content. No CDNs or external services; a content security policy in the launch page enforces this.</li>
              <li><strong>Completion:</strong> choose “complete on launch”, “open every model”, or “open every model and view every required annotation”. A model counts as <em>opened</em> when it has been selected and has finished loading. An annotation counts as <em>viewed</em> when its label and description have been shown in the information panel (in self-study mode, after it has been revealed).</li>
              <li><strong>Progress storage:</strong> in an LMS, status, last location, session time and a short bit-coded record of opened models and viewed annotations (<code>cmi.suspend_data</code>, typically under a few hundred characters; automatically reduced if it would exceed 4096). Without an LMS the player says so and keeps progress in the browser’s local storage only.</li>
              <li>If the LMS API is missing, fails to start or stops responding, the learner can continue; the player explains what is happening and keeps retrying.</li>
              <li><strong>Previewing:</strong> opening <code>index.html</code> directly from disk cannot load models (browsers block it). Use <code>npm run serve:package -- yourpackage.zip</code>, any static web server, or upload to an LMS.</li>
            </ul>
          </section>

          <section id="help-lms" className="card">
            <h2>LMS notes (Moodle, Canvas)</h2>
            <div className="callout callout--warn"><span><strong>Not tested in a real LMS.</strong> This application was tested against a mock LMS API and an independent SCORM 1.2 run-time implementation, not against Moodle or Canvas. The notes below come from public documentation and may be out of date; always test a package in your own LMS before using it with students.</span></div>
            <h3>Moodle</h3>
            <ul>
              <li>Add the package with “Add an activity or resource → SCORM package”, choosing the ZIP. Moodle supports SCORM 1.2 natively; <code>imsmanifest.xml</code> is at the root of this package, as required.</li>
              <li>Maximum upload size is set by your site and PHP limits; large model packages may need an administrator to raise them. A typical package here is a few MB per model.</li>
              <li>Moodle can limit SCORM 1.2 <code>suspend_data</code> to 4096 characters (“SCORM 1.2 standards mode”). This package stays within that limit.</li>
              <li>To record completion, set the activity’s completion tracking to use the SCORM status “completed”. If the full-screen button only fills the frame, set the activity to open in a new window.</li>
            </ul>
            <h3>Canvas</h3>
            <ul>
              <li>Canvas does not import SCORM natively. Institutions that offer it typically enable a SCORM tool (an LTI integration) or a third-party SCORM player, and support varies. Ask your Canvas administrator which SCORM tool is enabled and whether it accepts SCORM 1.2 packages up to your package size.</li>
              <li>Results depend on that tool, not on Canvas itself; verify completion reporting in a test course.</li>
            </ul>
            <p className="hint">Sources consulted: public help pages summarised by web search (Moodle SCORM documentation and forum posts; university Canvas guides). Direct page access was not available when this was written.</p>
          </section>

          <section id="help-keys" className="card">
            <h2>Keyboard and accessibility</h2>
            <ul>
              <li>Focus the 3D view (Tab) then: arrow keys rotate, Shift+arrows pan, + / − zoom, 0 resets the view. On-screen buttons offer the same actions.</li>
              <li>Instead of clicking to place a marker, use “Add at centre” to place it at the point in the middle of the view, and “Move to centre of view” to reposition. Structures can be hidden and isolated from the list.</li>
              <li>The annotation list supports Up/Down/Home/End; selecting an item highlights its marker. All controls have visible focus and labels; motion respects “reduce motion”.</li>
            </ul>
          </section>

          <section id="help-limits" className="card">
            <h2>Known limitations</h2>
            <ul>
              <li>Only SCORM 1.2 is produced. SCORM 2004 is not offered.</li>
              <li>Animated or skinned models are shown static; markers on skinned meshes may not follow animation.</li>
              <li>Local storage is per browser. There is no sync or multi-user editing.</li>
              <li>Thumbnails and the viewer need WebGL 2. Very large models are limited by the device’s memory.</li>
              <li>Demonstration models are schematic and not anatomically accurate (CC0, generated for this software).</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
