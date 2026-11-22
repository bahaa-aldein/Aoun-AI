// Seeds an empty database.
//
//   npm run db:seed                         site content + admin user
//   npm run db:seed -- --from "<folder>"    ...and restore exported data
//   npm run db:seed -- --dry-run            show what would happen, write nothing
//
// It is idempotent: it only creates what is missing and never overwrites or
// deletes existing rows, so it is safe to run more than once.
//
// Environment (put it in a local `.env`, which is git-ignored):
//   DATABASE_URL          required; include the database name in the URL
//   SEED_ADMIN_EMAIL      the admin account to create, or promote if it exists
//   SEED_ADMIN_PASSWORD   required only when that account does not exist yet
//   SEED_ADMIN_NAME       optional display name (default "Admin")
//   SEED_EXPORT_DIR       optional folder of MongoDB Compass JSON exports
//                         (same as --from)
//   UPSTASH_VECTOR_REST_URL / UPSTASH_VECTOR_REST_TOKEN
//                         only for --restore-vectors
//
// Restoring exported data (Plan, SiteContent, Document, Embedding files named
// `<database>.<Collection>.json`) keeps the original ids. That matters:
// Upstash vectors are keyed by document id and filtered by knowledge base id,
// so a restored knowledge base reconnects to vectors that already exist.
import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import path from "node:path";
import ar from "../src/dictionaries/ar.json";
import en from "../src/dictionaries/en.json";
import {
  buildDefaultSiteContent,
  withDefaults,
} from "../src/lib/default-site-content";
import { planSchema } from "../src/lib/schemas/plan";
import { toJsonValue } from "./seed/ejson";
import { loadExports, type ExportedDoc, type Exports } from "./seed/exports";
import { upsertVectors, type VectorSource } from "./seed/vectors";

const log = (line = "") => console.log(line);

const USAGE = `Usage: npm run db:seed -- [options]

  --from <folder>      restore data from MongoDB Compass JSON exports
  --dry-run            show what would be created, write nothing
  --kb <id>            restore this knowledge base (repeatable)
  --all-kbs            restore every knowledge base found in the exports
  --restore-vectors    also upsert exported vectors into Upstash Vector
  --help               show this message

Without --kb or --all-kbs, only the knowledge base with the most recent
documents is restored.`;

