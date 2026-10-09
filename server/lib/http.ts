import { NextResponse } from "next/server";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function badRequest(message: string): NextResponse {
  return json({ error: message }, 400);
}

export function notFound(): NextResponse {
  return json({ error: "not_found" }, 404);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

export const INT32_MAX = 2147483647;

/**
 * Validates a value destined for a Postgres `int` column.
 * Returns the number when `v` is an integer within [0, INT32_MAX],
 * `null` when `v` is null/undefined (caller decides whether that is allowed),
 * and `undefined` when `v` is present but invalid (caller should 400).
 */
export function int32(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > INT32_MAX) return undefined;
  return v;
}
