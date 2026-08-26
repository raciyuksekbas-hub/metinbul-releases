// src/main/main.ts
import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, shell, clipboard, dialog } from "electron";
import * as path7 from "path";
import * as fs11 from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/db/database.ts
import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
function normalizeForSearch(text) {
  if (!text) return "";
  return text.normalize("NFC").toLocaleLowerCase("tr-TR");
}
var AppDatabase = class {
  db;
  constructor(dbPath = ":memory:") {
    if (dbPath !== ":memory:") {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.initSchema();
  }
  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        path TEXT PRIMARY KEY NOT NULL,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_areas (
        path TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        filename TEXT NOT NULL,
        extension TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL,
        content TEXT NOT NULL,
        index_status TEXT NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
      CREATE INDEX IF NOT EXISTS idx_search_areas_type ON search_areas(type);
    `);
    try {
      this.db.exec(`
        INSERT INTO search_areas (path, type, added_at)
        SELECT path, 'include', added_at FROM folders
        WHERE path NOT IN (SELECT path FROM search_areas);
      `);
    } catch {
    }
    const ftsTable = this.db.prepare(`
      SELECT sql FROM sqlite_master WHERE type='table' AND name='documents_fts'
    `).get();
    if (ftsTable) {
      if (!ftsTable.sql.toLowerCase().includes("trigram")) {
        this.db.exec(`DROP TABLE documents_fts;`);
        this.createAndPopulateFtsTable();
      }
    } else {
      this.createAndPopulateFtsTable();
    }
  }
  createAndPopulateFtsTable() {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        filename,
        content,
        tokenize = 'trigram'
      );
    `);
    const docs = this.db.prepare(`
      SELECT id, filename, content, index_status FROM documents
    `).all();
    if (docs.length > 0) {
      const insertStmt = this.db.prepare(`
        INSERT INTO documents_fts (rowid, filename, content)
        VALUES (?, ?, ?)
      `);
      const populateTx = this.db.transaction(() => {
        for (const doc of docs) {
          const content = doc.index_status === "indexed" && doc.content ? normalizeForSearch(doc.content) : "";
          insertStmt.run(doc.id, normalizeForSearch(doc.filename), content);
        }
      });
      populateTx();
    }
  }
  getSearchScopeMode() {
    try {
      const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'search_scope_mode'").get();
      if (row && (row.value === "all" || row.value === "selected")) {
        return row.value;
      }
    } catch {
    }
    return "all";
  }
  setSearchScopeMode(mode) {
    if (mode !== "all" && mode !== "selected") return;
    this.db.prepare(`
      INSERT INTO app_settings (key, value)
      VALUES ('search_scope_mode', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(mode);
  }
  getSearchAreas() {
    const rows = this.db.prepare("SELECT path, type, added_at FROM search_areas ORDER BY added_at ASC").all();
    return rows;
  }
  getIncludedFolders() {
    const rows = this.db.prepare("SELECT path FROM search_areas WHERE type = 'include' ORDER BY added_at ASC").all();
    return rows.map((r) => r.path);
  }
  getExcludedFolders() {
    const rows = this.db.prepare("SELECT path FROM search_areas WHERE type = 'exclude' ORDER BY added_at ASC").all();
    return rows.map((r) => r.path);
  }
  addSearchArea(folderPath, type) {
    const resolvedPath = path.resolve(folderPath);
    this.db.prepare(`
      INSERT INTO search_areas (path, type, added_at)
      VALUES (?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET type = excluded.type, added_at = excluded.added_at
    `).run(resolvedPath, type, Date.now());
    if (type === "include") {
      this.db.prepare(`
        INSERT INTO folders (path, added_at)
        VALUES (?, ?)
        ON CONFLICT(path) DO NOTHING
      `).run(resolvedPath, Date.now());
    } else if (type === "exclude") {
      this.db.prepare("DELETE FROM folders WHERE path = ?").run(resolvedPath);
      this.removeDocumentsInFolder(resolvedPath);
    }
  }
  removeSearchArea(folderPath) {
    const resolvedPath = path.resolve(folderPath);
    this.db.prepare("DELETE FROM search_areas WHERE path = ?").run(resolvedPath);
    this.db.prepare("DELETE FROM folders WHERE path = ?").run(resolvedPath);
  }
  removeDocumentsInFolder(folderPath) {
    const norm = path.resolve(folderPath);
    const deleteTx = this.db.transaction(() => {
      const docs = this.db.prepare(`
        SELECT id FROM documents WHERE path = ? OR path LIKE ? OR path LIKE ?
      `).all(norm, `${norm}/%`, `${norm}\\%`);
      if (docs.length > 0) {
        const ids = docs.map((d) => d.id);
        const placeholders = ids.map(() => "?").join(",");
        this.db.prepare(`DELETE FROM documents_fts WHERE rowid IN (${placeholders})`).run(...ids);
        this.db.prepare(`DELETE FROM documents WHERE id IN (${placeholders})`).run(...ids);
      }
    });
    deleteTx();
  }
  getFolders() {
    return this.getIncludedFolders();
  }
  addFolder(folderPath) {
    this.addSearchArea(folderPath, "include");
  }
  removeFolder(folderPath) {
    const resolvedPath = path.resolve(folderPath);
    this.removeDocumentsInFolder(resolvedPath);
    this.removeSearchArea(resolvedPath);
  }
  getDocumentByPath(docPath) {
    return this.db.prepare("SELECT * FROM documents WHERE path = ?").get(docPath);
  }
  getAllDocuments() {
    return this.db.prepare("SELECT * FROM documents").all();
  }
  getDocumentsInFolder(folderPath) {
    return this.db.prepare(`
      SELECT * FROM documents WHERE path = ? OR path LIKE ? OR path LIKE ?
    `).all(folderPath, `${folderPath}/%`, `${folderPath}\\%`);
  }
  upsertDocument(doc) {
    const upsertTx = this.db.transaction(() => {
      const existing = this.db.prepare("SELECT id FROM documents WHERE path = ?").get(doc.path);
      const now = Date.now();
      let rowId;
      if (existing) {
        rowId = existing.id;
        this.db.prepare(`
          UPDATE documents
          SET filename = ?, extension = ?, mtime = ?, size = ?, content = ?, index_status = ?, indexed_at = ?
          WHERE id = ?
        `).run(doc.filename, doc.extension, doc.mtime, doc.size, doc.content, doc.index_status, now, rowId);
        this.db.prepare("DELETE FROM documents_fts WHERE rowid = ?").run(rowId);
      } else {
        const info = this.db.prepare(`
          INSERT INTO documents (path, filename, extension, mtime, size, content, index_status, indexed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(doc.path, doc.filename, doc.extension, doc.mtime, doc.size, doc.content, doc.index_status, now);
        rowId = Number(info.lastInsertRowid);
      }
      if (doc.index_status === "indexed" && doc.content) {
        this.db.prepare(`
          INSERT INTO documents_fts (rowid, filename, content)
          VALUES (?, ?, ?)
        `).run(
          rowId,
          normalizeForSearch(doc.filename),
          normalizeForSearch(doc.content)
        );
      } else if (doc.index_status === "no_text" || doc.index_status === "failed") {
        this.db.prepare(`
          INSERT INTO documents_fts (rowid, filename, content)
          VALUES (?, ?, ?)
        `).run(
          rowId,
          normalizeForSearch(doc.filename),
          ""
        );
      }
    });
    upsertTx();
  }
  deleteDocuments(paths) {
    if (paths.length === 0) return;
    const deleteTx = this.db.transaction(() => {
      const placeholders = paths.map(() => "?").join(",");
      const docs = this.db.prepare(`SELECT id FROM documents WHERE path IN (${placeholders})`).all(...paths);
      if (docs.length > 0) {
        const ids = docs.map((d) => d.id);
        const idPlaceholders = ids.map(() => "?").join(",");
        this.db.prepare(`DELETE FROM documents_fts WHERE rowid IN (${idPlaceholders})`).run(...ids);
        this.db.prepare(`DELETE FROM documents WHERE id IN (${idPlaceholders})`).run(...ids);
      }
    });
    deleteTx();
  }
  close() {
    this.db.close();
  }
};

