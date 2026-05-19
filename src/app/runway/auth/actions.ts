"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { setTimeout as delay } from "node:timers/promises";

import {
  RUNWAY_AUTH_COOKIE_NAME,
  RUNWAY_AUTH_TTL_SECONDS,
  safeRunwayReturnTo,
  signRunwayAuthCookie,
  verifyRunwayPassword,
} from "@/lib/runway/auth-cookie";

const WRONG_PASSWORD_DELAY_MS = 500;

export type RunwayAuthState = { error?: string } | null;

export async function verifyAndSetRunwayAuth(
  _prevState: RunwayAuthState,
  formData: FormData,
): Promise<RunwayAuthState> {
  const password = formData.get("password");
  const rawReturnTo = formData.get("returnTo");
  const returnTo = safeRunwayReturnTo(
    typeof rawReturnTo === "string" ? rawReturnTo : null,
  );

  if (typeof password !== "string" || !verifyRunwayPassword(password)) {
    await delay(WRONG_PASSWORD_DELAY_MS);
    return { error: "Incorrect password." };
  }

  const cookieStore = await cookies();
  cookieStore.set(RUNWAY_AUTH_COOKIE_NAME, signRunwayAuthCookie(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/runway",
    maxAge: RUNWAY_AUTH_TTL_SECONDS,
  });
  redirect(returnTo);
}
