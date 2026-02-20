import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";

export const GET = async (request: NextRequest) => {
  const returnTo = request.nextUrl.searchParams.get("returnTo");

  const signInUrl = await getSignInUrl();
  const response = NextResponse.redirect(signInUrl);

  // Persist returnTo as httpOnly cookie on the redirect response
  if (returnTo?.startsWith("/beta/") || returnTo?.startsWith("/invite/")) {
    response.cookies.set("returnTo", returnTo, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    });
  }

  return response;
};
