#!/usr/bin/env node
/**
 * xlsx-i18n.mjs — manage an ngx-translate translations workbook (.xlsx) with zero dependencies.
 *
 * Companion to the `xlsxToJsonTranslate` CLI: this script edits the SOURCE .xlsx; that tool
 * compiles it to per-language JSON consumed by @ngx-translate/core.
 *
 * Workbook contract (first worksheet only):
 *   column 0 = "Informations"   (free-text note, ignored by xlsxToJsonTranslate)
 *   column 1 = "Key"            (dotted key, e.g. APP.HOME.TITLE) -> xlsxToJsonTranslate --keycolumn=1
 *   column 2+ = one column per language; the HEADER cell holds the lang code (fr, en, ...)
 *
 * Usage:
 *   node xlsx-i18n.mjs create <file> [--langs fr,en] [--force]
 *   node xlsx-i18n.mjs dump   <file> [--missing <lang>]
 *   node xlsx-i18n.mjs add    <file> [--rows <rows.json>] [--create] [--langs fr,en]
 *   node xlsx-i18n.mjs add-lang <file> <lang>
 *
 * `add` reads rows from --rows <file> or stdin. Row shape (array):
 *   [{ "info": "Home page", "key": "APP.HOME.TITLE", "values": { "fr": "Bonjour", "en": "Hello" } }]
 *   flat form also accepted: [{ "info": "...", "key": "APP.HOME.TITLE", "fr": "...", "en": "..." }]
 * Upsert semantics: existing Key updates the provided language cells (+info if given); new Key is appended.
 *
 * Implementation note: an .xlsx is a ZIP of XML parts. This file ships a tiny ZIP reader/writer
 * (node:zlib + a CRC32 table) and minimal sharedStrings/worksheet XML handling, so it needs no
 * npm packages and no zip/unzip CLI. On update it rewrites only xl/sharedStrings.xml + the first
 * worksheet's <sheetData>/<dimension>, preserving every other part (styles, extra sheets) byte-for-byte.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------
const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlUnescape = (s) =>
  String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&#9;/g, '\t')
    .replace(/&#x?[0-9a-fA-F]+;/g, (e) => {
      const hex = /x/i.test(e);
      const code = parseInt(e.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : e;
    })
    .replace(/&amp;/g, '&');

const colToLetters = (idx) => {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const lettersToCol = (letters) => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// ---------------------------------------------------------------------------
// Minimal ZIP (read + write) — DEFLATE/STORE only, no external deps
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Read a .xlsx/.zip buffer into an ordered Map<name, Buffer(uncompressed)>. */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx (no ZIP end-of-central-directory record found)');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = zlib.inflateRawSync(comp);
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    entries.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Serialize an ordered Map<name, Buffer> into a .zip buffer. */
function writeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data);
    const store = deflated.length >= data.length;
    const method = store ? 0 : 8;
    const body = store ? data : deflated;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // fixed DOS date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 36); // internal+external attrs zeroed (offsets 36/38 contiguous)
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.size, 8);
  eocd.writeUInt16LE(entries.size, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

// ---------------------------------------------------------------------------
// SharedStrings + worksheet parsing/emitting
// ---------------------------------------------------------------------------
function parseSharedStrings(xml) {
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const inner = m[1] || '';
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(inner))) text += xmlUnescape(tm[1]);
    out.push(text);
  }
  return out;
}

