"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import LocationSelector from "../../components/LocationSelector";
import type { Business } from "../../lib/businesses";
import {
  createBusinessWithAccount,
  fetchAdminBusinessPage,
  fetchAdminOverview,
} from "../../lib/supabase-admin";
import {
  formatDate,
  getAdminSubscriptionStatusLabel,
  getBadge,
  isEndingWithinDays,
  isSubscriptionExpired,
  type AdminKpis,
} from "../../lib/subscription";
import {
  clearLegacyAdminBusinessCache,
  clearLegacyAdminBrowserSession,
  loginAdmin,
  logoutAdmin as requestAdminLogout,
  readAdminSession,
} from "../../lib/admin-client";
import {
  findProvinceByName,
  getDistricts,
  getProvinces,
} from "../../lib/locations";
import {
  ADMIN_BUSINESS_DEFAULT_PAGE_SIZE,
  type AdminBusinessAccessFilter,
  type AdminBusinessCreatedFilter,
  type AdminBusinessListQuery,
  type AdminBusinessPagination,
  type AdminBusinessSort,
  type AdminBusinessSubscriptionFilter,
} from "../../lib/admin/business-list-contract";
import AdminLogin, { AdminLoading } from "./_components/admin-login";
import AdminOverview from "./_components/admin-overview";
import AdminShell, { type AdminSection } from "./_components/admin-shell";
import adminStyles from "./_components/admin.module.css";

const adminSessionExpiredMessage = "Oturumunuz sona erdi. Lütfen tekrar giriş yapın.";

type NewBusinessForm = {
  name: string;
  slug: string;
  city: string;
  district: string;
  neighborhood: string;
  address: string;
  whatsappOrderNumber: string;
  description: string;
  ownerEmail: string;
  temporaryPassword: string;
  subscriptionStatus: "active" | "expired" | "blocked";
  subscriptionStartedAt: string;
  subscriptionExpiresAt: string;
  isActive: boolean;
};

const emptyNewBusinessForm: NewBusinessForm = {
  name: "",
  slug: "",
  city: "",
  district: "",
  neighborhood: "",
  address: "",
  whatsappOrderNumber: "",
  description: "",
  ownerEmail: "",
  temporaryPassword: "",
  subscriptionStatus: "expired",
  subscriptionStartedAt: "",
  subscriptionExpiresAt: "",
  isActive: false,
};

type CreatedBusinessCredentials = {
  email: string;
  temporaryPassword: string;
};

function endOfSelectedDate(value: string) {
  return new Date(`${value}T23:59:59`).toISOString();
}

function startOfSelectedDate(value: string) {
  return new Date(`${value}T00:00:00`).toISOString();
}

