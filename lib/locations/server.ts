import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  findDistrictByName,
  findProvinceByName,
  normalizeLocationLabel,
  type NeighborhoodOption,
} from "./index";

export type BusinessLocationInput = {
  city?: string | null;
  district?: string | null;
  neighborhood?: string | null;
};

function sameLocationValue(
  first: string | null | undefined,
  second: string | null | undefined,
) {
  return (
    normalizeLocationLabel(first).toLocaleLowerCase("tr-TR") ===
    normalizeLocationLabel(second).toLocaleLowerCase("tr-TR")
  );
}

async function readNeighborhoods(
  provinceId: number,
  districtId: number,
): Promise<readonly NeighborhoodOption[]> {
  const filePath = path.join(
    process.cwd(),
    "public",
    "locations",
    "neighborhoods",
    provinceId.toString(),
    `${districtId}.json`,
  );
  const file = await readFile(filePath, "utf8");
  const data = JSON.parse(file) as unknown;
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is NeighborhoodOption => {
    const option = item as Partial<NeighborhoodOption>;
    return (
      (option.type === "neighborhood" || option.type === "village") &&
      typeof option.id === "number" &&
      typeof option.name === "string" &&
      typeof option.label === "string" &&
      typeof option.value === "string"
    );
  });
}

export function hasBusinessLocationChanged(
  current: BusinessLocationInput,
  next: BusinessLocationInput,
) {
  return (
    !sameLocationValue(current.city, next.city) ||
    !sameLocationValue(current.district, next.district) ||
    !sameLocationValue(current.neighborhood, next.neighborhood)
  );
}

export async function isValidStandardBusinessLocation(
  input: BusinessLocationInput,
) {
  const province = findProvinceByName(input.city);
  if (!province) return false;

  const district = findDistrictByName(province.id, input.district);
  if (!district) return false;

  const neighborhoodValue = normalizeLocationLabel(input.neighborhood);
  if (!neighborhoodValue) return false;

  const neighborhoods = await readNeighborhoods(province.id, district.id);
  return neighborhoods.some((option) => option.value === neighborhoodValue);
}
