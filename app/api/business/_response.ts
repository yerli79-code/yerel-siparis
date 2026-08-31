import { NextResponse } from "next/server";

export const privateBusinessResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization",
};

export function privateBusinessJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: privateBusinessResponseHeaders,
  });
}
