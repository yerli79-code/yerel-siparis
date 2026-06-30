import { NextResponse } from "next/server";
import {
  fetchBusinessOrdersForUser,
} from "./route-support";

export async function GET(request: Request) {
  const result = await fetchBusinessOrdersForUser(request);
  if ("response" in result) return result.response;

  return NextResponse.json({ orders: result.orders });
}
