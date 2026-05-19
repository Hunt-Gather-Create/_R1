import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  RUNWAY_AUTH_COOKIE_NAME,
  verifyRunwayAuthCookie,
} from "@/lib/runway/auth-cookie";

export default async function RunwayGatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(RUNWAY_AUTH_COOKIE_NAME);
  if (!cookie || !verifyRunwayAuthCookie(cookie.value)) {
    redirect("/runway/auth?returnTo=/runway");
  }
  return <>{children}</>;
}
