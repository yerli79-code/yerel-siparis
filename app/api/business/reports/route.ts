import { NextResponse } from "next/server";
import {
  BusinessReportRequestError,
  BusinessReportRpcValidationError,
  parseBusinessReportQuery,
  parseBusinessReportRpcResult,
  type BusinessReport,
  type BusinessReportQuery,
} from "../../../../lib/business-reports";
import {
  fetchBusinessesForUser,
  getBearerToken,
  getSupabaseServerConfig,
  getUserFromToken,
  isPlainObject,
  readJson,
} from "../orders/_utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
};

type BusinessReportErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_QUERY"
  | "INVALID_DATE"
  | "DATE_OUT_OF_RANGE"
  | "BUSINESS_NOT_FOUND"
  | "BUSINESS_ACCOUNT_INVALID"
  | "UNSUPPORTED_CURRENCY"
  | "REPORT_UNAVAILABLE";

type BusinessReportErrorResponse = {
  error: string;
  code: BusinessReportErrorCode;
};

function reportResponse(body: BusinessReport, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: privateNoStoreHeaders,
  });
}

function reportError(
  error: string,
  code: BusinessReportErrorCode,
  status: number,
) {
  const body: BusinessReportErrorResponse = { error, code };
  return NextResponse.json(body, {
    status,
    headers: privateNoStoreHeaders,
  });
}

function isUnsupportedCurrencyRpcError(body: unknown) {
  if (!isPlainObject(body)) return false;
  const message = typeof body.message === "string" ? body.message : "";
  return message.includes("unsupported_currency");
}

function requestErrorResponse(error: BusinessReportRequestError) {
  if (error.code === "INVALID_QUERY") {
    return reportError(
      "Istek parametreleri gecersiz.",
      "INVALID_QUERY",
      400,
    );
  }
  if (error.code === "DATE_OUT_OF_RANGE") {
    return reportError(
      "Tarih araligi izin verilen sinirlarin disinda.",
      "DATE_OUT_OF_RANGE",
      400,
    );
  }
  return reportError("Tarih araligi gecersiz.", "INVALID_DATE", 400);
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  let stage:
    | "config"
    | "auth"
    | "date_validation"
    | "business_lookup"
    | "business_cardinality"
    | "rpc"
    | "rpc_validation" = "config";
  let query: BusinessReportQuery | undefined;
  let businessId: string | undefined;

  try {
    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();

    stage = "auth";
    const accessToken = getBearerToken(request);
    if (!accessToken) {
      return reportError("Oturum bulunamadi.", "UNAUTHORIZED", 401);
    }

    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return reportError(
        "Gecersiz veya suresi dolmus oturum.",
        "UNAUTHORIZED",
        401,
      );
    }

    stage = "date_validation";
    query = parseBusinessReportQuery(new URL(request.url).searchParams);

    stage = "business_lookup";
    const businesses = await fetchBusinessesForUser(
      url,
      serviceRoleKey,
      user.id,
    );

    stage = "business_cardinality";
    if (businesses.length === 0) {
      return reportError(
        "Giris yapan kullaniciya ait isletme bulunamadi.",
        "BUSINESS_NOT_FOUND",
        404,
      );
    }
    if (businesses.length > 1) {
      return reportError(
        "Kullanici hesabi birden fazla isletmeyle eslesiyor.",
        "BUSINESS_ACCOUNT_INVALID",
        409,
      );
    }
    businessId = businesses[0].id;

    stage = "rpc";
    const rpcResponse = await fetch(
      `${url}/rest/v1/rpc/get_business_report`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_business_id: businessId,
          p_from: query.from,
          p_to: query.to,
        }),
        cache: "no-store",
      },
    );
    const rpcBody = await readJson(rpcResponse);
    if (!rpcResponse.ok) {
      if (isUnsupportedCurrencyRpcError(rpcBody)) {
        console.warn("business_report_rejected", {
          stage,
          businessId,
          from: query.from,
          to: query.to,
          elapsedMs: Date.now() - startedAt,
          code: "UNSUPPORTED_CURRENCY",
        });
        return reportError(
          "Secilen aralik desteklenmeyen para birimi iceriyor.",
          "UNSUPPORTED_CURRENCY",
          422,
        );
      }
      throw new Error("Business report RPC istegi basarisiz.");
    }

    stage = "rpc_validation";
    const report = parseBusinessReportRpcResult(rpcBody, query);

    console.info("business_report_generated", {
      stage,
      businessId,
      from: query.from,
      to: query.to,
      elapsedMs: Date.now() - startedAt,
      totalOrders: report.kpis.totalOrders,
      productCount: report.products.length,
    });

    return reportResponse(report);
  } catch (error) {
    if (error instanceof BusinessReportRequestError) {
      return requestErrorResponse(error);
    }

    console.error("business_report_failed", {
      stage,
      businessId,
      from: query?.from,
      to: query?.to,
      elapsedMs: Date.now() - startedAt,
      code:
        error instanceof BusinessReportRpcValidationError
          ? "INVALID_RPC_RESPONSE"
          : "REPORT_UNAVAILABLE",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return reportError(
      "Rapor su anda olusturulamiyor.",
      "REPORT_UNAVAILABLE",
      500,
    );
  }
}