interface Options {
  from?: string;
  dryRun: boolean;
  allKbs: boolean;
  kbIds: string[];
  restoreVectors: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    dryRun: false,
    allKbs: false,
    kbIds: [],
    restoreVectors: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--from" || arg === "--kb") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a value\n\n${USAGE}`);
      if (arg === "--from") options.from = value;
      else options.kbIds.push(value);
    } else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--all-kbs") options.allKbs = true;
    else if (arg === "--restore-vectors") options.restoreVectors = true;
    else if (arg === "--help" || arg === "-h") {
      log(USAGE);
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}\n\n${USAGE}`);
  }

  return options;
}

// ---------------------------------------------------------------------------

const tally: Record<string, { created: number; skipped: number }> = {};
const count = (name: string, kind: "created" | "skipped", amount = 1) => {
  tally[name] ??= { created: 0, skipped: 0 };
  tally[name][kind] += amount;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

const DRY_RUN_ID = "000000000000000000000000";

async function ensureAdmin(
  prisma: PrismaClient,
  dryRun: boolean,
): Promise<string | null> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  if (!email) {
    log("Admin: SEED_ADMIN_EMAIL is not set, skipping.");
    return null;
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.role === UserRole.ADMIN) {
      log(`Admin: ${email} already exists.`);
      count("Admin user", "skipped");
      return existing.id;
    }

    if (!dryRun) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: UserRole.ADMIN },
      });
    }
    log(`Admin: ${email} promoted to ADMIN.`);
    count("Admin user", "created");
    return existing.id;
  }

  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error(
      `${email} does not exist yet, so SEED_ADMIN_PASSWORD (at least 8 characters) is required.`,
    );
  }

  if (dryRun) {
    log(`Admin: would create ${email}.`);
    count("Admin user", "created");
    return DRY_RUN_ID;
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: process.env.SEED_ADMIN_NAME?.trim() || "Admin",
      password: await bcrypt.hash(password, 12),
      role: UserRole.ADMIN,
      emailVerified: new Date(),
    },
  });
  log(`Admin: created ${email}.`);
  count("Admin user", "created");
  return user.id;
}

async function seedSiteContent(
  prisma: PrismaClient,
  exports: Exports | undefined,
  dryRun: boolean,
) {
  const dictionaries = { en, ar } as const;

  for (const lang of ["en", "ar"] as const) {
    const existing = await prisma.siteContent.findFirst({ where: { lang } });
    if (existing) {
      count("Site content", "skipped");
      continue;
    }

    const exported = exports?.SiteContent.find((doc) => doc.lang === lang);
    const defaults = buildDefaultSiteContent(dictionaries[lang]);
    const content = toJsonValue(
      withDefaults(exported?.content, defaults),
    ) as Prisma.InputJsonValue;

    if (!dryRun) {
      await prisma.siteContent.create({
        data: {
          ...(exported && { id: exported.id }),
          lang,
          content,
          ...(exported?.createdAt instanceof Date && {
            createdAt: exported.createdAt,
          }),
        },
      });
    }
    log(
      `Site content (${lang}): ${exported ? "restored from export" : "created from built-in text"}.`,
    );
    count("Site content", "created");
  }
}

async function seedPlans(
  prisma: PrismaClient,
  plans: ExportedDoc[],
  dryRun: boolean,
) {
  for (const doc of plans) {
    // Exports contain explicit nulls; the plan schema expects them absent.
    const { id, createdAt, ...fields } = doc;
    const cleaned = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== null),
    );

    const parsed = planSchema.safeParse(cleaned);
    if (!parsed.success) {
      log(`Plan ${String(doc.name)}: skipped, invalid data in the export.`);
      count("Plans", "skipped");
      continue;
    }

    const existing = await prisma.plan.findUnique({
      where: { name: parsed.data.name },
    });
    if (existing) {
      count("Plans", "skipped");
      continue;
    }

    if (!dryRun) {
      await prisma.plan.create({
        data: {
          id,
          ...parsed.data,
          ...(createdAt instanceof Date && { createdAt }),
        },
      });
    }
    log(`Plan ${parsed.data.name}: restored.`);
    count("Plans", "created");
  }
}

async function restoreKnowledgeBases(
  prisma: PrismaClient,
  exports: Exports,
  adminId: string | null,
  options: Options,
): Promise<VectorSource[]> {
  const documents = exports.Document;
  const embeddings = exports.Embedding;

  const kbIds = [
    ...new Set([
      ...documents.map((doc) => String(doc.kbId)),
      ...embeddings.map((embedding) => String(embedding.kbId)),
    ]),
  ];

  if (kbIds.length === 0) {
    log("Knowledge bases: nothing to restore in the exports.");
    return [];
  }

  if (!adminId) {
    log(
      "Knowledge bases: skipped. They need an owner, so set SEED_ADMIN_EMAIL.",
    );
    return [];
  }

  const docsOf = (kbId: string) =>
    documents.filter((doc) => String(doc.kbId) === kbId);
  const newestDocument = (kbId: string) =>
    Math.max(
      0,
      ...docsOf(kbId).map((doc) =>
        doc.createdAt instanceof Date ? doc.createdAt.getTime() : 0,
      ),
    );

  let selected: string[];
  if (options.allKbs) {
    selected = kbIds;
  } else if (options.kbIds.length > 0) {
    const unknown = options.kbIds.filter((id) => !kbIds.includes(id));
    if (unknown.length > 0) {
      throw new Error(
        `Not found in the exports: ${unknown.join(", ")}. Available: ${kbIds.join(", ")}`,
      );
    }
    selected = options.kbIds;
  } else {
    selected = [
      [...kbIds].sort((a, b) => newestDocument(b) - newestDocument(a))[0],
    ];
  }

  for (const kbId of kbIds.filter((id) => !selected.includes(id))) {
    log(
      `Knowledge base ${kbId}: not restored (${docsOf(kbId).length} document(s)). Use --kb ${kbId} or --all-kbs.`,
    );
  }

  const vectors: VectorSource[] = [];

  for (const kbId of selected) {
    const kbDocuments = docsOf(kbId);
    const created = kbDocuments
      .map((doc) => (doc.createdAt instanceof Date ? doc.createdAt : null))
      .filter((date): date is Date => date !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    const existingKb = await prisma.knowledgeBase.findUnique({
      where: { id: kbId },
    });

    if (existingKb) {
      count("Knowledge bases", "skipped");
    } else {
      if (!options.dryRun) {
        await prisma.knowledgeBase.create({
          data: {
            id: kbId,
            userId: adminId,
            title:
              hostOf(asString(kbDocuments[0]?.sourceUrl)) ??
              "Restored knowledge base",
            description: "Restored from exported data",
            ...(created && { createdAt: created }),
          },
        });
      }
      log(`Knowledge base ${kbId}: restored.`);
      count("Knowledge bases", "created");
    }

    const restoredDocIds = new Set<string>();
    for (const doc of kbDocuments) {
      restoredDocIds.add(doc.id);

      const exists = await prisma.document.findUnique({
        where: { id: doc.id },
      });
      if (exists) {
        count("Documents", "skipped");
        continue;
      }

      const content = asString(doc.content);
      if (!options.dryRun) {
        await prisma.document.create({
          data: {
            id: doc.id,
            kbId,
            filename: asString(doc.filename),
            mimeType: asString(doc.mimeType),
            size: content ? Buffer.byteLength(content) : undefined,
            content,
            sourceUrl: asString(doc.sourceUrl),
            metadata: doc.metadata
              ? (toJsonValue(doc.metadata) as Prisma.InputJsonValue)
              : undefined,
            ...(doc.createdAt instanceof Date && { createdAt: doc.createdAt }),
          },
        });
      }
      count("Documents", "created");
    }

    const kbEmbeddings = embeddings.filter(
      (embedding) => String(embedding.kbId) === kbId,
    );
    const vectorsBefore = vectors.length;
    let orphaned = 0;

    for (const embedding of kbEmbeddings) {
      const documentId = asString(embedding.documentId);

      if (documentId && !restoredDocIds.has(documentId)) {
        orphaned++;
        continue;
      }

      const vector = Array.isArray(embedding.vector)
        ? (embedding.vector as number[])
        : [];
      const meta = (embedding.meta ?? {}) as Record<string, unknown>;

      if (documentId) {
        const document = kbDocuments.find((doc) => doc.id === documentId);
        vectors.push({
          kbId,
          documentId,
          chunkIndex: Number(meta.chunkIndex ?? 0),
          filename:
            asString(meta.filename) ?? asString(document?.filename) ?? null,
          sourceUrl:
            asString(meta.sourceUrl) ?? asString(document?.sourceUrl) ?? null,
          text: asString(embedding.text) ?? "",
          vector,
        });
      }

      const exists = await prisma.embedding.findUnique({
        where: { id: embedding.id },
      });
      if (exists) {
        count("Embeddings", "skipped");
        continue;
      }

      if (!options.dryRun) {
        await prisma.embedding.create({
          data: {
            id: embedding.id,
            kbId,
            documentId,
            vector,
            text: asString(embedding.text),
            meta: toJsonValue(meta) as Prisma.InputJsonValue,
            ...(embedding.createdAt instanceof Date && {
              createdAt: embedding.createdAt,
            }),
          },
        });
      }
      count("Embeddings", "created");
    }

    if (orphaned > 0) {
      log(
        `Knowledge base ${kbId}: ${orphaned} embedding(s) skipped, their document is not in the exports.`,
      );
    }

    // Upstash vector ids are `<documentId>::<chunkIndex>`, so a chunk that was
    // embedded twice shares one vector there. The export is restored as it was.
    const vectorIds = vectors
      .slice(vectorsBefore)
      .map((vector) => `${vector.documentId}::${vector.chunkIndex}`);
    const repeated = vectorIds.length - new Set(vectorIds).size;
    if (repeated > 0) {
      log(
        `Knowledge base ${kbId}: ${repeated} embedding(s) repeat another chunk of the same document (restored as exported).`,
      );
    }
  }

  return vectors;
}

// ---------------------------------------------------------------------------

// Prisma's CLI reads `.env` on its own, but `tsx` does not. Load it here, if it
// exists. Variables that are already set in the environment are not overridden.
function loadLocalEnv() {
  try {
    process.loadEnvFile(path.resolve(".env"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Put it in a local .env file (it must include the database name).",
    );
  }

  // Show the target (host and database only, never the credentials).
  const target = new URL(databaseUrl);
  log(
    `Target: ${target.hostname}${target.pathname}${options.dryRun ? "  (dry run, nothing will be written)" : ""}`,
  );

  const exportDir = options.from ?? process.env.SEED_EXPORT_DIR;
  let exports: Exports | undefined;
  if (exportDir) {
    const resolved = path.resolve(exportDir);
    log(`Reading exports from ${resolved}`);
    exports = loadExports(resolved, log);
  }
  log();

  const prisma = new PrismaClient();
  try {
    const adminId = await ensureAdmin(prisma, options.dryRun);
    await seedSiteContent(prisma, exports, options.dryRun);

    let vectors: VectorSource[] = [];
    if (exports) {
      await seedPlans(prisma, exports.Plan, options.dryRun);
      vectors = await restoreKnowledgeBases(prisma, exports, adminId, options);
    }

    if (options.restoreVectors) {
      const url = process.env.UPSTASH_VECTOR_REST_URL;
      const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
      if (!url || !token) {
        throw new Error(
          "--restore-vectors needs UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN.",
        );
      }

      if (options.dryRun) {
        log(`Upstash Vector: would upsert ${vectors.length} vector(s).`);
      } else {
        const sent = await upsertVectors(vectors, { url, token });
        log(`Upstash Vector: upserted ${sent} vector(s).`);
      }
    }

    log();
    log("Summary");
    for (const [name, { created, skipped }] of Object.entries(tally)) {
      log(`  ${name.padEnd(16)} created ${created}, already present ${skipped}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
