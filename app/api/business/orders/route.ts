import { privateBusinessJson } from "../_response";
import {
  fetchBusinessOrdersForUser,
} from "./route-support";

export async function GET(request: Request) {
  const result = await fetchBusinessOrdersForUser(request);
  if ("response" in result) return result.response;

  return privateBusinessJson({
    orders: result.orders,
    pagination: result.pagination,
  });
}