/** Parse the worksheet XML into a grid: array (row) of Map<colIndex, {v, s}>. */
function parseSheet(xml, shared) {
  const grid = [];
  const bodyM = xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
  const body = bodyM ? bodyM[1] : '';
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
  let rm;
  while ((rm = rowRe.exec(body))) {
    const attrs = rm[1] || rm[3] || '';
    const rNum = parseInt((attrs.match(/\br="(\d+)"/) || [])[1] || '0', 10);
    if (!rNum) continue;
    const inner = rm[2] || '';
    const rowMap = new Map();
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cm;
    while ((cm = cellRe.exec(inner))) {
      const cattrs = cm[1] || cm[3] || '';
      const cinner = cm[2] || '';
      const ref = (cattrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
      if (!ref) continue;
      const col = lettersToCol(ref);
      const sAttr = (cattrs.match(/\bs="(\d+)"/) || [])[1];
      const t = (cattrs.match(/\bt="([^"]+)"/) || [])[1];
      let v = '';
      if (t === 's') {
        const vi = (cinner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        v = shared[parseInt(vi, 10)] ?? '';
      } else if (t === 'inlineStr') {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tm;
        while ((tm = tRe.exec(cinner))) v += xmlUnescape(tm[1]);
      } else {
        const vi = (cinner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        v = vi !== undefined ? xmlUnescape(vi) : '';
      }
      rowMap.set(col, { v, s: sAttr !== undefined ? parseInt(sAttr, 10) : undefined });
    }
    grid[rNum - 1] = rowMap;
  }
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = new Map();
  return grid;
}

/** Build <sheetData>, the shared-strings list and the dimension from the grid. */
function emitSheetAndShared(grid) {
  const strings = [];
  const indexOf = new Map();
  let totalRefs = 0;
  let maxCol = 0;
  const intern = (s) => {
    if (indexOf.has(s)) return indexOf.get(s);
    const i = strings.length;
    strings.push(s);
    indexOf.set(s, i);
    return i;
  };
  let rowsXml = '';
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    let cells = '';
    if (row) {
      for (const [c, cell] of [...row.entries()].sort((a, b) => a[0] - b[0])) {
        if (cell.v === undefined || cell.v === '') continue;
        const idx = intern(String(cell.v));
        totalRefs++;
        if (c > maxCol) maxCol = c;
        const sAttr = cell.s !== undefined ? ` s="${cell.s}"` : '';
        cells += `<c r="${colToLetters(c)}${r + 1}"${sAttr} t="s"><v>${idx}</v></c>`;
      }
    }
    rowsXml += `<row r="${r + 1}">${cells}</row>`;
  }
  const dimension = `A1:${colToLetters(maxCol)}${grid.length || 1}`;
  return { sheetData: `<sheetData>${rowsXml}</sheetData>`, strings, totalRefs, dimension };
}

function buildSharedStrings(strings, totalRefs) {
  const items = strings.map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${totalRefs}" uniqueCount="${strings.length}">${items}</sst>`
  );
}

// ---------------------------------------------------------------------------
// Workbook model
// ---------------------------------------------------------------------------
function findFirstSheetPath(entries) {
  const wb = entries.get('xl/workbook.xml')?.toString('utf8') || '';
  const rid = (wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/) || [])[1];
  const rels = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  let target;
  if (rid) {
    const m = rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*\\bTarget="([^"]+)"`)) || rels.match(new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${rid}"`));
    if (m) target = m[1];
  }
  if (!target) target = (rels.match(/Target="((?:\/xl\/)?worksheets\/[^"]+)"/) || [])[1];
  if (!target) target = 'worksheets/sheet1.xml';
  target = target.replace(/^\//, '').replace(/^xl\//, '');
  return 'xl/' + target;
}

function loadWorkbook(file) {
  const entries = readZip(readFileSync(file));
  const sheetPath = findFirstSheetPath(entries);
  const sheetXml = entries.get(sheetPath)?.toString('utf8');
  if (sheetXml === undefined) throw new Error(`Worksheet ${sheetPath} not found inside ${file}`);
  const shared = parseSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8') || '');
  const grid = parseSheet(sheetXml, shared);
  return { entries, sheetPath, sheetXml, grid };
}

/** Lang-code -> column index, read from the header row (columns >= 2). */
function langColumns(grid) {
  const header = grid[0] || new Map();
  const map = new Map();
  for (const [c, cell] of header.entries()) if (c >= 2 && cell.v) map.set(String(cell.v), c);
  return map;
}
function maxColumn(grid) {
  let max = 1;
  for (const row of grid) for (const c of row.keys()) if (c > max) max = c;
  return max;
}
function headerStyle(grid) {
  for (const [, cell] of grid[0] || new Map()) if (cell.s !== undefined) return cell.s;
  return undefined;
}
function dataStyleForColumn(grid, col) {
  for (let r = 1; r < grid.length; r++) {
    const cell = grid[r]?.get(col);
    if (cell && cell.s !== undefined) return cell.s;
  }
  return undefined;
}
function setCell(grid, r, c, v) {
  if (!grid[r]) grid[r] = new Map();
  const existing = grid[r].get(c);
  grid[r].set(c, { v, s: existing ? existing.s : dataStyleForColumn(grid, c) });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
const TEMPLATES = {
  contentTypes: (hasShared) =>
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    (hasShared ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' : '') +
    '</Types>',
  rels:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>',
  workbook:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Translations" sheetId="1" r:id="rId1"/></sheets></workbook>',
  workbookRels:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    '</Relationships>',
  styles:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '</styleSheet>',
  sheet: (sheetData, dimension) =>
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="${dimension}"/>` +
    '<cols><col min="1" max="1" width="40" customWidth="1"/><col min="2" max="2" width="55" customWidth="1"/><col min="3" max="16" width="60" customWidth="1"/></cols>' +
    `${sheetData}</worksheet>`,
};

