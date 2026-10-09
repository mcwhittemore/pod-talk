"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, tokenMatches } from "@/lib/auth";

export async function login(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string }> {
  const token = String(formData.get("token") ?? "").trim();
  if (!tokenMatches(token)) return { error: "Wrong token." };
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}
