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

type DeleteBusinessPayload = {
  businessId?: string;
};

async function findBusinessById(businessId: string) {
  const response = await adminServiceFetch(
    `/rest/v1/businesses?id=eq.${encodeURIComponent(
      businessId,
    )}&select=id,slug&limit=1`,
  );
  const body = await readJsonBody(response);

  if (!response.ok) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "İşletme kaydı sorgulanamadı.",
      503,
    );
  }

  return Array.isArray(body) ? body[0] : null;
}

async function deleteProductsByBusinessId(businessId: string) {
  const response = await adminServiceFetch(
    `/rest/v1/products?business_id=eq.${encodeURIComponent(businessId)}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "İşletmeye ait ürünler silinemedi.",
      503,
    );
  }
}

async function deleteBusinessById(businessId: string) {
  const response = await adminServiceFetch(
    `/rest/v1/businesses?id=eq.${encodeURIComponent(businessId)}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "İşletme kaydı silinemedi.",
      503,
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginAdminMutation(request);
    await requireAdmin();

    let payload: DeleteBusinessPayload;
    try {
      payload = (await request.json()) as DeleteBusinessPayload;
    } catch {
      invalidAdminRequest("Geçersiz istek gövdesi.");
    }
    const businessId = payload.businessId?.trim();

    if (!businessId) {
      invalidAdminRequest("Silinecek işletme ID bilgisi eksik.");
    }

    const business = (await findBusinessById(businessId)) as
      | { id?: string }
      | null;
    if (!business?.id) {
      return adminJson({
        deleted: false,
        notFound: true,
        message: "İşletme zaten silinmiş veya bulunamadı. Liste yenilendi.",
      });
    }

    await deleteProductsByBusinessId(business.id);
    await deleteBusinessById(business.id);

    return adminJson({ deleted: true, businessId: business.id });
  } catch (error) {
    return adminErrorResponse(error, "İşletme silinemedi.");
  }
}
