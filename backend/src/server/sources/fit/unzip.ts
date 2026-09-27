import { unzipSync } from "fflate";

/** Limits against zip bombs and runaway exports. */
export const ZIP_LIMITS = {
  maxEntryBytes: 50 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxEntries: 50_000,
  maxDepth: 3, // Garmin Connect exports nest zips inside the export zip
};

export type ExtractedFile = { name: string; bytes: Uint8Array };

const isZip = (b: Uint8Array) =>
  b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const wanted = (name: string) =>
  /\.(fit|zip)$/i.test(name) && !name.split("/").some((p) => p.startsWith("__MACOSX"));

/**
 * Returns every .fit file inside `bytes` (a .fit, or a .zip possibly containing
 * more zips). Declared sizes are checked *before* inflating each entry.
 */
export function extractFitFiles(
  bytes: Uint8Array,
  name: string,
): { files: ExtractedFile[]; skipped: string[] } {
  if (!isZip(bytes)) return { files: [{ name, bytes }], skipped: [] };

  const files: ExtractedFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  let entries = 0;

  const walk = (zip: Uint8Array, prefix: string, depth: number) => {
    if (depth > ZIP_LIMITS.maxDepth) {
      skipped.push(`${prefix}: nested too deeply`);
      return;
    }
    const out = unzipSync(zip, {
      filter: (f) => {
        if (!wanted(f.name)) return false;
        if (++entries > ZIP_LIMITS.maxEntries) throw new Error("Archive has too many files");
        if (f.originalSize > ZIP_LIMITS.maxEntryBytes) {
          skipped.push(`${prefix}${f.name}: larger than ${ZIP_LIMITS.maxEntryBytes / 1024 / 1024} MB`);
          return false;
        }
        total += f.originalSize;
        if (total > ZIP_LIMITS.maxTotalBytes) throw new Error("Archive expands to more than 1 GB");
        return true;
      },
    });
    for (const [entryName, data] of Object.entries(out)) {
      if (/\.zip$/i.test(entryName)) walk(data, `${prefix}${entryName}/`, depth + 1);
      else files.push({ name: `${prefix}${entryName}`, bytes: data });
    }
  };

  walk(bytes, "", 1);
  return { files, skipped };
}