function slugify(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ç", "c")
    .replaceAll("ğ", "g")
    .replaceAll("ı", "i")
    .replaceAll("ö", "o")
    .replaceAll("ş", "s")
    .replaceAll("ü", "u")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const emptyAdminKpis: AdminKpis = {
  total: 0,
  active: 0,
  inactive: 0,
  createdLastSevenDays: 0,
  activeSubscriptions: 0,
  expiringSubscriptions: 0,
};

const emptyPagination: AdminBusinessPagination = {
  page: 1,
  pageSize: ADMIN_BUSINESS_DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 0,
};

export default function AdminPage() {
  const router = useRouter();
  const [isAdminAuthorized, setIsAdminAuthorized] = useState(false);
  const [isCheckingAdmin, setIsCheckingAdmin] = useState(true);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [isAdminSigningIn, setIsAdminSigningIn] = useState(false);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessLoadError, setBusinessLoadError] = useState(false);
  const [overviewLoadError, setOverviewLoadError] = useState(false);
  const [isRefreshingBusinesses, setIsRefreshingBusinesses] = useState(false);
  const [message, setMessage] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [newBusinessForm, setNewBusinessForm] = useState<NewBusinessForm>(
    emptyNewBusinessForm,
  );
  const [isNewBusinessSlugTouched, setIsNewBusinessSlugTouched] =
    useState(false);
  const [isCreatingBusiness, setIsCreatingBusiness] = useState(false);
  const [createdBusinessCredentials, setCreatedBusinessCredentials] =
    useState<CreatedBusinessCredentials | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<AdminBusinessAccessFilter>("all");
  const [subscriptionFilter, setSubscriptionFilter] =
    useState<AdminBusinessSubscriptionFilter>("all");
  const [createdFilter, setCreatedFilter] =
    useState<AdminBusinessCreatedFilter>("all");
  const [sort, setSort] = useState<AdminBusinessSort>("newest");
  const [cityFilter, setCityFilter] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ADMIN_BUSINESS_DEFAULT_PAGE_SIZE);
  const [pagination, setPagination] =
    useState<AdminBusinessPagination>(emptyPagination);
  const [adminKpis, setAdminKpis] = useState<AdminKpis>(emptyAdminKpis);
  const [isInitialListLoading, setIsInitialListLoading] = useState(true);
  const [isInitialOverviewLoading, setIsInitialOverviewLoading] = useState(true);
  const [activeAdminSection, setActiveAdminSection] =
    useState<AdminSection>("overview");
  const listRequestSequence = useRef(0);
  const overviewRequestSequence = useRef(0);
  const attentionBusinesses = businesses
    .filter(
      (business) =>
        isEndingWithinDays(business, 30) ||
        isSubscriptionExpired(business) ||
        !business.isActive ||
        business.subscriptionStatus === "blocked",
    )
    .slice(0, 5);
  const cityOptions = getProvinces();
  const selectedFilterProvince = findProvinceByName(cityFilter);
  const districtOptions = selectedFilterProvince
    ? getDistricts(selectedFilterProvince.id)
    : [];
  const trimmedSearchQuery = searchQuery.trim();
  const filteredBusinesses = businesses;
  const hasActiveFilters = Boolean(
    trimmedSearchQuery ||
    statusFilter !== "all" ||
    subscriptionFilter !== "all" ||
    createdFilter !== "all" ||
    sort !== "newest" ||
    cityFilter ||
    districtFilter,
  );
  const activeFilterLabels = [
    trimmedSearchQuery ? `Arama: ${trimmedSearchQuery}` : "",
    statusFilter !== "all"
      ? `Durum: ${statusFilter === "active" ? "Aktif" : "Pasif"}`
      : "",
    subscriptionFilter !== "all"
      ? `Abonelik: ${
          {
            active: "Aktif abonelik",
            expired: "Süresi dolmuş",
            passive: "Pasif",
            blocked: "Engelli",
            ending7: "Son 7 gün içinde bitecekler",
            ending30: "Son 30 gün içinde bitecekler",
          }[subscriptionFilter]
        }`
      : "",
    createdFilter === "last7" ? "Oluşturulma: Son 7 gün" : "",
    sort === "name_asc" ? "Sıralama: İşletme adı" : "",
    cityFilter ? `Şehir: ${cityFilter}` : "",
    districtFilter ? `İlçe: ${districtFilter}` : "",
  ].filter(Boolean);
  const listedBusinesses = filteredBusinesses;
  const visibleFrom = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const visibleTo = Math.min(
    pagination.page * pagination.pageSize,
    pagination.total,
  );
  const isGlobalBusinessListEmpty = !hasActiveFilters && pagination.total === 0;

  const loadBusinessPage = useCallback(
    async (query: AdminBusinessListQuery, signal?: AbortSignal) => {
      const sequence = ++listRequestSequence.current;
      const result = await fetchAdminBusinessPage(query, signal);
      if (signal?.aborted || sequence !== listRequestSequence.current) return null;

      const nextBusinesses: Business[] = result.items.map((business) => ({
        ...business,
        productCategories: [],
      }));
      setBusinesses(nextBusinesses);
      setPagination(result.pagination);
      setBusinessLoadError(false);
      return result;
    },
    [],
  );

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++overviewRequestSequence.current;
    const result = await fetchAdminOverview(signal);
    if (signal?.aborted || sequence !== overviewRequestSequence.current) return null;
    setAdminKpis(result);
    setOverviewLoadError(false);
    return result;
  }, []);

  useEffect(() => {
    let isCancelled = false;

    clearLegacyAdminBrowserSession();
    clearLegacyAdminBusinessCache();

    async function checkAdminSession() {
      try {
        const session = await readAdminSession();
        if (isCancelled) return;

        if (!session) {
          setIsAdminAuthorized(false);
          return;
        }

        setIsAdminAuthorized(true);
      } catch {
        if (isCancelled) return;
        setAdminError(adminSessionExpiredMessage);
        setIsAdminAuthorized(false);
      } finally {
        if (!isCancelled) setIsCheckingAdmin(false);
      }
    }

    checkAdminSession();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("section") === "businesses") {
      setActiveAdminSection("businesses");
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(trimmedSearchQuery);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [trimmedSearchQuery]);

  useEffect(() => {
    if (!isAdminAuthorized) return;
    const controller = new AbortController();
    setIsRefreshingBusinesses(true);

    loadBusinessPage(
      {
        q: debouncedSearchQuery,
        page,
        pageSize,
        access: statusFilter,
        subscription: subscriptionFilter,
        created: createdFilter,
        sort,
        city: cityFilter,
        district: districtFilter,
      },
      controller.signal,
    )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setBusinessLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsRefreshingBusinesses(false);
          setIsInitialListLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    cityFilter,
    createdFilter,
    debouncedSearchQuery,
    districtFilter,
    isAdminAuthorized,
    loadBusinessPage,
    page,
    pageSize,
    sort,
    statusFilter,
    subscriptionFilter,
  ]);

  useEffect(() => {
    if (!isAdminAuthorized) return;
    const controller = new AbortController();
    loadOverview(controller.signal)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setOverviewLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsInitialOverviewLoading(false);
      });
    return () => controller.abort();
  }, [isAdminAuthorized, loadOverview]);

  function updateNewBusinessForm(
    field: keyof NewBusinessForm,
    value: string | boolean,
  ) {
    setMessage("");
    setErrorDetail("");
    setCreatedBusinessCredentials(null);
    if (field === "slug" && typeof value === "string") {
      setIsNewBusinessSlugTouched(true);
    }

    setNewBusinessForm((current) => {
      if (field === "name" && typeof value === "string") {
        return {
          ...current,
          name: value,
          slug: isNewBusinessSlugTouched ? current.slug : slugify(value),
        };
      }

      if (field === "slug" && typeof value === "string") {
        return { ...current, slug: slugify(value) };
      }

      return { ...current, [field]: value };
    });
  }

  function clearAdminFilters() {
    setSearchQuery("");
    setStatusFilter("all");
    setSubscriptionFilter("all");
    setCreatedFilter("all");
    setSort("newest");
    setCityFilter("");
    setDistrictFilter("");
    setPage(1);
  }

  function switchAdminSection(section: AdminSection) {
    setActiveAdminSection(section);
    setMessage("");
    setErrorDetail("");
  }

  function openBusinessDetail(business: Business) {
    if (!business.id) {
      setMessage("Bu işletmenin kayıt kimliği bulunamadı. Listeyi yenileyin.");
      return;
    }
    router.push(`/admin/isletmeler/${business.id}`);
    setMessage("");
    setErrorDetail("");
  }

  function currentListQuery(targetPage = page): AdminBusinessListQuery {
    return {
      q: debouncedSearchQuery,
      page: targetPage,
      pageSize,
      access: statusFilter,
      subscription: subscriptionFilter,
      created: createdFilter,
      sort,
      city: cityFilter,
      district: districtFilter,
    };
  }

  async function refreshBusinessesFromSupabase(targetPage = page) {
    return loadBusinessPage(currentListQuery(targetPage));
  }

  async function refreshAdminData(targetPage = page) {
    const [listResult, overviewResult] = await Promise.allSettled([
      refreshBusinessesFromSupabase(targetPage),
      loadOverview(),
    ]);
    if (listResult.status === "rejected") setBusinessLoadError(true);
    if (overviewResult.status === "rejected") setOverviewLoadError(true);
    return listResult.status === "fulfilled" && overviewResult.status === "fulfilled";
  }

  async function refreshAdminList() {
    setIsRefreshingBusinesses(true);
    setMessage("İşletme listesi yenileniyor...");
    setErrorDetail("");

    try {
      const refreshed = await refreshAdminData();
      if (!refreshed) throw new Error("Admin verileri yenilenemedi.");
      setMessage("İşletme listesi yenilendi.");
    } catch {
      setMessage("İşletme listesi yenilenemedi.");
      setErrorDetail("Liste yüklenemedi. Lütfen tekrar deneyin.");
      setBusinessLoadError(true);
    } finally {
      setIsRefreshingBusinesses(false);
    }
  }

  async function submitNewBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setErrorDetail("");

    const slug = slugify(newBusinessForm.slug);
    if (!newBusinessForm.name.trim()) {
      setMessage("İşletme adı zorunludur.");
      return;
    }
    if (!slug) {
      setMessage("Geçerli bir slug girin.");
      return;
    }
    if (!newBusinessForm.whatsappOrderNumber.trim()) {
      setMessage("WhatsApp sipariş numarası zorunludur.");
      return;
    }
    if (
      !newBusinessForm.city.trim() ||
      !newBusinessForm.district.trim() ||
      !newBusinessForm.neighborhood.trim()
    ) {
      setMessage("Lütfen geçerli il, ilçe ve Mahalle / Köy seçin.");
      return;
    }
    if (!newBusinessForm.ownerEmail.trim()) {
      setMessage("İşletme sahibi e-posta alanı zorunludur.");
      return;
    }
    if (!newBusinessForm.temporaryPassword || newBusinessForm.temporaryPassword.length < 6) {
      setMessage("Geçici şifre en az 6 karakter olmalıdır.");
      return;
    }
    if (businesses.some((business) => business.slug === slug)) {
      setMessage("Bu slug ile kayıtlı bir işletme zaten var.");
      return;
    }
    setIsCreatingBusiness(true);

    try {
      await createBusinessWithAccount(
        {
          slug,
          name: newBusinessForm.name.trim(),
          description: newBusinessForm.description.trim(),
          whatsappOrderNumber: newBusinessForm.whatsappOrderNumber.trim(),
          city: newBusinessForm.city.trim(),
          district: newBusinessForm.district.trim(),
          neighborhood: newBusinessForm.neighborhood.trim(),
          address: newBusinessForm.address.trim(),
          ownerEmail: newBusinessForm.ownerEmail.trim(),
          temporaryPassword: newBusinessForm.temporaryPassword,
          subscriptionStatus: newBusinessForm.subscriptionStatus,
          subscriptionStartedAt: newBusinessForm.subscriptionStartedAt
            ? startOfSelectedDate(newBusinessForm.subscriptionStartedAt)
            : null,
          subscriptionExpiresAt: newBusinessForm.subscriptionExpiresAt
            ? endOfSelectedDate(newBusinessForm.subscriptionExpiresAt)
            : null,
          isActive: newBusinessForm.isActive,
        },
      );
      await refreshAdminData();
      setCreatedBusinessCredentials({
        email: newBusinessForm.ownerEmail.trim(),
        temporaryPassword: newBusinessForm.temporaryPassword,
      });
      setNewBusinessForm(emptyNewBusinessForm);
      setIsNewBusinessSlugTouched(false);
      setMessage("İşletme ve giriş hesabı oluşturuldu.");
    } catch {
      setMessage("Yeni işletme eklenemedi.");
      setErrorDetail("İşletme kaydedilemedi. Lütfen bilgileri kontrol edip tekrar deneyin.");
    } finally {
      setIsCreatingBusiness(false);
    }
  }

  async function submitAdminLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdminError("");
    setIsAdminSigningIn(true);

    if (!adminEmail.trim() || !adminPassword) {
      setAdminError("E-posta ve şifre alanlarını doldurun.");
      setIsAdminSigningIn(false);
      return;
    }

    try {
      const authenticated = await loginAdmin(adminEmail.trim(), adminPassword);
      if (!authenticated) throw new Error("Admin girişi reddedildi.");
      setIsAdminAuthorized(true);
      setAdminPassword("");
      setAdminError("");
    } catch {
      setIsAdminAuthorized(false);
      setAdminError("Admin girişi başarısız. E-posta veya şifreyi kontrol edin.");
    } finally {
      setIsAdminSigningIn(false);
    }
  }

  async function logoutAdmin() {
    await requestAdminLogout();
    setIsAdminAuthorized(false);
    setAdminPassword("");
    setAdminError("");
    setMessage("");
    setErrorDetail("");
    setBusinessLoadError(false);
    setOverviewLoadError(false);
    setBusinesses([]);
    setAdminKpis(emptyAdminKpis);
    setPagination(emptyPagination);
    setIsInitialListLoading(true);
    setIsInitialOverviewLoading(true);
  }

  if (isCheckingAdmin) {
    return <AdminLoading />;
  }

  if (!isAdminAuthorized) {
    return (
      <AdminLogin
        email={adminEmail}
        error={adminError}
        isSubmitting={isAdminSigningIn}
        password={adminPassword}
        onEmailChange={setAdminEmail}
        onPasswordChange={setAdminPassword}
        onSubmit={submitAdminLogin}
      />
    );
  }

  if (isInitialListLoading || isInitialOverviewLoading) {
    return <AdminLoading />;
  }

  return (
    <AdminShell
      activeSection={activeAdminSection}
      isRefreshing={isRefreshingBusinesses}
      onCreateBusiness={() => switchAdminSection("create")}
      onLogout={logoutAdmin}
      onNavigate={switchAdminSection}
      onRefresh={refreshAdminList}
    >
        {message || errorDetail || businessLoadError || overviewLoadError ? (
          <div className={adminStyles.feedbackStack}>
            {message ? (
              <p className={adminStyles.statusMessage} aria-live="polite">
                {message}
              </p>
            ) : null}
            {errorDetail ? (
              <p className={adminStyles.errorMessage} role="alert">
                {errorDetail}
              </p>
            ) : null}
            {businessLoadError || overviewLoadError ? (
              <div className={adminStyles.loadErrorCard} role="alert">
                <div>
                  <strong>
                    {businessLoadError && overviewLoadError
                      ? "Yönetim verileri yüklenemedi."
                      : businessLoadError
                        ? "İşletmeler yüklenemedi."
                        : "Yönetim özeti yüklenemedi."}
                  </strong>
                  <p>Güncel verileri almak için yeniden deneyin.</p>
                </div>
                <button
                  disabled={isRefreshingBusinesses}
                  type="button"
                  onClick={refreshAdminList}
                >
                  Yeniden Dene
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {activeAdminSection === "overview" ? (
          <AdminOverview
            attentionBusinesses={attentionBusinesses}
            kpis={adminKpis}
            onCreateBusiness={() => switchAdminSection("create")}
            onManageBusinesses={() => switchAdminSection("businesses")}
            onOpenBusiness={openBusinessDetail}
          />
        ) : null}

        {activeAdminSection === "businesses" ? (
        <section className="section admin-filter-card" id="isletmeler">
          <div className="section-title">
            <h2>İşletme Ara ve Filtrele</h2>
            <span>
              {pagination.total === 0
                ? "0 işletme bulundu"
                : `${pagination.total} işletmeden ${visibleFrom}–${visibleTo} arası gösteriliyor`}
            </span>
          </div>
          <div className="customer-form admin-filter-form">
            <div className="field admin-filter-search">
              <label htmlFor="adminBusinessSearch">
                İşletme adı, slug, e-posta, WhatsApp, şehir, ilçe, mahalle veya adres ara
              </label>
              <input
                id="adminBusinessSearch"
                placeholder="Örn: kebap, test-isletmesi, 905..."
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="adminStatusFilter">Aktif / pasif</label>
              <select
                id="adminStatusFilter"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as AdminBusinessAccessFilter);
                  setPage(1);
                }}
              >
                <option value="all">Tümü</option>
                <option value="active">Aktif</option>
                <option value="passive">Pasif</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="adminSubscriptionFilter">Abonelik durumu</label>
              <select
                id="adminSubscriptionFilter"
                value={subscriptionFilter}
                onChange={(event) => {
                  setSubscriptionFilter(
                    event.target.value as AdminBusinessSubscriptionFilter,
                  );
                  setPage(1);
                }}
              >
                <option value="all">Tümü</option>
                <option value="active">Aktif abonelik</option>
                <option value="expired">Süresi dolmuş</option>
                <option value="passive">Pasif</option>
                <option value="blocked">Engelli</option>
                <option value="ending7">Son 7 gün içinde bitecekler</option>
                <option value="ending30">Son 30 gün içinde bitecekler</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="adminCityFilter">Şehir</label>
              <select
                id="adminCityFilter"
                value={cityFilter}
                onChange={(event) => {
                  setCityFilter(event.target.value);
                  setDistrictFilter("");
                  setPage(1);
                }}
              >
                <option value="">Tüm şehirler</option>
                {cityOptions.map((city) => (
                  <option key={city.id} value={city.name}>
                    {city.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="adminDistrictFilter">İlçe</label>
              <select
                disabled={!selectedFilterProvince}
                id="adminDistrictFilter"
                value={districtFilter}
                onChange={(event) => {
                  setDistrictFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">
                  {selectedFilterProvince ? "Tüm ilçeler" : "Önce şehir seçin"}
                </option>
                {districtOptions.map((district) => (
                  <option key={district.id} value={district.name}>
                    {district.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="adminCreatedFilter">Oluşturulma</label>
              <select
                id="adminCreatedFilter"
                value={createdFilter}
                onChange={(event) => {
                  setCreatedFilter(event.target.value as AdminBusinessCreatedFilter);
                  setPage(1);
                }}
              >
                <option value="all">Tüm tarihler</option>
                <option value="last7">Son 7 günde eklenenler</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="adminBusinessSort">Sıralama</label>
              <select
                id="adminBusinessSort"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as AdminBusinessSort);
                  setPage(1);
                }}
              >
                <option value="newest">En yeni</option>
                <option value="name_asc">İşletme adı (A–Z)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="adminBusinessPageSize">Sayfa başına</label>
              <select
                id="adminBusinessPageSize"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
            <div className="admin-filter-footer">
              <p>
                {pagination.total === 0
                  ? "0 işletme bulundu."
                  : `${pagination.total} işletmeden ${visibleFrom}–${visibleTo} arası gösteriliyor.`}
                {isRefreshingBusinesses ? " Liste yenileniyor…" : ""}
              </p>
              <button
                disabled={!hasActiveFilters}
                type="button"
                onClick={clearAdminFilters}
              >
                Filtreleri Temizle
              </button>
            </div>
            <div className="admin-active-filters">
              {activeFilterLabels.length > 0 ? (
                <>
                  <strong>Aktif filtreler</strong>
                  <div>
                    {activeFilterLabels.map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                </>
              ) : (
                <p>Aktif filtre yok. Tüm işletmeler gösteriliyor.</p>
              )}
            </div>
            {filteredBusinesses.length === 0 ? (
              <div className="admin-filter-empty">
                <strong>Sonuç bulunamadı</strong>
                <p>Arama veya filtreleri temizleyip tekrar deneyin.</p>
                <button type="button" onClick={clearAdminFilters}>
                  Filtreleri Temizle
                </button>
              </div>
            ) : null}
          </div>
        </section>
        ) : null}

        {activeAdminSection === "create" ? (
        <section className="section admin-create-business" id="yeni-isletme">
          <div className="section-title">
            <h2>Yeni İşletme Ekle</h2>
            <span>İşletme kaydı</span>
          </div>
          <form className="customer-form admin-create-form" onSubmit={submitNewBusiness}>
            <div className="field">
              <label htmlFor="newBusinessName">İşletme adı</label>
              <input
                id="newBusinessName"
                value={newBusinessForm.name}
                onChange={(event) => updateNewBusinessForm("name", event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="newBusinessSlug">Slug</label>
              <input
                id="newBusinessSlug"
                value={newBusinessForm.slug}
                onChange={(event) => updateNewBusinessForm("slug", event.target.value)}
              />
            </div>
            <LocationSelector
              idPrefix="newBusinessLocation"
              required
              value={{
                city: newBusinessForm.city,
                district: newBusinessForm.district,
                neighborhood: newBusinessForm.neighborhood,
              }}
              onChange={(location) =>
                setNewBusinessForm((current) => ({
                  ...current,
                  city: location.city,
                  district: location.district,
                  neighborhood: location.neighborhood,
                }))
              }
            />
            <div className="field">
              <label htmlFor="newBusinessAddress">Adres</label>
              <textarea
                id="newBusinessAddress"
                value={newBusinessForm.address}
                onChange={(event) => updateNewBusinessForm("address", event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="newBusinessWhatsapp">WhatsApp sipariş numarası</label>
              <input
                id="newBusinessWhatsapp"
                inputMode="tel"
                value={newBusinessForm.whatsappOrderNumber}
                onChange={(event) =>
                  updateNewBusinessForm("whatsappOrderNumber", event.target.value)
                }
              />
            </div>
            <div className="field">
              <label htmlFor="newBusinessDescription">Açıklama</label>
              <textarea
                id="newBusinessDescription"
                value={newBusinessForm.description}
                onChange={(event) =>
                  updateNewBusinessForm("description", event.target.value)
                }
              />
            </div>
            <div className="field">
              <label htmlFor="newBusinessOwnerEmail">İşletme sahibi e-posta</label>
              <input
                autoComplete="email"
                id="newBusinessOwnerEmail"
                inputMode="email"
                type="email"
                value={newBusinessForm.ownerEmail}
                onChange={(event) =>
                  updateNewBusinessForm("ownerEmail", event.target.value)
                }
              />
              <span className="field-help">
                Bu e-posta ile işletme sahibi /giris sayfasından giriş yapar.
              </span>
            </div>
            <div className="field">
              <label htmlFor="newBusinessPassword">Geçici şifre</label>
              <input
                autoComplete="new-password"
                id="newBusinessPassword"
                type="password"
                value={newBusinessForm.temporaryPassword}
                onChange={(event) =>
                  updateNewBusinessForm("temporaryPassword", event.target.value)
                }
              />
              <span className="field-help">
                Şifre hiçbir tabloya kaydedilmez. İşletmeye güvenli şekilde iletin.
              </span>
            </div>
            <div className="field">
              <label htmlFor="newBusinessStatus">Abonelik durumu</label>
              <select
                id="newBusinessStatus"
                value={newBusinessForm.subscriptionStatus}
                onChange={(event) =>
                  updateNewBusinessForm(
                    "subscriptionStatus",
                    event.target.value as NewBusinessForm["subscriptionStatus"],
                  )
                }
              >
                <option value="expired">Süresi Dolmuş</option>
                <option value="active">Aktif</option>
                <option value="blocked">Engelli</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="newBusinessStartedAt">Abonelik başlangıç tarihi</label>
              <input
                id="newBusinessStartedAt"
                type="date"
                value={newBusinessForm.subscriptionStartedAt}
                onChange={(event) =>
                  updateNewBusinessForm("subscriptionStartedAt", event.target.value)
                }
              />
            </div>
            <div className="field">
              <label htmlFor="newBusinessExpiresAt">Abonelik bitiş tarihi</label>
              <input
                id="newBusinessExpiresAt"
                type="date"
                value={newBusinessForm.subscriptionExpiresAt}
                onChange={(event) =>
                  updateNewBusinessForm("subscriptionExpiresAt", event.target.value)
                }
              />
            </div>
            <label className="field admin-checkbox-field">
              <span>Aktif/pasif</span>
              <input
                checked={newBusinessForm.isActive}
                type="checkbox"
                onChange={(event) =>
                  updateNewBusinessForm("isActive", event.target.checked)
                }
              />
            </label>
            <button
              className="submit-button admin-primary-action"
              disabled={isCreatingBusiness}
              type="submit"
            >
              {isCreatingBusiness ? "İşletme ekleniyor..." : "Yeni İşletme Ekle"}
            </button>
          </form>
          {createdBusinessCredentials ? (
            <div className="admin-created-credentials">
              <strong>İşletmeye verilecek giriş bilgileri</strong>
              <p>
                <span>E-posta</span>
                <code>{createdBusinessCredentials.email}</code>
              </p>
              <p>
                <span>Geçici şifre</span>
                <code>{createdBusinessCredentials.temporaryPassword}</code>
              </p>
              <p>
                <span>Giriş adresi</span>
                <code>/giris</code>
              </p>
            </div>
          ) : null}
        </section>
        ) : null}

        {activeAdminSection === "businesses" ? (
        <section className="admin-list">
          {filteredBusinesses.length === 0 ? (
            <div className="section admin-empty-state">
              <h2>
                {isGlobalBusinessListEmpty
                  ? "Henüz işletme bulunmuyor."
                  : "Sonuç bulunamadı"}
              </h2>
              <p>
                {isGlobalBusinessListEmpty
                  ? "İlk işletmenizi oluşturarak yönetim alanını kullanmaya başlayın."
                  : "Arama veya filtreleri değiştirerek tekrar deneyin."}
              </p>
              <button
                type="button"
                onClick={() =>
                  isGlobalBusinessListEmpty
                    ? switchAdminSection("create")
                    : clearAdminFilters()
                }
              >
                {isGlobalBusinessListEmpty ? "Yeni İşletme Ekle" : "Filtreleri temizle"}
              </button>
            </div>
          ) : null}
          {listedBusinesses.map((business) => {
            const badge = getBadge(business);

            return (
              <article
                className="admin-card admin-business-card admin-compact-card"
                key={business.slug}
              >
                {business.id ? (
                <Link
                  className="admin-compact-row"
                  href={`/admin/isletmeler/${business.id}`}
                >
                  <span className="admin-compact-main">
                    <strong>{business.name}</strong>
                  </span>
                  <span className="admin-compact-meta">
                    <span className={`status admin-status ${badge.toLowerCase().replaceAll(" ", "-")}`}>
                      {badge}
                    </span>
                    <span>{getAdminSubscriptionStatusLabel(business)}</span>
                    <span>{formatDate(business.subscriptionExpiresAt)}</span>
                    <span>{business.isActive ? "Aktif" : "Pasif"}</span>
                  </span>
                  <span className="admin-compact-toggle">
                    Detay
                  </span>
                </Link>
                ) : null}

              </article>
            );
          })}
          {pagination.totalPages > 0 ? (
            <nav className="admin-pagination" aria-label="İşletme listesi sayfaları">
              <button
                disabled={pagination.page <= 1 || isRefreshingBusinesses}
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Önceki
              </button>
              <div>
                <strong>
                  Sayfa {pagination.page} / {pagination.totalPages}
                </strong>
                <span>
                  {pagination.total} işletmeden {visibleFrom}–{visibleTo} arası gösteriliyor
                </span>
              </div>
              <button
                disabled={
                  pagination.page >= pagination.totalPages || isRefreshingBusinesses
                }
                type="button"
                onClick={() =>
                  setPage((current) => Math.min(pagination.totalPages, current + 1))
                }
              >
                Sonraki
              </button>
            </nav>
          ) : null}
        </section>
        ) : null}
    </AdminShell>
  );
}