// src/scanner/scanner.ts
import * as fs7 from "fs";
import * as path3 from "path";
import * as os from "os";

// src/extractors/index.ts
import * as path2 from "path";
import * as fs6 from "fs";

// src/extractors/docx.ts
import mammoth from "mammoth";
import * as fs2 from "fs";
async function extractDocx(filePath) {
  if (!fs2.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return (result.value || "").trim();
  } catch (error) {
    throw new Error(`Failed to extract DOCX (${filePath}): ${error?.message || error}`);
  }
}

// src/extractors/pdf.ts
import * as fs3 from "fs";
async function extractPdf(filePath) {
  if (!fs3.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const dataBuffer = fs3.readFileSync(filePath);
  try {
    const pdfModule = await import("pdf-parse");
    const pdf = pdfModule.default || pdfModule;
    if (pdf.PDFParse || pdfModule.PDFParse) {
      const PDFParseClass = pdf.PDFParse || pdfModule.PDFParse;
      const parser = new PDFParseClass({ data: dataBuffer });
      try {
        const result = await parser.getText();
        if (result && Array.isArray(result.pages)) {
          return result.pages.map((p) => p.text || "").join("\n").trim();
        }
        return (result?.text || "").trim();
      } finally {
        if (typeof parser.destroy === "function") {
          await parser.destroy();
        }
      }
    } else if (typeof pdf === "function") {
      const data = await pdf(dataBuffer);
      return (data.text || "").trim();
    } else {
      throw new Error("Unsupported pdf-parse module interface");
    }
  } catch (error) {
    throw new Error(`Failed to extract PDF (${filePath}): ${error?.message || error}`);
  }
}

// src/extractors/doc.ts
import * as fs4 from "fs";
import WordExtractor from "word-extractor";
var extractor = new WordExtractor();
async function extractDoc(filePath) {
  if (!fs4.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  try {
    const extracted = await extractor.extract(filePath);
    const body = extracted.getBody() || "";
    return body.trim();
  } catch (error) {
    throw new Error(`Failed to extract DOC (${filePath}): ${error?.message || error}`);
  }
}

// src/extractors/udf.ts
import * as fs5 from "fs";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
var xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  cdataPropName: "__cdata"
});
function collectTextFromXmlObject(node, list = []) {
  if (node === null || node === void 0) {
    return list;
  }
  if (typeof node === "string") {
    const trimmed = node.trim();
    if (trimmed) {
      list.push(trimmed);
    }
  } else if (typeof node === "number" || typeof node === "boolean") {
    list.push(String(node));
  } else if (Array.isArray(node)) {
    for (const item of node) {
      collectTextFromXmlObject(item, list);
    }
  } else if (typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("@_")) {
        continue;
      }
      collectTextFromXmlObject(value, list);
    }
  }
  return list;
}
async function extractUdf(filePath) {
  if (!fs5.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  try {
    let xmlContent = "";
    try {
      const zip = new AdmZip(filePath);
      const zipEntries = zip.getEntries();
      let contentEntry = zipEntries.find((e) => e.entryName.toLowerCase() === "content.xml");
      if (!contentEntry) {
        contentEntry = zipEntries.find((e) => e.entryName.toLowerCase().endsWith(".xml"));
      }
      if (contentEntry) {
        xmlContent = contentEntry.getData().toString("utf8");
      }
    } catch {
    }
    if (!xmlContent) {
      const rawContent = fs5.readFileSync(filePath, "utf8");
      if (rawContent.trim().startsWith("<")) {
        xmlContent = rawContent;
      }
    }
    if (!xmlContent) {
      throw new Error("Invalid UDF file format: No XML content found inside archive or file");
    }
    const parsedXml = xmlParser.parse(xmlContent);
    const textPieces = collectTextFromXmlObject(parsedXml);
    return textPieces.join(" ").trim();
  } catch (error) {
    throw new Error(`Failed to extract UDF (${filePath}): ${error?.message || error}`);
  }
}

// src/extractors/index.ts
var SUPPORTED_EXTENSIONS = /* @__PURE__ */ new Set([".doc", ".docx", ".pdf", ".udf"]);
async function extract(filePath) {
  if (!fs6.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const ext = path2.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file extension '${ext}' for file: ${filePath}`);
  }
  switch (ext) {
    case ".docx":
      return await extractDocx(filePath);
    case ".pdf":
      return await extractPdf(filePath);
    case ".doc":
      return await extractDoc(filePath);
    case ".udf":
      return await extractUdf(filePath);
    default:
      throw new Error(`Unhandled supported extension '${ext}' for file: ${filePath}`);
  }
}

// src/scanner/scanner.ts
var EXCLUDED_DIR_NAMES = /* @__PURE__ */ new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  ".trash",
  ".trashes",
  ".spotlight-v100",
  ".fseventsd",
  ".npm",
  ".pnpm-store",
  ".yarn",
  ".cargo",
  ".rustup",
  ".venv",
  "venv",
  "env",
  ".cache",
  "caches",
  "application support",
  "containers",
  "logs",
  "applications"
]);
function isPathOrSubpath(parent, candidate) {
  if (!parent || !candidate) return false;
  const normParent = path3.resolve(parent).replace(/\\/g, "/").replace(/\/+$/, "");
  const normCandidate = path3.resolve(candidate).replace(/\\/g, "/");
  if (process.platform === "win32" || parent.includes(":") || candidate.includes(":")) {
    const p = normParent.toLowerCase();
    const c = normCandidate.toLowerCase();
    return c === p || c.startsWith(p + "/");
  } else {
    const p = normParent;
    const c = normCandidate;
    return c === p || c.startsWith(p + "/");
  }
}
function isPathExcluded(candidatePath, excludedPaths = []) {
  if (!excludedPaths || excludedPaths.length === 0) return false;
  return excludedPaths.some((excluded) => isPathOrSubpath(excluded, candidatePath));
}
function shouldSkipFile(filename) {
  const lower = filename.toLowerCase();
  if (filename.startsWith("~$")) {
    return true;
  }
  if (lower.endsWith(".tmp")) {
    return true;
  }
  if (filename.startsWith("._") || lower === ".ds_store" || lower === "thumbs.db") {
    return true;
  }
  return false;
}
function shouldSkipDirectory(dirName, fullPath, excludedPaths = []) {
  const lowerName = dirName.toLowerCase();
  if (EXCLUDED_DIR_NAMES.has(lowerName)) {
    return true;
  }
  if (lowerName.endsWith(".app")) {
    return true;
  }
  const home = os.homedir();
  const libraryPath = path3.join(home, "Library");
  if (fullPath.toLowerCase() === libraryPath.toLowerCase()) {
    return true;
  }
  if (isPathExcluded(fullPath, excludedPaths)) {
    return true;
  }
  return false;
}
async function scanDirectory(dirPath, visitedDirs = /* @__PURE__ */ new Set(), excludedPaths = []) {
  const results = [];
  let realRoot;
  try {
    if (!fs7.existsSync(dirPath)) {
      return results;
    }
    realRoot = fs7.realpathSync(dirPath);
  } catch {
    return results;
  }
  if (isPathExcluded(dirPath, excludedPaths) || isPathExcluded(realRoot, excludedPaths)) {
    return results;
  }
  if (visitedDirs.has(realRoot)) {
    return results;
  }
  visitedDirs.add(realRoot);
  async function walk(currentDir) {
    let entries;
    try {
      entries = await fs7.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (shouldSkipFile(entry.name)) {
        continue;
      }
      const fullPath = path3.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name, fullPath, excludedPaths)) {
          continue;
        }
        try {
          const realSub = await fs7.promises.realpath(fullPath);
          if (!visitedDirs.has(realSub)) {
            visitedDirs.add(realSub);
            await walk(fullPath);
          }
        } catch {
        }
      } else if (entry.isSymbolicLink()) {
        try {
          const stat = await fs7.promises.stat(fullPath);
          if (stat.isDirectory()) {
            if (!shouldSkipDirectory(entry.name, fullPath, excludedPaths)) {
              const realSub = await fs7.promises.realpath(fullPath);
              if (!visitedDirs.has(realSub)) {
                visitedDirs.add(realSub);
                await walk(fullPath);
              }
            }
          } else if (stat.isFile()) {
            const ext = path3.extname(entry.name).toLowerCase();
            if (SUPPORTED_EXTENSIONS.has(ext)) {
              results.push({
                path: fullPath,
                filename: entry.name,
                extension: ext,
                mtime: Math.floor(stat.mtimeMs),
                size: stat.size
              });
            }
          }
        } catch {
        }
      } else if (entry.isFile()) {
        const ext = path3.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          try {
            const stats = await fs7.promises.stat(fullPath);
            results.push({
              path: fullPath,
              filename: entry.name,
              extension: ext,
              mtime: Math.floor(stats.mtimeMs),
              size: stats.size
            });
          } catch {
          }
        }
      }
    }
  }
  await walk(dirPath);
  return results;
}
async function scanDirectories(dirPaths, excludedPaths = []) {
  const seenPaths = /* @__PURE__ */ new Set();
  const visitedDirs = /* @__PURE__ */ new Set();
  const combined = [];
  for (const dir of dirPaths) {
    const files = await scanDirectory(dir, visitedDirs, excludedPaths);
    for (const file of files) {
      if (!seenPaths.has(file.path)) {
        seenPaths.add(file.path);
        combined.push(file);
      }
    }
  }
  return combined;
}

// src/search/search.ts
function isDocumentInScope(docPath, mode, includedPaths, excludedPaths) {
  if (excludedPaths.length > 0 && isPathExcluded(docPath, excludedPaths)) {
    return false;
  }
  if (mode === "selected") {
    if (includedPaths.length === 0) {
      return false;
    }
    return includedPaths.some((folder) => isPathOrSubpath(folder, docPath));
  }
  return true;
}
function buildFtsQuery(userQuery) {
  if (!userQuery || !userQuery.trim()) {
    return null;
  }
  const normalized = normalizeForSearch(userQuery);
  const clean = normalized.replace(/[\"']/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length < 3) {
    return null;
  }
  return `"${clean}"`;
}
function search(query, appDb, limit = 100, scopeOrExcluded) {
  if (!query || !query.trim()) {
    return [];
  }
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) {
    return [];
  }
  let mode = appDb.getSearchScopeMode();
  let includedPaths = appDb.getIncludedFolders();
  let excludedPaths = appDb.getExcludedFolders();
  if (Array.isArray(scopeOrExcluded)) {
    excludedPaths = scopeOrExcluded;
  } else if (scopeOrExcluded && typeof scopeOrExcluded === "object") {
    if (scopeOrExcluded.mode !== void 0) mode = scopeOrExcluded.mode;
    if (scopeOrExcluded.includedPaths !== void 0) includedPaths = scopeOrExcluded.includedPaths;
    if (scopeOrExcluded.excludedPaths !== void 0) excludedPaths = scopeOrExcluded.excludedPaths;
  }
  if (mode === "selected" && includedPaths.length === 0) {
    return [];
  }
  try {
    const sql = `
      SELECT 
        d.id,
        d.path,
        d.filename,
        d.extension,
        d.index_status,
        snippet(documents_fts, -1, '<mark>', '</mark>', '\u2026', 15) AS snippet
      FROM documents_fts
      JOIN documents d ON d.id = documents_fts.rowid
      WHERE documents_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `;
    const fetchLimit = 1e3;
    const rows = appDb.db.prepare(sql).all(ftsQuery, fetchLimit);
    const results = [];
    for (const r of rows) {
      if (!isDocumentInScope(r.path, mode, includedPaths, excludedPaths)) {
        continue;
      }
      results.push({
        id: r.id,
        filename: r.filename,
        path: r.path,
        extension: r.extension,
        snippet: r.snippet || r.filename,
        index_status: r.index_status
      });
      if (results.length >= limit) {
        break;
      }
    }
    return results;
  } catch (error) {
    return [];
  }
}

// src/search/indexer.ts
import * as path5 from "path";
import * as fs9 from "fs";

// src/scanner/roots.ts
import * as os2 from "os";
import * as path4 from "path";
import * as fs8 from "fs";
async function discoverSearchRoots() {
  const home = os2.homedir();
  const roots = [];
  const realPaths = /* @__PURE__ */ new Set();
  function addRoot(targetPath) {
    try {
      if (!targetPath || !fs8.existsSync(targetPath)) {
        return;
      }
      const real = fs8.realpathSync(targetPath);
      if (!realPaths.has(real)) {
        realPaths.add(real);
        roots.push(real);
      }
    } catch {
    }
  }
  addRoot(home);
  if (process.platform === "darwin") {
    const icloudDocs = path4.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
    addRoot(icloudDocs);
    const cloudStorage = path4.join(home, "Library", "CloudStorage");
    if (fs8.existsSync(cloudStorage)) {
      try {
        const cloudEntries = fs8.readdirSync(cloudStorage, { withFileTypes: true });
        for (const entry of cloudEntries) {
          if (entry.isDirectory()) {
            addRoot(path4.join(cloudStorage, entry.name));
          }
        }
      } catch {
      }
    }
    const volumesDir = "/Volumes";
    if (fs8.existsSync(volumesDir)) {
      try {
        let rootReal = "/";
        try {
          rootReal = fs8.realpathSync("/");
        } catch {
        }
        const volumeEntries = fs8.readdirSync(volumesDir, { withFileTypes: true });
        for (const entry of volumeEntries) {
          const volumePath = path4.join(volumesDir, entry.name);
          try {
            if (fs8.existsSync(volumePath)) {
              const real = fs8.realpathSync(volumePath);
              if (real === "/" || real === rootReal) {
                continue;
              }
              addRoot(volumePath);
            }
          } catch {
          }
        }
      } catch {
      }
    }
  }
  return roots;
}

// src/search/indexer.ts
async function indexFolders(folders, appDb, onProgress, excludedPaths = []) {
  const summary = {
    scanned: 0,
    indexed: 0,
    skipped: 0,
    failed: 0,
    removed: 0
  };
  if (folders.length === 0) {
    onProgress?.({ total: 0, current: 0, status: "completed" });
    return summary;
  }
  onProgress?.({ total: 0, current: 0, status: "scanning" });
  const scannedFiles = await scanDirectories(folders, excludedPaths);
  summary.scanned = scannedFiles.length;
  const scannedPathSet = new Set(scannedFiles.map((f) => f.path));
  const allDbDocs = appDb.getAllDocuments();
  const pathsToRemove = [];
  for (const doc of allDbDocs) {
    if (isPathExcluded(doc.path, excludedPaths)) {
      pathsToRemove.push(doc.path);
      continue;
    }
    const belongsToMonitoredFolder = folders.some((folder) => isPathOrSubpath(folder, doc.path));
    if (belongsToMonitoredFolder && !scannedPathSet.has(doc.path)) {
      try {
        const parentDir = path5.dirname(doc.path);
        if (fs9.existsSync(parentDir)) {
          pathsToRemove.push(doc.path);
        }
      } catch {
      }
    }
  }
  if (pathsToRemove.length > 0) {
    appDb.deleteDocuments(pathsToRemove);
    summary.removed = pathsToRemove.length;
  }
  let currentIdx = 0;
  for (const file of scannedFiles) {
    currentIdx++;
    onProgress?.({
      total: scannedFiles.length,
      current: currentIdx,
      currentFile: file.filename,
      status: "indexing"
    });
    const existing = appDb.getDocumentByPath(file.path);
    if (existing && existing.mtime === file.mtime && existing.size === file.size && (existing.index_status === "indexed" || existing.index_status === "no_text")) {
      summary.skipped++;
      continue;
    }
    let content = "";
    let status = "indexed";
    try {
      content = await extract(file.path);
      if (!content || !content.trim()) {
        status = "no_text";
      } else {
        status = "indexed";
      }
    } catch {
      status = "failed";
      content = "";
      summary.failed++;
    }
    const docRecord = {
      path: file.path,
      filename: file.filename,
      extension: file.extension,
      mtime: file.mtime,
      size: file.size,
      content,
      index_status: status
    };
    appDb.upsertDocument(docRecord);
    if (status !== "failed") {
      summary.indexed++;
    }
  }
  onProgress?.({
    total: scannedFiles.length,
    current: scannedFiles.length,
    status: "completed"
  });
  return summary;
}
async function indexAccessibleDocuments(appDb, onProgress) {
  const mode = appDb.getSearchScopeMode();
  const excludedPaths = appDb.getExcludedFolders();
  if (mode === "selected") {
    const customIncludes = appDb.getIncludedFolders();
    if (customIncludes.length === 0) {
      onProgress?.({ total: 0, current: 0, status: "completed" });
      return { scanned: 0, indexed: 0, skipped: 0, failed: 0, removed: 0 };
    }
    return await indexFolders(customIncludes, appDb, onProgress, excludedPaths);
  } else {
    const defaultRoots = await discoverSearchRoots();
    return await indexFolders(defaultRoots, appDb, onProgress, excludedPaths);
  }
}

// src/main/about-info.ts
import * as fs10 from "fs";
import * as path6 from "path";
import { fileURLToPath } from "url";
var DEVELOPER_NAME = "Raci \xC7etin Y\xFCksekba\u015F";
var FEEDBACK_EMAIL = "raci@yuksekbas.av.tr";
function getPackageVersion() {
  try {
    const __filename2 = fileURLToPath(import.meta.url);
    const __dirname2 = path6.dirname(__filename2);
    let currentDir = __dirname2;
    for (let i = 0; i < 4; i++) {
      const pkgPath = path6.join(currentDir, "package.json");
      if (fs10.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs10.readFileSync(pkgPath, "utf-8"));
        if (pkg.version) {
          return pkg.version;
        }
      }
      currentDir = path6.dirname(currentDir);
    }
  } catch {
  }
  return "0.1.0";
}
function getCopyrightText(currentYear = (/* @__PURE__ */ new Date()).getFullYear()) {
  if (currentYear > 2026) {
    return `\xA9 2026\u2013${currentYear} ${DEVELOPER_NAME}. T\xFCm haklar\u0131 sakl\u0131d\u0131r.`;
  }
  return `\xA9 2026 ${DEVELOPER_NAME}. T\xFCm haklar\u0131 sakl\u0131d\u0131r.`;
}
function getFeedbackMailto(version = getPackageVersion()) {
  const subject = encodeURIComponent("MetinBul Geribildirim");
  const body = encodeURIComponent(`MetinBul s\xFCr\xFCm\xFC: ${version}

`);
  return `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
}
function getAboutMetadata() {
  const version = getPackageVersion();
  const mailtoUrl = getFeedbackMailto(version);
  return {
    name: "MetinBul",
    version,
    shortDescription: "Bilgisayar\u0131n\u0131zdaki DOC, DOCX, PDF ve UDF belgelerinin metin i\xE7eriklerinde yerel olarak arama yapan masa\xFCst\xFC arac\u0131.",
    copyright: getCopyrightText(),
    copyrightNote: "MetinBul\u2019un kaynak kodu, g\xF6rsel kimli\u011Fi ve da\u011F\u0131t\u0131m paketleri \xFCzerindeki haklar sakl\u0131d\u0131r.",
    developerName: DEVELOPER_NAME,
    feedback: {
      text: "MetinBul ile ilgili hata bildirimlerinizi, \xF6nerilerinizi ve kullan\u0131m deneyiminizi payla\u015Fabilirsiniz.",
      email: FEEDBACK_EMAIL,
      mailtoUrl
    }
  };
}

// src/main/updater.ts
var GITHUB_REPO = "raciyuksekbas-hub/metinbul-releases";
function compareVersions(v1, v2) {
  const clean1 = (v1 || "").replace(/^[vV]/, "").trim();
  const clean2 = (v2 || "").replace(/^[vV]/, "").trim();
  const parts1 = clean1.split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const parts2 = clean2.split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(parts1.length, parts2.length, 3);
  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}
async function checkForUpdates(currentVersion, options) {
  const repo = options?.repo || GITHUB_REPO;
  const fetchImpl = options?.fetchFn || globalThis.fetch;
  if (!fetchImpl) {
    return {
      updateAvailable: false,
      currentVersion,
      status: "unreachable",
      message: "A\u011F istemcisi bulunamad\u0131."
    };
  }
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": `MetinBul-App/${currentVersion}`
      }
    });
    if (response.status === 404 || response.status === 401 || response.status === 403) {
      return {
        updateAvailable: false,
        currentVersion,
        status: "unreachable",
        message: "GitHub s\xFCr\xFCm bilgisine eri\u015Filemedi (Depo \xF6zel veya hen\xFCz release yay\u0131nlanmam\u0131\u015F)."
      };
    }
    if (!response.ok) {
      return {
        updateAvailable: false,
        currentVersion,
        status: "unreachable",
        message: `G\xFCncelleme kontrol\xFC ba\u015Far\u0131s\u0131z oldu (HTTP ${response.status}).`
      };
    }
    const data = await response.json();
    if (!data || typeof data !== "object") {
      return {
        updateAvailable: false,
        currentVersion,
        status: "error",
        message: "Ge\xE7ersiz sunucu yan\u0131t\u0131."
      };
    }
    if (data.draft || data.prerelease) {
      return {
        updateAvailable: false,
        currentVersion,
        status: "up_to_date",
        message: `MetinBul g\xFCncel (v${currentVersion}).`
      };
    }
    const rawTag = data.tag_name || data.name || "";
    const latestVersion = rawTag.replace(/^[vV]/, "").trim();
    if (!latestVersion) {
      return {
        updateAvailable: false,
        currentVersion,
        status: "up_to_date",
        message: `MetinBul g\xFCncel (v${currentVersion}).`
      };
    }
    const comparison = compareVersions(latestVersion, currentVersion);
    if (comparison > 0) {
      return {
        updateAvailable: true,
        currentVersion,
        latestVersion,
        releaseName: data.name || `MetinBul ${latestVersion}`,
        releaseNotes: data.body || "",
        releaseUrl: data.html_url || `https://github.com/${repo}/releases/tag/${rawTag}`,
        publishedAt: data.published_at,
        status: "update_available",
        message: `MetinBul ${latestVersion} kullan\u0131labilir.`
      };
    }
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion,
      status: "up_to_date",
      message: `MetinBul g\xFCncel (v${currentVersion}).`
    };
  } catch (error) {
    return {
      updateAvailable: false,
      currentVersion,
      status: "unreachable",
      message: "G\xFCncelleme sunucusuna ba\u011Flan\u0131lamad\u0131."
    };
  }
}

