/**
 * Reading a zip, so an archive can be dropped in whole.
 *
 * Sound libraries do not arrive as a tidy folder of files. A Freesound pack
 * downloads as a zip, and so does almost everything else worth having. Asking
 * someone to unpack a few hundred sounds by hand before the app will look at
 * them is asking them not to bother.
 *
 * Written here rather than pulled in, because the browser already has the hard
 * part. `DecompressionStream('deflate-raw')` is the same inflate a zip needs,
 * so what is left is reading the directory at the end of the file and slicing
 * out the entries — a few dozen lines against a dependency and everything that
 * comes with one.
 *
 * Only what a sound library actually contains is handled: stored and deflated
 * entries. Anything else — the encrypted, the split across volumes, the
 * compression methods nobody has used since 1993 — is reported by name and
 * skipped, which is the right answer for a bulk import where one odd file
 * should not stop the other four hundred.
 */

/** One file out of an archive. */
export interface ZipEntry {
  /** The path it had inside the archive, separators and all. */
  path: string;
  /** What was in it. */
  bytes: Uint8Array;
}

/** What a read of an archive produced. */
export interface ZipRead {
  entries: ZipEntry[];
  /** Paths that could not be read, and why, for telling someone. */
  skipped: { path: string; because: string }[];
}

const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END_64_LOCATOR = 0x07064b50;

/** Is this a zip at all? Cheap enough to ask before reading the whole thing. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    // "PK\3\4" for a normal archive, "PK\5\6" for one with nothing in it.
    ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))
  );
}

/**
 * Find the end-of-directory record.
 *
 * It is at the end of the file, except that a zip may carry a comment after
 * it of up to 64 kB, so the only way to find it is to look backwards for its
 * signature. Searching from the end rather than the start also means a file
 * with a self-extracting stub in front of it still reads.
 */
function findEnd(view: DataView): number {
  const from = Math.max(0, view.byteLength - 0x10000 - 22);
  for (let at = view.byteLength - 22; at >= from; at--) {
    if (view.getUint32(at, true) === END) return at;
  }
  return -1;
}

/** Read the directory. Nothing is decompressed here — that is done per entry. */
function directory(view: DataView): { at: number; count: number } | null {
  const end = findEnd(view);
  if (end < 0) return null;

  let count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);

  /*
   * Zip64, for an archive with more than 65535 entries or over 4 GB.
   *
   * A sound library reaches the first of those far sooner than anyone
   * expects — the BBC archive alone is over 33000 files — and a zip that
   * needs this stores 0xffff or 0xffffffff in the plain fields as a flag to
   * look for the 64-bit ones instead.
   */
  if (count === 0xffff || at === 0xffffffff) {
    for (let scan = end - 20; scan >= 0; scan--) {
      if (view.getUint32(scan, true) !== END_64_LOCATOR) continue;
      const record = Number(view.getBigUint64(scan + 8, true));
      if (record < 0 || record + 56 > view.byteLength) break;
      count = Number(view.getBigUint64(record + 32, true));
      at = Number(view.getBigUint64(record + 48, true));
      break;
    }
  }

  return { at, count };
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Everything in an archive that can be read.
 *
 * `wanted` decides which paths are worth spending an inflate on, so a library
 * zip full of licence text and artwork costs only the audio.
 */
export async function readZip(
  data: ArrayBuffer,
  wanted: (path: string) => boolean = () => true,
): Promise<ZipRead> {
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  const entries: ZipEntry[] = [];
  const skipped: { path: string; because: string }[] = [];

  const found = directory(view);
  if (!found) return { entries, skipped: [{ path: '', because: 'not a zip' }] };

  let at = found.at;
  for (let i = 0; i < found.count; i++) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL) break;

    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const path = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    // Directories are entries too, and they are not files.
    if (path.endsWith('/')) continue;
    if (!wanted(path)) continue;

    if (method !== 0 && method !== 8) {
      skipped.push({ path, because: `compression method ${method}` });
      continue;
    }

    /*
     * The local header repeats the name and extra fields, and its extra field
     * is often a different length from the one in the directory. So the data
     * starts after the local header's own lengths, not the directory's.
     */
    if (localAt + 30 > view.byteLength || view.getUint32(localAt, true) !== 0x04034b50) {
      skipped.push({ path, because: 'entry not where the directory says' });
      continue;
    }
    const localName = view.getUint16(localAt + 26, true);
    const localExtra = view.getUint16(localAt + 28, true);
    const from = localAt + 30 + localName + localExtra;
    const raw = bytes.subarray(from, from + compressed);

    try {
      entries.push({ path, bytes: method === 0 ? raw : await inflate(raw) });
    } catch {
      skipped.push({ path, because: 'could not be decompressed' });
    }
  }

  return { entries, skipped };
}
