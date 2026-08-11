export function isSameOriginAdminRequest(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}