// src/shared/theme.ts
var DEFAULT_THEME = "dark";
function isValidTheme(theme) {
  return theme === "dark" || theme === "light";
}
function getThemeBackgroundColor(theme) {
  return theme === "dark" ? "#1a1d20" : "#f4f5f5";
}

// src/main/main.ts
var __filename = fileURLToPath2(import.meta.url);
var __dirname = path7.dirname(__filename);
var iconPath = path7.join(__dirname, "assets/icon.icns");
app.name = "MetinBul";
var mainWindow = null;
var db = null;
var isIndexing = false;
var currentTheme = DEFAULT_THEME;
function getDb() {
  if (!db) {
    const userDataPath = app.getPath("userData");
    const dbPath = path7.join(userDataPath, "metinbul.db");
    db = new AppDatabase(dbPath);
  }
  return db;
}
function showAboutInMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("app:showAboutDialog");
  }
}
function showSearchAreasInMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("app:showSearchAreasDialog");
  }
}
function triggerManualUpdateCheck() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("app:triggerCheckUpdates");
  }
}
function setAppTheme(theme) {
  if (!isValidTheme(theme)) return;
  currentTheme = theme;
  nativeTheme.themeSource = theme;
  const bgColor = getThemeBackgroundColor(theme);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(bgColor);
    mainWindow.webContents.send("app:themeChanged", theme);
  }
  setupAppMenu();
}
function setupAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...isMac ? [{
      label: app.name,
      submenu: [
        {
          label: "MetinBul Hakk\u0131nda",
          click: () => showAboutInMainWindow()
        },
        {
          label: "G\xFCncellemeleri Denetle\u2026",
          click: () => triggerManualUpdateCheck()
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide", label: "MetinBul\u2019u Gizle" },
        { role: "hideOthers", label: "Di\u011Ferlerini Gizle" },
        { role: "unhide", label: "T\xFCm\xFCn\xFC G\xF6ster" },
        { type: "separator" },
        { role: "quit", label: "MetinBul\u2019dan \xC7\u0131k" }
      ]
    }] : [],
    {
      label: "Dosya",
      submenu: [
        {
          label: "Arama Alanlar\u0131\u2026",
          accelerator: "CmdOrCtrl+Shift+F",
          click: () => showSearchAreasInMainWindow()
        },
        { type: "separator" },
        isMac ? { role: "close", label: "Pencereyi Kapat" } : { role: "quit", label: "\xC7\u0131k\u0131\u015F" }
      ]
    },
    {
      label: "D\xFCzen",
      submenu: [
        { role: "undo", label: "Geri Al" },
        { role: "redo", label: "Yinele" },
        { type: "separator" },
        { role: "cut", label: "Kes" },
        { role: "copy", label: "Kopyala" },
        { role: "paste", label: "Yap\u0131\u015Ft\u0131r" },
        { role: "selectAll", label: "T\xFCm\xFCn\xFC Se\xE7" }
      ]
    },
    {
      label: "G\xF6r\xFCn\xFCm",
      submenu: [
        {
          label: "Tema",
          submenu: [
            {
              label: "Koyu",
              type: "radio",
              checked: currentTheme === "dark",
              click: () => setAppTheme("dark")
            },
            {
              label: "A\xE7\u0131k",
              type: "radio",
              checked: currentTheme === "light",
              click: () => setAppTheme("light")
            }
          ]
        },
        { type: "separator" },
        { role: "resetZoom", label: "Ger\xE7ek Boyut" },
        { role: "zoomIn", label: "B\xFCy\xFCt" },
        { role: "zoomOut", label: "K\xFC\xE7\xFClt" }
      ]
    },
    {
      label: "Pencere",
      submenu: [
        { role: "minimize", label: "Simge Durumuna K\xFC\xE7\xFClt" },
        { role: "zoom", label: "B\xFCy\xFCt" },
        ...isMac ? [
          { type: "separator" },
          { role: "front", label: "T\xFCm\xFCn\xFC \xD6ne Getir" }
        ] : []
      ]
    },
    {
      label: "Yard\u0131m",
      submenu: [
        {
          label: "G\xFCncellemeleri Denetle\u2026",
          click: () => triggerManualUpdateCheck()
        },
        { type: "separator" },
        {
          label: "MetinBul Hakk\u0131nda",
          click: () => showAboutInMainWindow()
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
function createWindow() {
  nativeTheme.themeSource = currentTheme;
  const initialBg = getThemeBackgroundColor(currentTheme);
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 700,
    minHeight: 500,
    title: "MetinBul",
    icon: iconPath,
    backgroundColor: initialBg,
    webPreferences: {
      preload: path7.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
  mainWindow.loadFile(path7.join(__dirname, "renderer/index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
async function triggerIndexing() {
  if (isIndexing) return;
  const appDb = getDb();
  isIndexing = true;
  try {
    await indexAccessibleDocuments(appDb, (progress) => {
      mainWindow?.webContents.send("index:progress", progress);
    });
  } catch (error) {
    console.error("Indexing error:", error);
  } finally {
    isIndexing = false;
  }
}
app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock?.setIcon(nativeImage.createFromPath(iconPath));
  }
  setupAppMenu();
  const appDb = getDb();
  const INACCESSIBLE_FILE_ERROR = "Bu dosyaya \u015Fu anda eri\u015Filemiyor. Dosya ta\u015F\u0131nm\u0131\u015F, silinmi\u015F veya ilgili s\xFCr\xFCc\xFC ba\u011Fl\u0131 olmayabilir.";
  ipcMain.handle("app:getDocumentCount", () => {
    return appDb.getAllDocuments().filter((d) => d.index_status === "indexed").length;
  });
  ipcMain.handle("app:rescan", async () => {
    await triggerIndexing();
    return true;
  });
  ipcMain.handle("app:search", (_event, query) => {
    return search(query, appDb, 100);
  });
  ipcMain.handle("app:getSearchScopeMode", () => {
    return appDb.getSearchScopeMode();
  });
  ipcMain.handle("app:setSearchScopeMode", async (_event, mode) => {
    try {
      appDb.setSearchScopeMode(mode);
      triggerIndexing();
      return true;
    } catch (err) {
      console.error("Failed to set search scope mode:", err);
      return false;
    }
  });
  ipcMain.handle("app:getSearchAreas", () => {
    return appDb.getSearchAreas();
  });
  ipcMain.handle("app:addSearchArea", async (_event, folderPath, type) => {
    try {
      if (!folderPath || typeof folderPath !== "string") return false;
      appDb.addSearchArea(folderPath, type);
      triggerIndexing();
      return true;
    } catch (err) {
      console.error("Failed to add search area:", err);
      return false;
    }
  });
  ipcMain.handle("app:removeSearchArea", async (_event, folderPath) => {
    try {
      if (!folderPath || typeof folderPath !== "string") return false;
      appDb.removeSearchArea(folderPath);
      triggerIndexing();
      return true;
    } catch (err) {
      console.error("Failed to remove search area:", err);
      return false;
    }
  });
  ipcMain.handle("app:selectFolder", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Arama Alan\u0131 Se\xE7"
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
  ipcMain.handle("app:openFile", async (_event, filePath) => {
    try {
      if (!filePath || !fs11.existsSync(filePath)) {
        return { success: false, error: INACCESSIBLE_FILE_ERROR };
      }
      const error = await shell.openPath(filePath);
      if (error) {
        return { success: false, error: INACCESSIBLE_FILE_ERROR };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: INACCESSIBLE_FILE_ERROR };
    }
  });
  ipcMain.handle("app:showInFolder", (_event, filePath) => {
    try {
      if (!filePath || !fs11.existsSync(filePath)) {
        return { success: false, error: INACCESSIBLE_FILE_ERROR };
      }
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: INACCESSIBLE_FILE_ERROR };
    }
  });
  ipcMain.handle("app:getAboutInfo", () => {
    return getAboutMetadata();
  });
  ipcMain.handle("app:openExternal", async (_event, url) => {
    try {
      if (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:")) {
        await shell.openExternal(url);
        return { success: true };
      }
      return { success: false, error: "Invalid URL protocol" };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  });
  ipcMain.handle("app:sendFeedback", async () => {
    const mailtoUrl = getFeedbackMailto();
    if (mailtoUrl) {
      await shell.openExternal(mailtoUrl);
      return { success: true };
    }
    return { success: false, error: "Feedback target is not configured" };
  });
  ipcMain.handle("app:copyToClipboard", (_event, text) => {
    try {
      if (typeof text === "string") {
        clipboard.writeText(text);
        return { success: true };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  });
  ipcMain.handle("app:getTheme", () => {
    return currentTheme;
  });
  ipcMain.handle("app:setTheme", (_event, theme) => {
    setAppTheme(theme);
    return true;
  });
  ipcMain.handle("app:checkForUpdates", async (_event) => {
    const version = getPackageVersion();
    return checkForUpdates(version);
  });
  createWindow();
  setTimeout(() => {
    triggerIndexing();
  }, 500);
  setTimeout(async () => {
    try {
      const version = getPackageVersion();
      const result = await checkForUpdates(version);
      if (result.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("app:updateAvailable", result);
      }
    } catch {
    }
  }, 3e3);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (db) {
      db.close();
      db = null;
    }
    app.quit();
  }
});
app.on("before-quit", () => {
  if (db) {
    db.close();
    db = null;
  }
});
