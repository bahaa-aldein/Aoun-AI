// Optional: pushes exported embedding vectors back into Upstash Vector.
//
// Only needed if the Upstash index was emptied or reset. Vectors that are still
// there already match, because their ids (`<documentId>::<chunkIndex>`) and
// `kbId` metadata do not change when the same ids are restored in MongoDB.
// Re-upserting identical ids is safe and idempotent. The vector format mirrors
// `saveEmbeddings` in src/lib/embedding-service.ts.

const BATCH_SIZE = 100;

export interface VectorSource {
  kbId: string;
  documentId: string;
  chunkIndex: number;
  filename: string | null;
  sourceUrl: string | null;
  text: string;
  vector: number[];
}

export async function upsertVectors(
  vectors: VectorSource[],
  options: { url: string; token: string },
): Promise<number> {
  const baseUrl = options.url.replace(/\/$/, "");
  let sent = 0;

  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    const batch = vectors.slice(i, i + BATCH_SIZE).map((item) => ({
      id: `${item.documentId}::${item.chunkIndex}`,
      vector: item.vector,
      metadata: {
        documentId: item.documentId,
        chunkIndex: item.chunkIndex,
        filename: item.filename,
        sourceUrl: item.sourceUrl,
        kbId: item.kbId,
        text: item.text,
      },
    }));

    const response = await fetch(`${baseUrl}/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      throw new Error(
        `Upstash Vector upsert failed: ${response.status} ${response.statusText}`,
      );
    }

    sent += batch.length;
  }

  return sent;
}
