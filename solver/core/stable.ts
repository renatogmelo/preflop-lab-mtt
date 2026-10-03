function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Non-finite numbers cannot be serialized deterministically.");
  }
  return value;
}

export function stableStringify(value: unknown) {
  return JSON.stringify(normalize(value));
}

function fnv1a(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function hashValue(value: unknown) {
  const serialized = stableStringify(value);
  return fnv1a(serialized, 0x811c9dc5) + fnv1a(serialized, 0x9e3779b9);
}
