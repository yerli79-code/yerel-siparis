export type BusinessOrderSearch = {
  generalTerm?: string;
  exactOrderNumber?: number;
};

function parseSafeInteger(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseOrderSearch(value: string): BusinessOrderSearch | undefined {
  if (!value) return undefined;

  const prefixedOrderNumber = /^#([1-9]\d*)$/.exec(value);
  if (prefixedOrderNumber) {
    const exactOrderNumber = parseSafeInteger(prefixedOrderNumber[1]);
    if (exactOrderNumber !== undefined) return { exactOrderNumber };
  }

  if (/^\d+$/.test(value)) {
    const exactOrderNumber = parseSafeInteger(value);
    if (value.length <= 2) {
      return exactOrderNumber === undefined ? undefined : { exactOrderNumber };
    }

    return {
      generalTerm: value,
      ...(exactOrderNumber === undefined ? {} : { exactOrderNumber }),
    };
  }

  return { generalTerm: value };
}

function escapePostgrestLikeLiteral(value: string) {
  const likeLiteral = value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  const quotedLiteral = likeLiteral
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  return `"%${quotedLiteral}%"`;
}

export function buildOrderSearchFilter(
  search: BusinessOrderSearch,
  includeBusinessOrderNumber: boolean,
) {
  const filters: string[] = [];

  if (search.generalTerm) {
    const pattern = escapePostgrestLikeLiteral(search.generalTerm);
    filters.push(
      `customer_name.ilike.${pattern}`,
      `customer_phone.ilike.${pattern}`,
    );
  }

  if (search.exactOrderNumber !== undefined) {
    const orderNumberColumn = includeBusinessOrderNumber
      ? "business_order_number"
      : "order_number";
    filters.push(`${orderNumberColumn}.eq.${search.exactOrderNumber}`);
  }

  return `(${filters.join(",")})`;
}
