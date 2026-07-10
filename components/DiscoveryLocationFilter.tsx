"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getDistricts,
  getProvinces,
  loadNeighborhoods,
  loadNeighborhoodsOrThrow,
  normalizeLocationLabel,
} from "../lib/locations";

export type DiscoveryLocationValue = {
  city: string;
  district: string;
  neighborhood: string;
};

type NeighborhoodOption = Awaited<ReturnType<typeof loadNeighborhoods>>[number];

type DiscoveryLocationFilterProps = {
  value: DiscoveryLocationValue;
  onChange: (value: DiscoveryLocationValue) => void;
};

function sameLabel(first: string | null | undefined, second: string | null | undefined) {
  return (
    normalizeLocationLabel(first).toLocaleLowerCase("tr-TR") ===
    normalizeLocationLabel(second).toLocaleLowerCase("tr-TR")
  );
}

function includesSearch(option: NeighborhoodOption, search: string) {
  if (!search) return true;
  const normalizedSearch = normalizeLocationLabel(search).toLocaleLowerCase("tr-TR");
  return (
    option.label.toLocaleLowerCase("tr-TR").includes(normalizedSearch) ||
    option.name.toLocaleLowerCase("tr-TR").includes(normalizedSearch)
  );
}

export default function DiscoveryLocationFilter({
  value,
  onChange,
}: DiscoveryLocationFilterProps) {
  const [neighborhoods, setNeighborhoods] = useState<readonly NeighborhoodOption[]>([]);
  const [isLoadingNeighborhoods, setIsLoadingNeighborhoods] = useState(false);
  const [neighborhoodError, setNeighborhoodError] = useState("");
  const [neighborhoodSearch, setNeighborhoodSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const provinces = getProvinces();
  const selectedProvince =
    provinces.find((province) => sameLabel(province.name, value.city)) ?? null;
  const districts = selectedProvince ? getDistricts(selectedProvince.id) : [];
  const selectedDistrict =
    districts.find((district) => sameLabel(district.name, value.district)) ?? null;
  const canLoadNeighborhoods = Boolean(selectedProvince && selectedDistrict);

  useEffect(() => {
    let isCancelled = false;
    setNeighborhoodSearch("");
    setNeighborhoodError("");

    if (!selectedProvince || !selectedDistrict) {
      setNeighborhoods([]);
      setIsLoadingNeighborhoods(false);
      return;
    }

    setIsLoadingNeighborhoods(true);
    loadNeighborhoodsOrThrow(selectedProvince.id, selectedDistrict.id)
      .then((options) => {
        if (isCancelled) return;
        setNeighborhoods(options);
      })
      .catch(() => {
        if (isCancelled) return;
        setNeighborhoods([]);
        setNeighborhoodError("Mahalle / Köy seçenekleri yüklenemedi.");
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingNeighborhoods(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedProvince?.id, selectedDistrict?.id, reloadKey]);

  const filteredNeighborhoods = useMemo(
    () => neighborhoods.filter((option) => includesSearch(option, neighborhoodSearch)),
    [neighborhoodSearch, neighborhoods],
  );
  const neighborhoodOptions = filteredNeighborhoods.filter(
    (option) => option.type === "neighborhood",
  );
  const villageOptions = filteredNeighborhoods.filter((option) => option.type === "village");
  const hasFilteredResults = neighborhoodOptions.length > 0 || villageOptions.length > 0;
  const hasEmptySearchResult = Boolean(
    neighborhoodSearch.trim() &&
      !isLoadingNeighborhoods &&
      !neighborhoodError &&
      neighborhoods.length > 0 &&
      !hasFilteredResults,
  );

  return (
    <div className="discovery-location-filter">
      <label className="discovery-select">
        <span>İl</span>
        <select
          value={selectedProvince?.id.toString() ?? ""}
          onChange={(event) => {
            const selectedValue = event.target.value;
            if (!selectedValue) {
              onChange({ city: "", district: "", neighborhood: "" });
              return;
            }
            const province = provinces.find(
              (option) => option.id.toString() === selectedValue,
            );
            onChange({
              city: province?.name ?? "",
              district: "",
              neighborhood: "",
            });
          }}
        >
          <option value="">İl seçin</option>
          {provinces.map((province) => (
            <option key={province.id} value={province.id}>
              {province.name}
            </option>
          ))}
        </select>
      </label>

      <label className="discovery-select">
        <span>İlçe</span>
        <select
          disabled={!selectedProvince}
          value={selectedDistrict?.id.toString() ?? ""}
          onChange={(event) => {
            const selectedValue = event.target.value;
            if (!selectedValue) {
              onChange({ ...value, district: "", neighborhood: "" });
              return;
            }
            const district = districts.find(
              (option) => option.id.toString() === selectedValue,
            );
            onChange({
              ...value,
              district: district?.name ?? "",
              neighborhood: "",
            });
          }}
        >
          <option value="">{selectedProvince ? "İlçe seçin" : "Önce il seçin"}</option>
          {districts.map((district) => (
            <option key={district.id} value={district.id}>
              {district.name}
            </option>
          ))}
        </select>
      </label>

      <div className="discovery-location-neighborhood">
        <label className="discovery-select" htmlFor="discovery-neighborhood-search">
          <span>Mahalle / Köy ara</span>
          <input
            className="discovery-location-search"
            disabled={!canLoadNeighborhoods || isLoadingNeighborhoods}
            id="discovery-neighborhood-search"
            placeholder="Mahalle / Köy ara"
            type="search"
            value={neighborhoodSearch}
            onChange={(event) => setNeighborhoodSearch(event.target.value)}
          />
        </label>

        <label className="discovery-select">
          <span>Mahalle / Köy</span>
          <select
            disabled={!canLoadNeighborhoods || isLoadingNeighborhoods}
            value={value.neighborhood}
            onChange={(event) =>
              onChange({ ...value, neighborhood: event.target.value })
            }
          >
            <option value="">
              {selectedDistrict ? "Mahalle / Köy seçin" : "Önce ilçe seçin"}
            </option>
            {neighborhoodOptions.length > 0 ? (
              <optgroup label="Mahalleler">
                {neighborhoodOptions.map((option) => (
                  <option key={`${option.type}-${option.id}-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {villageOptions.length > 0 ? (
              <optgroup label="Köyler">
                {villageOptions.map((option) => (
                  <option key={`${option.type}-${option.id}-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>

        {isLoadingNeighborhoods ? (
          <p className="discovery-location-note">
            Mahalle / Köy seçenekleri yükleniyor...
          </p>
        ) : null}
        {hasEmptySearchResult ? (
          <p className="discovery-location-note">Sonuç bulunamadı.</p>
        ) : null}
        {neighborhoodError ? (
          <div className="discovery-location-error">
            <span>{neighborhoodError}</span>
            <button type="button" onClick={() => setReloadKey((current) => current + 1)}>
              Tekrar dene
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
