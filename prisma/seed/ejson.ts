// Converts MongoDB Extended JSON (what MongoDB Compass exports) into plain
// JavaScript values that Prisma accepts:
//
//   { "$oid": "..." }             -> "..."              (ObjectId as a hex string)
//   { "$date": "..." | {...} }    -> Date
//   { "$numberInt": "5" }         -> 5   (also $numberLong, $numberDouble, $numberDecimal)
//
// Both the "canonical" and "relaxed" Extended JSON flavours are handled, since
// relaxed output simply leaves numbers and ISO dates as plain JSON values.

type Json = unknown;

const NUMBER_KEYS = new Set([
  "$numberInt",
  "$numberLong",
  "$numberDouble",
  "$numberDecimal",
]);

function toDate(value: unknown): Date {
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }

  if (typeof value === "object" && value !== null && "$numberLong" in value) {
    return new Date(Number((value as { $numberLong: string }).$numberLong));
  }

  throw new Error(`Unsupported $date value: ${JSON.stringify(value)}`);
}

export function fromExtendedJson(value: Json): Json {
  if (Array.isArray(value)) return value.map(fromExtendedJson);

  if (typeof value !== "object" || value === null) return value;

  const entries = Object.entries(value as Record<string, Json>);

  if (entries.length === 1) {
    const [key, inner] = entries[0];

    if (key === "$oid") return String(inner);
    if (key === "$date") return toDate(inner);
    if (NUMBER_KEYS.has(key)) return Number(inner);
  }

  return Object.fromEntries(
    entries.map(([key, inner]) => [key, fromExtendedJson(inner)]),
  );
}

/**
 * Prisma `Json` columns are stored as JSON, so dates inside them must be plain
 * strings. This round-trips a value through JSON to get exactly that.
 */
export function toJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
