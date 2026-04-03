import { type NextRequest, NextResponse } from "next/server";

// Lightweight proxy — only refresh cookies, no auth check
// Auth is handled client-side for instant navigation
export async function proxy(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
