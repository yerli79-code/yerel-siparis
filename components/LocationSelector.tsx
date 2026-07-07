"use client";

import { useEffect, useMemo, useState } from "react";
import {
  findDistrictByName,
  findProvinceByName,
  getDistricts,
  getProvinces,
  loadNeighborhoods,
  normalizeLocationLabel,
  type NeighborhoodOption,
} from "../lib/locations";

type LocationSelectorValue = {
  city: string;
  district: string;
  neighborhood: string;
};

type LocationSelectorProps = {
  idPrefix: string;
  value: LocationSelectorValue;
  onChange: (value: LocationSelectorValue) => void;
  required?: boolean;
};

const legacyCityValue = "__legacy_city";
const legacyDistrictValue = "__legacy_district";
const legacyNeighborhoodValue = "__legacy_neighborhood";

function includesSearch(option: NeighborhoodOption, search: string) {
  if (!search) return true;
  const normalizedSearch = normalizeLocationLabel(search).toLocaleLowerCase("tr-TR");
  return (
    option.label.toLocaleLowerCase("tr-TR").includes(normalizedSearch) ||
    option.name.toLocaleLowerCase("tr-TR").includes(normalizedSearch)
  );
}

export default function LocationSelector({
  idPrefix,
  value,
  onChange,
  required = false,
}: LocationSelectorProps) {
  const [neighborhoods, setNeighborhoods] = useState<readonly NeighborhoodOption[]>([]);
  const [isLoadingNeighborhoods, setIsLoadingNeighborhoods] = useState(false);
  const [neighborhoodError, setNeighborhoodError] = useState("");
  const [neighborhoodSearch, setNeighborhoodSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const provinces = getProvinces();
  const selectedProvince = findProvinceByName(value.city);
  const districts = selectedProvince ? getDistricts(selectedProvince.id) : [];
  const selectedDistrict = selectedProvince
    ? findDistrictByName(selectedProvince.id, value.district)
    : null;
  const normalizedNeighborhood = normalizeLocationLabel(value.neighborhood);
  const hasLegacyCity = Boolean(value.city && !selectedProvince);
  const hasLegacyDistrict = Boolean(
    value.district && (!selectedProvince || !selectedDistrict),
  );
  const canLoadNeighborhoods = Boolean(selectedProvince && selectedDistrict);
  const hasKnownNeighborhood = neighborhoods.some(
    (option) => option.value === normalizedNeighborhood,
  );
  const hasLegacyNeighborhood = Boolean(
    value.neighborhood && (!canLoadNeighborhoods || (!isLoadingNeighborhoods && !hasKnownNeighborhood)),
  );

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
    loadNeighborhoods(selectedProvince.id, selectedDistrict.id)
      .then((options) => {
        if (isCancelled) return;
        setNeighborhoods(options);
        if (options.length === 0) {
          setNeighborhoodError("Mahalle / Köy seçenekleri yüklenemedi.");
        }
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
  const hasFilteredNeighborhoodResults =
    neighborhoodOptions.length > 0 || villageOptions.length > 0;
  const hasEmptyNeighborhoodSearchResult = Boolean(
    neighborhoodSearch.trim() &&
      !isLoadingNeighborhoods &&
      !neighborhoodError &&
      neighborhoods.length > 0 &&
      !hasFilteredNeighborhoodResults,
  );

  return (
    <div className="location-selector">
      <div className="field">
        <label htmlFor={`${idPrefix}-city`}>İl</label>
        <select
          id={`${idPrefix}-city`}
          required={required}
          value={selectedProvince?.id.toString() ?? (hasLegacyCity ? legacyCityValue : "")}
          onChange={(event) => {
            const selectedValue = event.target.value;
            if (!selectedValue) {
              onChange({ city: "", district: "", neighborhood: "" });
              return;
            }
            if (selectedValue === legacyCityValue) return;
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
          {hasLegacyCity ? (
            <option value={legacyCityValue}>Mevcut kayıt: {value.city}</option>
          ) : null}
          {provinces.map((province) => (
            <option key={province.id} value={province.id}>
              {province.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-district`}>İlçe</label>
        <select
          disabled={!selectedProvince && !hasLegacyDistrict}
          id={`${idPrefix}-district`}
          required={required}
          value={selectedDistrict?.id.toString() ?? (hasLegacyDistrict ? legacyDistrictValue : "")}
          onChange={(event) => {
            const selectedValue = event.target.value;
            if (!selectedValue) {
              onChange({ ...value, district: "", neighborhood: "" });
              return;
            }
            if (selectedValue === legacyDistrictValue) return;
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
          <option value="">
            {selectedProvince ? "İlçe seçin" : "Önce il seçin"}
          </option>
          {hasLegacyDistrict ? (
            <option value={legacyDistrictValue}>Mevcut kayıt: {value.district}</option>
          ) : null}
          {districts.map((district) => (
            <option key={district.id} value={district.id}>
              {district.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field location-selector-neighborhood">
        <label htmlFor={`${idPrefix}-neighborhood`}>Mahalle / Köy</label>
        <input
          aria-label="Mahalle / Köy seçeneklerinde ara"
          className="location-selector-search"
          disabled={!canLoadNeighborhoods || isLoadingNeighborhoods}
          placeholder="Mahalle / Köy ara"
          value={neighborhoodSearch}
          onChange={(event) => setNeighborhoodSearch(event.target.value)}
        />
        <select
          disabled={
            (!canLoadNeighborhoods && !hasLegacyNeighborhood) ||
            isLoadingNeighborhoods
          }
          id={`${idPrefix}-neighborhood`}
          required={required}
          value={hasKnownNeighborhood ? normalizedNeighborhood : hasLegacyNeighborhood ? legacyNeighborhoodValue : ""}
          onChange={(event) => {
            const selectedValue = event.target.value;
            if (selectedValue === legacyNeighborhoodValue) return;
            onChange({ ...value, neighborhood: selectedValue });
          }}
        >
          <option value="">
            {selectedDistrict ? "Mahalle / Köy seçin" : "Önce ilçe seçin"}
          </option>
          {hasLegacyNeighborhood ? (
            <option value={legacyNeighborhoodValue}>
              Mevcut kayıt: {value.neighborhood}
            </option>
          ) : null}
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
        {hasEmptyNeighborhoodSearchResult ? (
          <p className="location-selector-note">Sonuç bulunamadı.</p>
        ) : null}
        {isLoadingNeighborhoods ? (
          <p className="location-selector-note">Mahalle / Köy seçenekleri yükleniyor...</p>
        ) : null}
        {neighborhoodError ? (
          <div className="location-selector-error">
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
