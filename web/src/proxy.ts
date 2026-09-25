import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";
import { decodeSessionToken } from "@/lib/jwt";
import { ADMIN_PREFIXES, homeFor, matchesPrefix, SELLER_PREFIXES } from "@/lib/roles";

// An optimistic gate, not a security boundary: it saves a signed-out or wrong-role user from
// loading a page they can't use. Real enforcement is the backend, which checks the JWT's
// signature and role on every call regardless of what this decides.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? decodeSessionToken(token) : null;

  if (pathname === "/login") {
    return session ? redirect(request, homeFor(session.role)) : NextResponse.next();
  }

  if (pathname === "/") {
    return redirect(request, session ? homeFor(session.role) : "/login");
  }

  const isAdminArea = matchesPrefix(pathname, ADMIN_PREFIXES);
  const isSellerArea = matchesPrefix(pathname, SELLER_PREFIXES);
  if (!isAdminArea && !isSellerArea) return NextResponse.next();

  if (!session) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  if (isAdminArea && session.role !== "Admin") {
    return redirect(request, homeFor(session.role));
  }
  return NextResponse.next();
}

function redirect(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}

export const config = {
  // Everything except API routes, Next internals, and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
