import fs from "node:fs";
import path from "node:path";
import { fromExtendedJson } from "./ejson";

export type ExportedDoc = Record<string, unknown> & { id: string };

export const EXPORTED_COLLECTIONS = [
  "Plan",
  "SiteContent",
  "Document",
  "Embedding",
] as const;

export type ExportedCollection = (typeof EXPORTED_COLLECTIONS)[number];

export type Exports = Record<ExportedCollection, ExportedDoc[]>;

/**
 * MongoDB Compass names exports `<database>.<Collection>.json`, and adds
 * ` (2)`, ` (3)`, ... when the file already exists. Returns the collection name,
 * or null for any file that is not one of those exports (for example
 * credentials files), so such files are never opened.
 */
export function collectionOfFile(fileName: string): ExportedCollection | null {
  if (!/\.json$/i.test(fileName)) return null;

  const base = fileName.replace(/\.json$/i, "").replace(/\s*\(\d+\)$/, "");
  const dot = base.indexOf(".");
  if (dot === -1) return null;

  const collection = base.slice(dot + 1).toLowerCase();
  return (
    EXPORTED_COLLECTIONS.find((name) => name.toLowerCase() === collection) ??
    null
  );
}

function parseDocuments(raw: string): Record<string, unknown>[] {
  const text = raw.replace(/^﻿/, "").trim();

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Newline-delimited JSON, as written by `mongoexport`.
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
  }
}

function withStringId(doc: Record<string, unknown>): ExportedDoc {
  const { _id, ...rest } = fromExtendedJson(doc) as Record<string, unknown>;
  return { ...rest, id: String(_id) };
}

/**
 * Reads every recognised export in `dir`.
 *
 * When the same collection was exported more than once, files are applied
 * oldest to newest, so for the same record the newest file wins. Plans are
 * matched by name and site content by language (the natural keys); everything
 * else is matched by its id.
 */
export function loadExports(dir: string, log: (line: string) => void): Exports {
  const files = fs
    .readdirSync(dir)
    .map((name) => ({ name, collection: collectionOfFile(name) }))
    .filter(
      (file): file is { name: string; collection: ExportedCollection } =>
        file.collection !== null,
    )
    .map((file) => ({
      ...file,
      fullPath: path.join(dir, file.name),
      modified: fs.statSync(path.join(dir, file.name)).mtimeMs,
    }))
    .sort((a, b) => a.modified - b.modified);

  const keyOf: Record<ExportedCollection, (doc: ExportedDoc) => string> = {
    Plan: (doc) => String(doc.name),
    SiteContent: (doc) => String(doc.lang),
    Document: (doc) => doc.id,
    Embedding: (doc) => doc.id,
  };

  const byKey: Record<ExportedCollection, Map<string, ExportedDoc>> = {
    Plan: new Map(),
    SiteContent: new Map(),
    Document: new Map(),
    Embedding: new Map(),
  };

  for (const file of files) {
    const docs = parseDocuments(fs.readFileSync(file.fullPath, "utf8")).map(
      withStringId,
    );
    log(`  read ${file.name}: ${docs.length} ${file.collection} record(s)`);

    for (const doc of docs) {
      byKey[file.collection].set(keyOf[file.collection](doc), doc);
    }
  }

  return {
    Plan: [...byKey.Plan.values()],
    SiteContent: [...byKey.SiteContent.values()],
    Document: [...byKey.Document.values()],
    Embedding: [...byKey.Embedding.values()],
  };
}
