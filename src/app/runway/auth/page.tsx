import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  RUNWAY_AUTH_COOKIE_NAME,
  safeRunwayReturnTo,
  verifyRunwayAuthCookie,
} from "@/lib/runway/auth-cookie";

import AuthForm from "./auth-form";

export const dynamic = "force-dynamic";

export default async function RunwayAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  const safeTo = safeRunwayReturnTo(returnTo);

  const cookieStore = await cookies();
  const cookie = cookieStore.get(RUNWAY_AUTH_COOKIE_NAME);
  if (cookie && verifyRunwayAuthCookie(cookie.value)) {
    redirect(safeTo);
  }

  return <AuthForm returnTo={safeTo} />;
}
