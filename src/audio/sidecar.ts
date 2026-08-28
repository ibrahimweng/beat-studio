/**
 * The spreadsheet that came with the archive.
 *
 * A sound library often names its files by catalogue number and keeps what
 * they actually are in a separate table. The BBC Sound Effects archive is the
 * clearest case: thirty three thousand files called things like `07076051.wav`,
 * with the descriptions in a CSV beside them. Imported without it you get a
 * library you cannot search, which is the same as not having it.
 *
 * So a CSV or TSV anywhere in the import is read, and any row that names a
 * file being imported gives that file its name.
 *
 * ---
 *
 * Which column is which is worked out rather than configured, because there is
 * no single format to configure for: the BBC's columns are not Freesound's and
 * neither is whatever a person exports from their own library. Guessing by
 * column *heading* would need a list of every heading anybody uses.
 *
 * Matching by *content* needs no list at all. Exactly one column will be full
 * of the filenames being imported — that is the one that identifies the row,
 * whatever it is called — and once it is known, the rest can be judged on what
 * they look like. It also fails safely: a CSV about something else matches
 * nothing and is ignored, rather than renaming the library after its columns.
 */

/** What an archive's table says about one file. */
export interface Described {
  /** What the sound actually is. */
  description?: string;
  /** What it was filed under. */
  category?: string;
}

/**
 * Split one line of delimited text.
 *
 * Quoted fields, and doubled quotes inside them, because a column full of
 * descriptions will contain the delimiter sooner or later — "door, wooden,
 * slam" is a real BBC row and splitting it naively makes three columns of
 * nonsense out of one.
 */
function fields(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { value += '"'; i++; }
        else quoted = false;
      } else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(value); value = ''; }
    else value += ch;
  }
  out.push(value);
  return out.map((v) => v.trim());
}

/** Whichever of comma or tab appears more often outside quotes. */
function delimiterOf(sample: string): string {
  const commas = (sample.match(/,/g) ?? []).length;
  const tabs = (sample.match(/\t/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

/** A file's name without its folders or its extension, lowercased. */
export function stemOf(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.[^.]+$/, '').trim().toLowerCase();
}

/**
 * Read a table, and say what it knows about the files named in `stems`.
 *
 * Nothing is returned unless a column actually matches the files being
 * imported, so a licence list or a track listing that happens to be in the
 * same zip contributes nothing rather than something wrong.
 */
export function readTable(text: string, stems: ReadonlySet<string>): Map<string, Described> {
  const found = new Map<string, Described>();
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return found;

  const delimiter = delimiterOf(lines.slice(0, 20).join('\n'));
  const rows = lines.map((line) => fields(line, delimiter));
  const width = Math.max(...rows.map((r) => r.length));
  if (width < 2) return found;

  /*
   * The column that names the files.
   *
   * Scored by how many of its values are actually being imported, so a column
   * of catalogue numbers that happen to look like filenames loses to the one
   * whose values are the files in hand.
   */
  let nameColumn = -1;
  let best = 0;
  for (let c = 0; c < width; c++) {
    let hits = 0;
    for (const row of rows) {
      const cell = row[c];
      if (cell && stems.has(stemOf(cell))) hits++;
    }
    if (hits > best) { best = hits; nameColumn = c; }
  }
  // A handful of accidental matches is not a table about these files.
  if (nameColumn < 0 || best < Math.min(3, stems.size)) return found;

  /*
   * The description is the wordiest other column; the category is a short one
   * that repeats. Both are judged on the rows that matched, so a header row or
   * a trailing note cannot sway it.
   */
  const matched = rows.filter((row) => row[nameColumn] && stems.has(stemOf(row[nameColumn])));
  let describeColumn = -1;
  let longest = 0;
  let categoryColumn = -1;
  let fewest = Infinity;

  for (let c = 0; c < width; c++) {
    if (c === nameColumn) continue;
    const values = matched.map((row) => row[c] ?? '').filter((v) => v.length > 0);
    if (!values.length) continue;

    const average = values.reduce((sum, v) => sum + v.length, 0) / values.length;
    // Wordy, and not a column of numbers — a duration column has a fine
    // average length and describes nothing.
    const wordy = values.filter((v) => /[a-z]{3}/i.test(v)).length / values.length;
    if (wordy > 0.6 && average > longest) { longest = average; describeColumn = c; }

    const distinct = new Set(values.map((v) => v.toLowerCase())).size;
    if (
      wordy > 0.6 &&
      average < 40 &&
      distinct > 1 &&
      distinct < Math.max(2, values.length * 0.4) &&
      distinct < fewest
    ) { fewest = distinct; categoryColumn = c; }
  }

  for (const row of matched) {
    const stem = stemOf(row[nameColumn]);
    const description = describeColumn >= 0 ? row[describeColumn] : '';
    const category = categoryColumn >= 0 && categoryColumn !== describeColumn ? row[categoryColumn] : '';
    if (!description && !category) continue;
    found.set(stem, {
      ...(description ? { description: description.slice(0, 60) } : {}),
      ...(category ? { category: category.toLowerCase().slice(0, 32) } : {}),
    });
  }

  return found;
}
