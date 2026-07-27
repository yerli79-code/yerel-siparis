"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import DiscoveryLocationFilter, {
  type DiscoveryLocationValue,
} from "../components/DiscoveryLocationFilter";
import PlatformBrand from "../components/PlatformBrand";
import type { Business } from "../lib/businesses";
import { normalizeLocationLabel } from "../lib/locations";
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

function normalizeFilterValue(value: string | null | undefined) {
  return normalizeLocationLabel(value).toLocaleLowerCase("tr-TR");
}

function sameLocationValue(first: string | null | undefined, second: string) {
  return normalizeFilterValue(first) === normalizeFilterValue(second);
}

function formatPrice(price: number) {
  return `${price.toLocaleString("tr-TR")} TL`;
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
  const [locationFilter, setLocationFilter] = useState<DiscoveryLocationValue>({
    city: "",
    district: "",
    neighborhood: "",
  });

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

  const hasSearchQuery = Boolean(searchQuery.trim());
  const hasLocationFilter = Boolean(
    locationFilter.city || locationFilter.district || locationFilter.neighborhood,
  );
  const shouldShowBusinesses = hasSearchQuery || hasLocationFilter;

  const selectedLocationBusinesses = useMemo(
    () =>
      businesses.filter((business) => {
        const matchesCity =
          !locationFilter.city || sameLocationValue(business.city, locationFilter.city);
        const matchesDistrict =
          !locationFilter.district ||
          sameLocationValue(business.district, locationFilter.district);
        const matchesNeighborhood =
          !locationFilter.neighborhood ||
          sameLocationValue(business.neighborhood, locationFilter.neighborhood);

        return matchesCity && matchesDistrict && matchesNeighborhood;
      }),
    [businesses, locationFilter],
  );

  const filteredBusinesses = useMemo(() => {
    const normalizedQuery = normalizeSearchText(searchQuery);

    return selectedLocationBusinesses.filter((business) => {
      const searchFields = [
        business.name,
        business.city,
        business.district,
        business.neighborhood,
      ];
      return (
        !normalizedQuery ||
        searchFields.some((field) => normalizeSearchText(field).includes(normalizedQuery))
      );
    });
  }, [searchQuery, selectedLocationBusinesses]);

  const hasActiveFilters = Boolean(
    hasSearchQuery || hasLocationFilter,
  );

  const activeFilterLabels = [
    searchQuery.trim() ? `Arama: ${searchQuery.trim()}` : "",
    locationFilter.city ? `İl: ${locationFilter.city}` : "",
    locationFilter.district ? `İlçe: ${locationFilter.district}` : "",
    locationFilter.neighborhood ? `Mahalle / Köy: ${locationFilter.neighborhood}` : "",
  ].filter(Boolean);

  const emptyState = (() => {
    if (isLoading || loadError || filteredBusinesses.length > 0) return null;

    if (!shouldShowBusinesses) {
      return businesses.length === 0
        ? {
            title: "Henüz aktif işletme bulunmuyor.",
            description: "Yakında burada sipariş alabilen yerel işletmeler listelenecek.",
          }
        : {
            title: "İşletmeleri görmek için konum seçin veya işletme adıyla arayın.",
            description:
              "İl seçerek bölgenizdeki işletmeleri listeleyebilir ya da işletme adını yazabilirsiniz.",
          };
    }

    if (hasSearchQuery) {
      return {
        title: "Aramanıza uygun işletme bulunamadı.",
        description: "Arama metnini temizleyip tekrar deneyin.",
      };
    }

    if (hasLocationFilter) {
      return {
        title: "Bu konumda henüz işletme bulunmuyor.",
        description: "Yakındaki başka bir Mahalle / Köy seçerek tekrar deneyin.",
      };
    }

    return null;
  })();

  function clearFilters() {
    setSearchQuery("");
    setLocationFilter({ city: "", district: "", neighborhood: "" });
  }

  return (
    <main className="page">
      <div className="shell discovery-shell">
        <header className="discovery-hero">
          <div className="discovery-hero-copy">
            <PlatformBrand className="discovery-platform-brand" publicVariant />
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
          <label
            className="discovery-search"
            data-mobile-placeholder="İşletme veya konum ara"
          >
            <span>İşletme ara</span>
            <input
              aria-label="İşletme ara"
              placeholder="İşletme adı, il, ilçe veya Mahalle / Köy ara"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>

          <DiscoveryLocationFilter
            value={locationFilter}
            onChange={setLocationFilter}
          />
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

        {!isLoading && !loadError && shouldShowBusinesses ? (
          <section className="discovery-results-header" aria-live="polite">
            <div>
              <strong>
                {filteredBusinesses.length} işletme gösteriliyor.
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

        {emptyState ? (
          <section className="section discovery-state">
            <h2>{emptyState.title}</h2>
            <p>{emptyState.description}</p>
          </section>
        ) : null}

        {!isLoading && !loadError && shouldShowBusinesses && filteredBusinesses.length > 0 ? (
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
