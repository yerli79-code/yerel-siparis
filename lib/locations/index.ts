import { DISTRICTS } from "./districts";
import { PROVINCES } from "./provinces";

export type LocationOption = {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
};

export type DistrictOption = LocationOption & {
  readonly provinceId: number;
};

export type NeighborhoodKind = "neighborhood" | "village";

export type NeighborhoodOption = {
  readonly type: NeighborhoodKind;
  readonly id: number;
  readonly name: string;
  readonly label: string;
  readonly value: string;
};

export type LegacyLocationValue = {
  readonly value: string;
  readonly isLegacy: boolean;
};

const neighborhoodCache = new Map<string, readonly NeighborhoodOption[]>();

function toId(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

export function normalizeLocationLabel(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function getProvinces(): readonly LocationOption[] {
  return PROVINCES;
}

export function getDistricts(provinceId: number | string | null | undefined): readonly DistrictOption[] {
  const normalizedProvinceId = toId(provinceId);
  if (normalizedProvinceId === null) return [];
  return DISTRICTS.filter((district) => district.provinceId === normalizedProvinceId);
}

export function findProvinceByName(value: string | null | undefined): LocationOption | null {
  const normalizedValue = normalizeLocationLabel(value).toLocaleLowerCase("tr-TR");
  if (!normalizedValue) return null;
  return (
    PROVINCES.find(
      (province) =>
        normalizeLocationLabel(province.name).toLocaleLowerCase("tr-TR") ===
        normalizedValue,
    ) ?? null
  );
}

export function findDistrictByName(
  provinceId: number | string | null | undefined,
  value: string | null | undefined,
): DistrictOption | null {
  const normalizedValue = normalizeLocationLabel(value).toLocaleLowerCase("tr-TR");
  if (!normalizedValue) return null;
  return (
    getDistricts(provinceId).find(
      (district) =>
        normalizeLocationLabel(district.name).toLocaleLowerCase("tr-TR") ===
        normalizedValue,
    ) ?? null
  );
}

export async function loadNeighborhoods(
  provinceId: number | string | null | undefined,
  districtId: number | string | null | undefined,
): Promise<readonly NeighborhoodOption[]> {
  return loadNeighborhoodsFromPublicFiles(provinceId, districtId, false);
}

export async function loadNeighborhoodsOrThrow(
  provinceId: number | string | null | undefined,
  districtId: number | string | null | undefined,
): Promise<readonly NeighborhoodOption[]> {
  return loadNeighborhoodsFromPublicFiles(provinceId, districtId, true);
}

async function loadNeighborhoodsFromPublicFiles(
  provinceId: number | string | null | undefined,
  districtId: number | string | null | undefined,
  shouldThrowOnFailure: boolean,
): Promise<readonly NeighborhoodOption[]> {
  const normalizedProvinceId = toId(provinceId);
  const normalizedDistrictId = toId(districtId);
  if (normalizedProvinceId === null || normalizedDistrictId === null) return [];

  const cacheKey = `${normalizedProvinceId}/${normalizedDistrictId}`;
  const cached = neighborhoodCache.get(cacheKey);
  if (cached && (!shouldThrowOnFailure || cached.length > 0)) return cached;

  const response = await fetch(
    `/locations/neighborhoods/${normalizedProvinceId}/${normalizedDistrictId}.json`,
  );
  if (!response.ok) {
    if (shouldThrowOnFailure) {
      throw new Error("Neighborhood options could not be loaded.");
    }
    neighborhoodCache.set(cacheKey, []);
    return [];
  }

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) {
    if (shouldThrowOnFailure) {
      throw new Error("Neighborhood options could not be loaded.");
    }
    neighborhoodCache.set(cacheKey, []);
    return [];
  }

  const options = data.filter(isNeighborhoodOption);
  neighborhoodCache.set(cacheKey, options);
  return options;
}

export function isKnownProvince(provinceId: number | string | null | undefined): boolean {
  const normalizedProvinceId = toId(provinceId);
  return normalizedProvinceId !== null && PROVINCES.some((province) => province.id === normalizedProvinceId);
}

export function isKnownDistrict(
  provinceId: number | string | null | undefined,
  districtId: number | string | null | undefined,
): boolean {
  const normalizedProvinceId = toId(provinceId);
  const normalizedDistrictId = toId(districtId);
  return (
    normalizedProvinceId !== null &&
    normalizedDistrictId !== null &&
    DISTRICTS.some(
      (district) => district.id === normalizedDistrictId && district.provinceId === normalizedProvinceId,
    )
  );
}

export async function isKnownNeighborhood(
  provinceId: number | string | null | undefined,
  districtId: number | string | null | undefined,
  value: string | null | undefined,
): Promise<boolean> {
  const normalizedValue = normalizeLocationLabel(value);
  if (!normalizedValue) return false;
  const neighborhoods = await loadNeighborhoods(provinceId, districtId);
  return neighborhoods.some((option) => option.value === normalizedValue);
}

export function toLegacyLocationValue(value: string | null | undefined): LegacyLocationValue | null {
  const normalizedValue = normalizeLocationLabel(value);
  if (!normalizedValue) return null;
  return { value: normalizedValue, isLegacy: true };
}

export function resolveDisplayLocationValue(
  value: string | null | undefined,
  knownValues: readonly string[],
): LegacyLocationValue | null {
  const normalizedValue = normalizeLocationLabel(value);
  if (!normalizedValue) return null;
  return { value: normalizedValue, isLegacy: !knownValues.includes(normalizedValue) };
}

function isNeighborhoodOption(value: unknown): value is NeighborhoodOption {
  if (!value || typeof value !== "object") return false;
  const option = value as Partial<NeighborhoodOption>;
  return (
    (option.type === "neighborhood" || option.type === "village") &&
    typeof option.id === "number" &&
    typeof option.name === "string" &&
    typeof option.label === "string" &&
    typeof option.value === "string"
  );
}