function ensureSharedStringsDeclared(entries) {
  const ctName = '[Content_Types].xml';
  const ct = entries.get(ctName)?.toString('utf8');
  if (ct && !ct.includes('sharedStrings.xml')) {
    entries.set(
      ctName,
      Buffer.from(
        ct.replace(
          '</Types>',
          '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
        ),
        'utf8',
      ),
    );
  }
  const relsName = 'xl/_rels/workbook.xml.rels';
  const rels = entries.get(relsName)?.toString('utf8');
  if (rels && !/Target="sharedStrings\.xml"/.test(rels)) {
    const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => parseInt(m[1], 10));
    const next = (ids.length ? Math.max(...ids) : 0) + 1;
    entries.set(
      relsName,
      Buffer.from(
        rels.replace(
          '</Relationships>',
          `<Relationship Id="rId${next}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
        ),
        'utf8',
      ),
    );
  }
}

function freshEntries(sheetXml, sharedXml) {
  const e = new Map();
  e.set('[Content_Types].xml', Buffer.from(TEMPLATES.contentTypes(true), 'utf8'));
  e.set('_rels/.rels', Buffer.from(TEMPLATES.rels, 'utf8'));
  e.set('xl/workbook.xml', Buffer.from(TEMPLATES.workbook, 'utf8'));
  e.set('xl/_rels/workbook.xml.rels', Buffer.from(TEMPLATES.workbookRels, 'utf8'));
  e.set('xl/styles.xml', Buffer.from(TEMPLATES.styles, 'utf8'));
  e.set('xl/sharedStrings.xml', Buffer.from(sharedXml, 'utf8'));
  e.set('xl/worksheets/sheet1.xml', Buffer.from(sheetXml, 'utf8'));
  return e;
}

function persist(file, grid, original) {
  const { sheetData, strings, totalRefs, dimension } = emitSheetAndShared(grid);
  const sharedXml = buildSharedStrings(strings, totalRefs);
  if (original) {
    const { entries, sheetPath } = original;
    let sx = original.sheetXml;
    if (/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/.test(sx)) sx = sx.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, sheetData);
    else if (/<sheetData\b[^>]*\/>/.test(sx)) sx = sx.replace(/<sheetData\b[^>]*\/>/, sheetData);
    else sx = sx.replace('</worksheet>', `${sheetData}</worksheet>`);
    if (/<dimension\b[^>]*\/>/.test(sx)) sx = sx.replace(/<dimension\b[^>]*\/>/, `<dimension ref="${dimension}"/>`);
    entries.set(sheetPath, Buffer.from(sx, 'utf8'));
    entries.set('xl/sharedStrings.xml', Buffer.from(sharedXml, 'utf8'));
    ensureSharedStringsDeclared(entries);
    writeFileSync(file, writeZip(entries));
  } else {
    writeFileSync(file, writeZip(freshEntries(TEMPLATES.sheet(sheetData, dimension), sharedXml)));
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
function buildHeaderGrid(langs) {
  const header = new Map();
  header.set(0, { v: 'Informations', s: 1 });
  header.set(1, { v: 'Key', s: 1 });
  langs.forEach((l, i) => header.set(2 + i, { v: l, s: 1 }));
  return [header];
}

function normalizeRow(o) {
  if (o.values && typeof o.values === 'object') return { info: o.info ?? '', key: o.key, values: o.values };
  const { info = '', key, ...rest } = o;
  return { info, key, values: rest };
}

function applyRows(grid, rows) {
  const langs = langColumns(grid);
  let nextCol = Math.max(1, maxColumn(grid));
  const ensureLang = (code) => {
    if (langs.has(code)) return langs.get(code);
    nextCol += 1;
    grid[0].set(nextCol, { v: code, s: headerStyle(grid) });
    langs.set(code, nextCol);
    return nextCol;
  };
  const keyRow = new Map();
  for (let r = 1; r < grid.length; r++) {
    const k = grid[r]?.get(1)?.v;
    if (k) keyRow.set(String(k), r);
  }
  let added = 0;
  let updated = 0;
  for (const raw of rows) {
    const { info, key, values } = normalizeRow(raw);
    if (!key) continue;
    let r = keyRow.get(key);
    if (r === undefined) {
      r = grid.length;
      grid[r] = new Map();
      keyRow.set(key, r);
      setCell(grid, r, 1, key);
      added++;
    } else {
      updated++;
    }
    if (info) setCell(grid, r, 0, info);
    for (const [code, val] of Object.entries(values)) {
      if (val === undefined || val === null) continue;
      setCell(grid, r, ensureLang(code), String(val));
    }
  }
  return { added, updated };
}

function readRowsInput(opts) {
  let text;
  if (opts.rows) text = readFileSync(opts.rows, 'utf8');
  else text = readFileSync(0, 'utf8'); // stdin
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : parsed.rows || [];
}

function cmdCreate(file, opts) {
  if (existsSync(file) && !opts.force) throw new Error(`${file} already exists (use --force to overwrite)`);
  const langs = opts.langs ?? ['fr'];
  persist(file, buildHeaderGrid(langs), null);
  process.stdout.write(`Created ${file} with columns: Informations, Key, ${langs.join(', ')}\n`);
}

function cmdAdd(file, opts) {
  const rows = readRowsInput(opts).map(normalizeRow);
  let original = null;
  let grid;
  if (existsSync(file)) {
    original = loadWorkbook(file);
    grid = original.grid;
  } else {
    if (!opts.create) throw new Error(`${file} does not exist (pass --create to make it)`);
    const langs = opts.langs ?? [...new Set(rows.flatMap((r) => Object.keys(r.values)))];
    grid = buildHeaderGrid(langs.length ? langs : ['fr']);
  }
  const { added, updated } = applyRows(grid, rows);
  persist(file, grid, original);
  process.stdout.write(`${file}: ${added} added, ${updated} updated (${rows.length} input rows)\n`);
}

function cmdAddLang(file, code) {
  if (!code) throw new Error('add-lang requires a language code, e.g. add-lang translations.xlsx en');
  const original = loadWorkbook(file);
  const langs = langColumns(original.grid);
  if (langs.has(code)) {
    process.stdout.write(`${file}: language column "${code}" already present\n`);
    return;
  }
  original.grid[0].set(maxColumn(original.grid) + 1, { v: code, s: headerStyle(original.grid) });
  persist(file, original.grid, original);
  process.stdout.write(`${file}: added empty language column "${code}"\n`);
}

function cmdDump(file, opts) {
  const { grid } = loadWorkbook(file);
  const langs = langColumns(grid);
  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const key = grid[r]?.get(1)?.v;
    if (!key) continue;
    const values = {};
    for (const [code, col] of langs) values[code] = grid[r].get(col)?.v ?? '';
    if (opts.missing && (values[opts.missing] ?? '') !== '') continue;
    out.push({ info: grid[r].get(0)?.v ?? '', key: String(key), values });
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') opts.force = true;
    else if (a === '--create') opts.create = true;
    else if (a === '--rows') opts.rows = argv[++i];
    else if (a === '--missing') opts.missing = argv[++i];
    else if (a === '--langs') opts.langs = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else positional.push(a);
  }
  return { positional, opts };
}

const HELP = `xlsx-i18n.mjs — manage an ngx-translate translations workbook (.xlsx)

  node xlsx-i18n.mjs create <file> [--langs fr,en] [--force]
  node xlsx-i18n.mjs dump   <file> [--missing <lang>]
  node xlsx-i18n.mjs add    <file> [--rows <rows.json>] [--create] [--langs fr,en]
  node xlsx-i18n.mjs add-lang <file> <lang>

Workbook layout: col0=Informations, col1=Key (dotted), col2+=one column per language.
Then compile with: xlsxToJsonTranslate -i <file> -o <out>/<lang>.json -l <lang> --keycolumn=1
`;

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, opts } = parseArgs(rest);
  const file = positional[0];
  try {
    switch (cmd) {
      case 'create':
        if (!file) throw new Error('create requires a <file>');
        cmdCreate(file, opts);
        break;
      case 'add':
        if (!file) throw new Error('add requires a <file>');
        cmdAdd(file, opts);
        break;
      case 'add-lang':
        if (!file) throw new Error('add-lang requires a <file>');
        cmdAddLang(file, positional[1]);
        break;
      case 'dump':
        if (!file) throw new Error('dump requires a <file>');
        cmdDump(file, opts);
        break;
      case undefined:
      case '-h':
      case '--help':
        process.stdout.write(HELP);
        break;
      default:
        process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
        process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
