import { requireAdmin } from "../../../../lib/admin/auth";
import {
  adminServiceFetch,
  readJsonBody,
} from "../../../../lib/admin/dal";
import { AdminError } from "../../../../lib/admin/errors";
import {
  adminErrorResponse,
  adminJson,
  assertSameOriginAdminMutation,
  invalidAdminRequest,
} from "../../../../lib/admin/http";

type SubscriptionPayload = {
  businessId?: string;
  slug?: string;
  subscription_status?: "active" | "expired" | "blocked";
  subscription_started_at?: string | null;
  subscription_expires_at?: string | null;
  is_active?: boolean;
};

const BUSINESS_SELECT = [
  "id",
  "owner_id",
  "slug",
  "name",
  "description",
  "whatsapp_order_number",
  "created_at",
  "category",
  "city",
  "district",
  "neighborhood",
  "address",
  "delivery_status",
  "logo_text",
  "subscription_status",
  "subscription_started_at",
  "subscription_expires_at",
  "is_active",
].join(",");

function nullableDateKey(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function verifySubscriptionUpdate(row: SubscriptionPayload, payload: SubscriptionPayload) {
  const hasMismatch =
    row.subscription_status !== payload.subscription_status ||
    row.is_active !== payload.is_active ||
    nullableDateKey(row.subscription_started_at) !==
      nullableDateKey(payload.subscription_started_at) ||
    nullableDateKey(row.subscription_expires_at) !==
      nullableDateKey(payload.subscription_expires_at);

  if (hasMismatch) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "Abonelik doğrulaması tamamlanamadı.",
      503,
    );
  }
}

async function updateSubscription(
  payload: Required<Pick<SubscriptionPayload, "subscription_status" | "is_active">> &
    Pick<
      SubscriptionPayload,
      "businessId" | "slug" | "subscription_started_at" | "subscription_expires_at"
    >,
) {
  const filter = payload.businessId?.trim()
    ? `id=eq.${encodeURIComponent(payload.businessId.trim())}`
    : `slug=eq.${encodeURIComponent(payload.slug?.trim() || "")}`;

  const response = await adminServiceFetch(
    `/rest/v1/businesses?${filter}&select=${BUSINESS_SELECT}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        subscription_status: payload.subscription_status,
        subscription_started_at: payload.subscription_started_at ?? null,
        subscription_expires_at: payload.subscription_expires_at ?? null,
        is_active: payload.is_active,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  const body = await readJsonBody(response);

  if (!response.ok) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "Abonelik güncellenemedi.",
      503,
    );
  }

  const business = Array.isArray(body) ? body[0] : body;
  if (!business || typeof business !== "object" || !("slug" in business)) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "Abonelik güncellendi ancak işletme kaydı dönmedi.",
      503,
    );
  }

  return business as SubscriptionPayload & { slug: string };
}

export async function POST(request: Request) {
  try {
    assertSameOriginAdminMutation(request);
    await requireAdmin();

    let payload: SubscriptionPayload;
    try {
      payload = (await request.json()) as SubscriptionPayload;
    } catch {
      invalidAdminRequest("Geçersiz istek gövdesi.");
    }

    if (!payload.businessId?.trim() && !payload.slug?.trim()) {
      invalidAdminRequest("Güncellenecek işletme ID veya slug bilgisi eksik.");
    }
    if (
      payload.subscription_status !== "active" &&
      payload.subscription_status !== "expired" &&
      payload.subscription_status !== "blocked"
    ) {
      invalidAdminRequest("Geçersiz abonelik durumu.");
    }
    if (typeof payload.is_active !== "boolean") {
      invalidAdminRequest("Aktif/pasif bilgisi geçersiz.");
    }

    const business = await updateSubscription({
      businessId: payload.businessId,
      slug: payload.slug,
      subscription_status: payload.subscription_status,
      subscription_started_at: payload.subscription_started_at ?? null,
      subscription_expires_at: payload.subscription_expires_at ?? null,
      is_active: payload.is_active,
    });
    verifySubscriptionUpdate(business, payload);

    return adminJson({ business });
  } catch (error) {
    return adminErrorResponse(error, "Abonelik işlemi tamamlanamadı.");
  }
}
