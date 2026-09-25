import { NextResponse, type NextRequest } from "next/server";
import { backendUrl, isBackendService } from "@/lib/config";
import { clearSessionCookie, getSessionToken } from "@/lib/session";

// The one door between the browser and the backend. Client components call
// /api/backend/<service>/<path>; this handler attaches the JWT from the httpOnly cookie and
// forwards to the matching service. The browser never sees the token or the backend URLs.
//
// Because it forwards a caller-influenced path to an internal address, it's deliberately
// narrow: the target host is fixed per service (never derived from the request), and any path
// that could climb out of it is rejected before a request is made.

type Ctx = RouteContext<"/api/backend/[service]/[...path]">;

const FORWARDED_REQUEST_HEADERS = ["content-type", "accept"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-disposition"];

async function handle(request: NextRequest, ctx: Ctx) {
  const { service, path } = await ctx.params;

  if (!isBackendService(service)) {
    return NextResponse.json({ error: "Unknown service." }, { status: 404 });
  }
  if (path.some((segment) => segment === "." || segment === ".." || segment.includes("\\"))) {
    return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  }

  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const base = backendUrl(service);
  const target = new URL(`${base}/${path.map(encodeURIComponent).join("/")}`);
  if (target.origin !== new URL(base).origin) {
    return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  }
  target.search = request.nextUrl.search;

  const headers = new Headers({ Authorization: `Bearer ${token}` });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // Required by fetch when streaming a request body through.
      ...(hasBody ? { duplex: "half" } : {}),
      signal: AbortSignal.timeout(30_000),
    } as RequestInit);
  } catch {
    return NextResponse.json({ error: "The server didn't respond." }, { status: 502 });
  }

  // An expired or revoked token: drop the cookie so the next navigation lands on /login
  // instead of looping through failing requests.
  if (upstream.status === 401) await clearSessionCookie();

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
