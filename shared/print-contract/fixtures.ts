import type { BusinessOrder } from "../../lib/supabase-orders";
import type { MaterializePrintContractV1Input } from "./materialize";
import { materializePrintContractV1 } from "./materialize";

export const printContractV1InputFixture: MaterializePrintContractV1Input = {
  jobId: "11111111-1111-4111-8111-111111111111",
  jobType: "auto",
  createdAt: "2026-08-11T09:00:00.000Z",
  expiresAt: "2026-08-12T09:00:00.000Z",
  dedupeKey:
    "22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333:auto:1",
  business: {
    name: "İstanbul Sofrası",
    address: "Caferağa Mahallesi\nModa Caddesi No: 12/A",
    whatsapp: "905551112233",
  },
  order: {
    id: "33333333-3333-4333-8333-333333333333",
    orderNumber: 42,
    status: "new",
    orderType: "delivery",
    paymentMethod: "cash",
    customerName: "Çağla Öztürk",
    customerPhone: "905551234567",
    customerAddress: "Rıhtım Caddesi No: 1\nKadıköy/İstanbul",
    customerNote: "Soğansız hazırlayın.",
    totalAmount: 240.5,
    currency: "TRY",
    createdAt: "2026-08-11T08:59:30.000Z",
    updatedAt: "2026-08-11T08:59:30.000Z",
    items: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        productId: "55555555-5555-4555-8555-555555555555",
        productName: "Adana Kebap",
        unitPrice: 120.25,
        quantity: 2,
        lineTotal: 240.5,
      },
    ],
  } satisfies BusinessOrder,
  printProfile: {
    profileVersion: 1,
    mode: "system",
    paperWidthMm: 80,
    copies: 1,
    cutEnabled: false,
  },
};

export const printContractV1Fixture = materializePrintContractV1(
  printContractV1InputFixture,
);
