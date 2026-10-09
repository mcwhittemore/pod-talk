import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

export const COOKIE_NAME = "pt_token";

function expectedToken(): string {
  return process.env.POD_TALK_TOKEN ?? "";
}

export function tokenMatches(token: string | undefined | null): boolean {
  const expected = expectedToken();
  return Boolean(expected) && token === expected;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Returns null when authorized, or a 401 response otherwise. */
export function requireAuth(req: Request): NextResponse | null {
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  if (tokenMatches(bearer) || tokenMatches(readCookie(req, COOKIE_NAME))) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** For server components: redirect to /login unless the cookie is valid. */
export async function requirePageAuth(): Promise<void> {
  const store = await cookies();
  if (!tokenMatches(store.get(COOKIE_NAME)?.value)) redirect("/login");
}

export async function isLoggedIn(): Promise<boolean> {
  const store = await cookies();
  return tokenMatches(store.get(COOKIE_NAME)?.value);
}
