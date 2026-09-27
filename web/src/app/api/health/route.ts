// For the container's readiness/liveness probes. Deliberately doesn't call any backend: a probe
// that depended on them would restart this app every time a backend blipped, when restarting the
// frontend can't fix that. It answers "is this process serving?", nothing more.
export function GET() {
  return Response.json({ status: "ok" });
}
