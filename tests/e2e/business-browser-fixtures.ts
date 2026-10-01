import { createInitialFixtures } from "./fixtures";

// Synthetic local-only identity; enabled explicitly so existing suites retain their fixtures.
export const BUSINESS_B = {
  ownerId: "00000000-0000-4000-8000-000000000201",
  businessId: "00000000-0000-4000-8000-000000000202",
  email: "e2e-business-b@example.invalid",
  password: "SafeE2EBLocalOnly2026!",
  token: "mock-e2e-business-b-access",
  refreshToken: "mock-e2e-business-b-refresh",
  name: "E2E Business B Pide",
};

export function businessBFixtures() {
  const base = createInitialFixtures();
  const user = { ...base.user, id: BUSINESS_B.ownerId, email: BUSINESS_B.email };
  const business = { ...base.business, id: BUSINESS_B.businessId, owner_id: user.id,
    name: BUSINESS_B.name, slug: "e2e-business-b-pide" };
  const products = base.products.slice(0, 2).map((p, i) => ({ ...p,
    id: `00000000-0000-4000-8000-00000000400${i + 1}`, business_id: business.id,
    client_product_id: `business-b-product-${i}`, name: `B Özel Pide ${i + 1}` }));
  const orders = base.orders.slice(0, 2).map((o, i) => ({ ...o,
    id: `00000000-0000-4000-8000-00000000500${i + 1}`, business_id: business.id,
    customer_name: `B Özel Müşteri ${i + 1}`, order_number: 701 + i,
    business_order_number: 701 + i, total_amount: 777 + i }));
  const orderItems = orders.map((o, i) => ({ ...base.orderItems[0],
    id: `00000000-0000-4000-8000-00000000600${i + 1}`, order_id: o.id,
    product_id: products[i].id, product_name: products[i].name }));
  return { user, business, products, orders, orderItems };
}
