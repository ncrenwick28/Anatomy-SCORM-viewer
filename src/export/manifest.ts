/** SCORM 1.2 (IMS Content Packaging 1.1.2 + ADL CAM) manifest generation. */

export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Removes characters that are illegal in XML 1.0 documents. */
function stripIllegal(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
}

/** Identifiers must be valid XML IDs: start with a letter, then letters, digits, "-", "_" or ".". */
export function xmlId(prefix: string, raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.-]/g, '-');
  return `${prefix}-${cleaned}`;
}

export interface ManifestInput {
  identifier: string;
  title: string;
  /** Every file in the package except imsmanifest.xml, relative to the package root. */
  files: string[];
  launch: string;
}

export function generateManifest12(input: ManifestInput): string {
  const title = xmlEscape(stripIllegal(input.title).trim().slice(0, 100) || 'Anatomy 3D models');
  const id = xmlId('PKG', input.identifier);
  const fileLines = input.files
    .slice()
    .sort()
    .map((f) => `      <file href="${xmlEscape(f)}"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${title}</title>
      <item identifier="ITEM-1" identifierref="RES-1" isvisible="true">
        <title>${title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="${xmlEscape(input.launch)}">
${fileLines}
    </resource>
  </resources>
</manifest>
`;
}
