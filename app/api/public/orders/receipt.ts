import { parsePublicOrderReceipt, moneyInKurus, type PublicOrderReceipt } from "../../../../lib/public-order-receipt";
import { isPlainObject, type AtomicOrderResult } from "../../business/orders/_utils";

// Only callable after the RPC has validated the complete original payload and
// idempotency key. No public lookup endpoint, order ID, or customer PII is added.
export async function fetchRecordedOrderReceipt(
  url: string,
  serverSecretKey: string,
  businessSlug: string,
  idempotencyKey: string,
  committed: AtomicOrderResult,
): Promise<PublicOrderReceipt> {
  const params = new URLSearchParams({
    select: "business_order_number,total_amount,order_type,payment_method,currency,order_items(product_id,product_name,unit_price,quantity,line_total),businesses!inner(slug)",
    "businesses.slug": `eq.${businessSlug}`,
    idempotency_key: `eq.${idempotencyKey}`,
    business_order_number: `eq.${committed.order_number}`,
    limit: "2",
  });
  const response = await fetch(`${url}/rest/v1/orders?${params}`, {
    method: "GET", cache: "no-store", headers: { apikey: serverSecretKey },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error("Recorded order receipt unavailable");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || !isPlainObject(rows[0])) {
    throw new Error("Recorded order receipt not unique");
  }
  const row = rows[0];
  if (!isPlainObject(row.businesses) || row.businesses.slug !== businessSlug ||
      !Array.isArray(row.order_items)) throw new Error("Recorded order receipt invalid");
  const receipt = parsePublicOrderReceipt({
    orderNumber: Number(row.business_order_number), totalAmount: row.total_amount,
    orderType: row.order_type, paymentMethod: row.payment_method,
    currency: row.currency,
    items: row.order_items.map((item: unknown) => isPlainObject(item) ? {
      productId: item.product_id, productName: item.product_name,
      unitPrice: item.unit_price, quantity: item.quantity, lineTotal: item.line_total,
    } : null),
  });
  if (!receipt || receipt.orderNumber !== Number(committed.order_number) ||
      receipt.orderType !== committed.order_type ||
      moneyInKurus(receipt.totalAmount) !== moneyInKurus(committed.total_amount)) {
    throw new Error("Recorded order receipt inconsistent");
  }
  return receipt;
}
