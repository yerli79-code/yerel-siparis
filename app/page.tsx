"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Business } from "../lib/businesses";
import { fetchPublicActiveBusinesses } from "../lib/supabase-business";

type DiscoveryBusiness = Business & {
  city?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  minimumOrderAmount?: number | null;
  preparationTimeMinutes?: number | null;
  isOpen?: boolean;
  orderNote?: string | null;
};

const allFilterValue = "";

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .trim();
}

function formatPrice(price: number) {
  return `${price.toLocaleString("tr-TR")} TL`;
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  ).sort((first, second) => first.localeCompare(second, "tr-TR"));
}

function getLogoText(business: DiscoveryBusiness) {
  if (business.logoText?.trim()) return business.logoText.trim();
  return (
    business.name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toLocaleUpperCase("tr-TR") || "YS"
  );
}

function getLocationText(business: DiscoveryBusiness) {
  return [business.city, business.district, business.neighborhood]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" / ");
}

export default function Home() {
  const [businesses, setBusinesses] = useState<DiscoveryBusiness[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [cityFilter, setCityFilter] = useState(allFilterValue);
  const [districtFilter, setDistrictFilter] = useState(allFilterValue);
  const [neighborhoodFilter, setNeighborhoodFilter] = useState(allFilterValue);

  useEffect(() => {
    let isCancelled = false;

    async function loadBusinesses() {
      setIsLoading(true);
      setLoadError("");

      try {
        const supabaseBusinesses = await fetchPublicActiveBusinesses();
        if (isCancelled) return;
        setBusinesses(supabaseBusinesses);
      } catch {
        if (isCancelled) return;
        setBusinesses([]);
        setLoadError("İşletmeler şu anda yüklenemedi. Lütfen daha sonra tekrar deneyin.");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    loadBusinesses();

    return () => {
      isCancelled = true;
    };
  }, []);

  const cityOptions = useMemo(
    () => uniqueSorted(businesses.map((business) => business.city)),
    [businesses],
  );

  const districtOptions = useMemo(
    () =>
      uniqueSorted(
        businesses
          .filter((business) => !cityFilter || business.city === cityFilter)
          .map((business) => business.district),
      ),
    [businesses, cityFilter],
  );

  const neighborhoodOptions = useMemo(
    () =>
      uniqueSorted(
        businesses
          .filter((business) => !cityFilter || business.city === cityFilter)
          .filter((business) => !districtFilter || business.district === districtFilter)
          .map((business) => business.neighborhood),
      ),
    [businesses, cityFilter, districtFilter],
  );

  const filteredBusinesses = useMemo(() => {
    const normalizedQuery = normalizeSearchText(searchQuery);

    return businesses.filter((business) => {
      const searchFields = [
        business.name,
        business.city,
        business.district,
        business.neighborhood,
      ];
      const matchesSearch =
        !normalizedQuery ||
        searchFields.some((field) => normalizeSearchText(field).includes(normalizedQuery));
      const matchesCity = !cityFilter || business.city === cityFilter;
      const matchesDistrict = !districtFilter || business.district === districtFilter;
      const matchesNeighborhood =
        !neighborhoodFilter || business.neighborhood === neighborhoodFilter;

      return matchesSearch && matchesCity && matchesDistrict && matchesNeighborhood;
    });
  }, [businesses, cityFilter, districtFilter, neighborhoodFilter, searchQuery]);

  const hasActiveFilters = Boolean(
    searchQuery.trim() || cityFilter || districtFilter || neighborhoodFilter,
  );

  const activeFilterLabels = [
    searchQuery.trim() ? `Arama: ${searchQuery.trim()}` : "",
    cityFilter ? `Şehir: ${cityFilter}` : "",
    districtFilter ? `İlçe: ${districtFilter}` : "",
    neighborhoodFilter ? `Mahalle: ${neighborhoodFilter}` : "",
  ].filter(Boolean);

  function clearFilters() {
    setSearchQuery("");
    setCityFilter(allFilterValue);
    setDistrictFilter(allFilterValue);
    setNeighborhoodFilter(allFilterValue);
  }

  function updateCityFilter(value: string) {
    setCityFilter(value);
    setDistrictFilter(allFilterValue);
    setNeighborhoodFilter(allFilterValue);
  }

  function updateDistrictFilter(value: string) {
    setDistrictFilter(value);
    setNeighborhoodFilter(allFilterValue);
  }

  return (
    <main className="page">
      <div className="shell discovery-shell">
        <header className="discovery-hero">
          <div className="discovery-hero-copy">
            <span className="eyebrow">Yerel Sipariş</span>
            <h1>Yakınındaki işletmelerden kolayca sipariş ver</h1>
            <p>
              İşletme adı veya konum bilgisiyle arayın, menüyü inceleyin ve
              WhatsApp üzerinden hızlıca sipariş oluşturun.
            </p>
          </div>
          <Link className="admin-link discovery-login-link" href="/giris">
            İşletme Girişi
          </Link>
        </header>

        <section className="discovery-filter-card" aria-label="İşletme arama ve filtreleme">
          <label className="discovery-search">
            <span>İşletme ara</span>
            <input
              placeholder="İşletme adı, şehir, ilçe veya mahalle ara"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>

          <div className="discovery-filter-grid">
            <label className="discovery-select">
              <span>Şehir</span>
              <select
                value={cityFilter}
                onChange={(event) => updateCityFilter(event.target.value)}
              >
                <option value={allFilterValue}>Tüm şehirler</option>
                {cityOptions.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </label>

            <label className="discovery-select">
              <span>İlçe</span>
              <select
                value={districtFilter}
                onChange={(event) => updateDistrictFilter(event.target.value)}
              >
                <option value={allFilterValue}>Tüm ilçeler</option>
                {districtOptions.map((district) => (
                  <option key={district} value={district}>
                    {district}
                  </option>
                ))}
              </select>
            </label>

            <label className="discovery-select">
              <span>Mahalle</span>
              <select
                value={neighborhoodFilter}
                onChange={(event) => setNeighborhoodFilter(event.target.value)}
              >
                <option value={allFilterValue}>Tüm mahalleler</option>
                {neighborhoodOptions.map((neighborhood) => (
                  <option key={neighborhood} value={neighborhood}>
                    {neighborhood}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {isLoading ? (
          <section className="section discovery-state">
            <p>İşletmeler yükleniyor...</p>
          </section>
        ) : null}

        {!isLoading && loadError ? (
          <section className="section discovery-state">
            <h2>İşletmeler yüklenemedi</h2>
            <p>{loadError}</p>
          </section>
        ) : null}

        {!isLoading && !loadError ? (
          <section className="discovery-results-header" aria-live="polite">
            <div>
              <strong>
                Toplam {businesses.length} işletmeden {filteredBusinesses.length} tanesi
                gösteriliyor.
              </strong>
              {activeFilterLabels.length > 0 ? (
                <div className="discovery-active-filters">
                  {activeFilterLabels.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
              ) : null}
            </div>
            {hasActiveFilters ? (
              <button className="discovery-clear-button" type="button" onClick={clearFilters}>
                Filtreleri Temizle
              </button>
            ) : null}
          </section>
        ) : null}

        {!isLoading && !loadError && businesses.length === 0 ? (
          <section className="section discovery-state">
            <h2>Henüz aktif işletme bulunmuyor.</h2>
            <p>Yakında burada sipariş alabilen yerel işletmeler listelenecek.</p>
          </section>
        ) : null}

        {!isLoading &&
        !loadError &&
        businesses.length > 0 &&
        filteredBusinesses.length === 0 ? (
          <section className="section discovery-state">
            <h2>Aramanıza uygun işletme bulunamadı.</h2>
            <p>Arama veya filtreleri temizleyip tekrar deneyin.</p>
          </section>
        ) : null}

        {!isLoading && !loadError && filteredBusinesses.length > 0 ? (
          <section className="discovery-grid" aria-label="Aktif işletmeler">
            {filteredBusinesses.map((business) => {
              const locationText = getLocationText(business);
              const coverImageUrl = business.coverImageUrl?.trim();
              const minimumOrderAmount =
                typeof business.minimumOrderAmount === "number" &&
                Number.isFinite(business.minimumOrderAmount) &&
                business.minimumOrderAmount > 0
                  ? business.minimumOrderAmount
                  : null;
              const preparationTimeMinutes =
                typeof business.preparationTimeMinutes === "number" &&
                Number.isFinite(business.preparationTimeMinutes) &&
                business.preparationTimeMinutes > 0
                  ? business.preparationTimeMinutes
                  : null;
              const deliveryStatus = business.deliveryStatus?.trim();
              const orderNote = business.orderNote?.trim();

              return (
                <article className="discovery-card" key={business.slug}>
                  <div
                    className={`discovery-cover ${coverImageUrl ? "has-image" : ""}`}
                    style={
                      coverImageUrl
                        ? { backgroundImage: `url("${coverImageUrl.replaceAll('"', "%22")}")` }
                        : undefined
                    }
                  >
                    {!coverImageUrl ? <span>Yerel Sipariş</span> : null}
                  </div>

                  <div className="discovery-card-body">
                    <div className="discovery-card-head">
                      <div className="discovery-logo" aria-hidden="true">
                        {business.logoUrl ? (
                          <img alt="" src={business.logoUrl} />
                        ) : (
                          <span>{getLogoText(business)}</span>
                        )}
                      </div>
                      <div>
                        <h2>{business.name}</h2>
                        {locationText ? <p>{locationText}</p> : null}
                      </div>
                    </div>

                    {business.description ? (
                      <p className="discovery-description">{business.description}</p>
                    ) : null}

                    <div className="discovery-badges">
                      {business.isOpen === false ? (
                        <span className="discovery-badge closed">Şu an kapalı</span>
                      ) : (
                        <span className="discovery-badge">Siparişe açık</span>
                      )}
                      {deliveryStatus ? (
                        <span className="discovery-badge">{deliveryStatus}</span>
                      ) : null}
                      {minimumOrderAmount !== null ? (
                        <span className="discovery-badge">
                          Min. {formatPrice(minimumOrderAmount)}
                        </span>
                      ) : null}
                      {preparationTimeMinutes !== null ? (
                        <span className="discovery-badge">
                          Tahmini {preparationTimeMinutes} dk
                        </span>
                      ) : null}
                    </div>

                    {orderNote ? <p className="discovery-note">{orderNote}</p> : null}

                    <Link
                      className="submit-button link-button discovery-order-link"
                      href={`/isletme/${business.slug}`}
                    >
                      Sipariş Ver
                    </Link>
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}
      </div>
    </main>
  );
}
