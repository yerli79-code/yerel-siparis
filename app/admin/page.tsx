"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import LocationSelector from "../../components/LocationSelector";
import type { Business } from "../../lib/businesses";
import {
  createBusinessWithAccount,
  deleteBusinessInSupabase,
  fetchAdminBusinessPage,
  fetchAdminOverview,
  updateBusinessInSupabase,
  updateBusinessSubscriptionInSupabase,
} from "../../lib/supabase-admin";
import {
  addDaysFromToday,
  canReactivateBusinessAccess,
  formatDate,
  getAdminSubscriptionStatusLabel,
  getBadge,
  getRemainingDays,
  isEndingWithinDays,
  isSubscriptionExpired,
  type AdminKpis,
  withBusinessAccess,
  withReactivatedBusinessAccess,
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

const extensionDays = [30, 60, 90, 180, 365];
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

type EditBusinessForm = Omit<
  NewBusinessForm,
  "ownerEmail" | "temporaryPassword"
> & {
  id: string;
  originalSlug: string;
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

const emptyEditBusinessForm: EditBusinessForm = {
  id: "",
  originalSlug: "",
  name: "",
  slug: "",
  city: "",
  district: "",
  neighborhood: "",
  address: "",
  whatsappOrderNumber: "",
  description: "",
  subscriptionStatus: "expired",
  subscriptionStartedAt: "",
  subscriptionExpiresAt: "",
  isActive: false,
};

type CreatedBusinessCredentials = {
  email: string;
  temporaryPassword: string;
};

type AdminConfirmAction = {
  businessName: string;
  actionName: string;
  description: string;
  isCritical?: boolean;
  onConfirm: () => void | Promise<void>;
};

function dateInputValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}
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
  const [savingSlug, setSavingSlug] = useState("");
  const [manualDates, setManualDates] = useState<Record<string, string>>({});
  const [newBusinessForm, setNewBusinessForm] = useState<NewBusinessForm>(
    emptyNewBusinessForm,
  );
  const [isNewBusinessSlugTouched, setIsNewBusinessSlugTouched] =
    useState(false);
  const [isCreatingBusiness, setIsCreatingBusiness] = useState(false);
  const [createdBusinessCredentials, setCreatedBusinessCredentials] =
    useState<CreatedBusinessCredentials | null>(null);
  const [editingBusiness, setEditingBusiness] =
    useState<EditBusinessForm | null>(null);
  const [isUpdatingBusiness, setIsUpdatingBusiness] = useState(false);
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
  const [expandedBusinessId, setExpandedBusinessId] = useState("");
  const [confirmAction, setConfirmAction] = useState<AdminConfirmAction | null>(
    null,
  );
  const [isConfirmingAction, setIsConfirmingAction] = useState(false);
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
      setManualDates(
        Object.fromEntries(
          nextBusinesses.map((business) => [
            business.slug,
            dateInputValue(business.subscriptionExpiresAt),
          ]),
        ),
      );
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

  function startEditingBusiness(business: Business) {
    setMessage("");
    setErrorDetail("");
    setCreatedBusinessCredentials(null);

    if (!business.id) {
      setMessage("Bu işletmenin kayıt kimliği bulunamadı. Listeyi yenileyin.");
      return;
    }

    setExpandedBusinessId(business.id || business.slug);
    setEditingBusiness({
      id: business.id,
      originalSlug: business.slug,
      name: business.name,
      slug: business.slug,
      city: business.city ?? "",
      district: business.district,
      neighborhood: business.neighborhood,
      address: business.address,
      whatsappOrderNumber: business.whatsappOrderNumber,
      description: business.description,
      subscriptionStatus: business.subscriptionStatus,
      subscriptionStartedAt: dateInputValue(business.subscriptionStartedAt),
      subscriptionExpiresAt: dateInputValue(business.subscriptionExpiresAt),
      isActive: business.isActive,
    });
  }

  function updateEditBusinessForm(
    field: keyof EditBusinessForm,
    value: string | boolean,
  ) {
    setMessage("");
    setErrorDetail("");
    setEditingBusiness((current) => {
      if (!current) return current;

      if (field === "name" && typeof value === "string" && !current.slug.trim()) {
        return { ...current, name: value, slug: slugify(value) };
      }

      if (field === "slug" && typeof value === "string") {
        return { ...current, slug: slugify(value) };
      }

      return { ...current, [field]: value };
    });
  }

  function cancelEditingBusiness() {
    setEditingBusiness(null);
    setMessage("");
    setErrorDetail("");
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
    setExpandedBusinessId("");
    setMessage("");
    setErrorDetail("");
  }

  function openBusinessDetail(business: Business) {
    clearAdminFilters();
    setActiveAdminSection("businesses");
    setExpandedBusinessId(business.id || business.slug);
    setMessage("");
    setErrorDetail("");
  }

  function requestAdminActionConfirmation(action: AdminConfirmAction) {
    setMessage("");
    setErrorDetail("");
    setConfirmAction(action);
  }

  async function confirmPendingAdminAction() {
    if (!confirmAction || isConfirmingAction) return;

    setIsConfirmingAction(true);
    try {
      await confirmAction.onConfirm();
      setConfirmAction(null);
    } finally {
      setIsConfirmingAction(false);
    }
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

  async function submitEditBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setErrorDetail("");

    if (!editingBusiness) return;

    const slug = slugify(editingBusiness.slug || editingBusiness.name);
    if (!editingBusiness.name.trim()) {
      setMessage("İşletme adı zorunludur.");
      return;
    }
    if (!slug) {
      setMessage("Geçerli bir slug girin.");
      return;
    }
    if (!editingBusiness.whatsappOrderNumber.trim()) {
      setMessage("WhatsApp sipariş numarası zorunludur.");
      return;
    }
    if (
      businesses.some(
        (business) =>
          business.slug === slug && business.slug !== editingBusiness.originalSlug,
      )
    ) {
      setMessage("Bu slug ile kayıtlı başka bir işletme var.");
      return;
    }

    setIsUpdatingBusiness(true);
    setSavingSlug(editingBusiness.originalSlug);

    try {
      await updateBusinessInSupabase(
        {
          id: editingBusiness.id,
          slug,
          name: editingBusiness.name.trim(),
          description: editingBusiness.description.trim(),
          whatsappOrderNumber: editingBusiness.whatsappOrderNumber.trim(),
          city: editingBusiness.city.trim(),
          district: editingBusiness.district.trim(),
          neighborhood: editingBusiness.neighborhood.trim(),
          address: editingBusiness.address.trim(),
          subscriptionStatus: editingBusiness.subscriptionStatus,
          subscriptionStartedAt: editingBusiness.subscriptionStartedAt
            ? startOfSelectedDate(editingBusiness.subscriptionStartedAt)
            : null,
          subscriptionExpiresAt: editingBusiness.subscriptionExpiresAt
            ? endOfSelectedDate(editingBusiness.subscriptionExpiresAt)
            : null,
          isActive: editingBusiness.isActive,
        },
      );
      await refreshAdminData();
      setEditingBusiness(null);
      setMessage("İşletme bilgileri güncellendi.");
    } catch {
      setMessage("İşletme güncellenemedi.");
      setErrorDetail("İşletme kaydedilemedi. Lütfen bilgileri kontrol edip tekrar deneyin.");
    } finally {
      setIsUpdatingBusiness(false);
      setSavingSlug("");
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

  async function commit(nextBusiness: Business, successMessage: string) {
    setSavingSlug(nextBusiness.slug);
    setErrorDetail("");
    setMessage("Abonelik güncelleniyor...");

    try {
      const payload = {
        subscription_status: nextBusiness.subscriptionStatus,
        subscription_started_at: nextBusiness.subscriptionStartedAt ?? null,
        subscription_expires_at: nextBusiness.subscriptionExpiresAt,
        is_active: nextBusiness.isActive,
      } as const;
      await updateBusinessSubscriptionInSupabase(
        nextBusiness,
        payload,
      );
      await refreshAdminData();
      setMessage(successMessage);
    } catch {
      setMessage("Abonelik güncelleme başarısız.");
      setErrorDetail("Abonelik işlemi tamamlanamadı. Lütfen tekrar deneyin.");
    } finally {
      setSavingSlug("");
    }
  }

  function extendSubscription(business: Business, days: number) {
    const now = new Date().toISOString();
    commit(
      {
        ...business,
        subscriptionStatus: "active",
        subscriptionStartedAt: now,
        subscriptionExpiresAt: addDaysFromToday(days),
        isActive: true,
      },
      `${business.name} aboneliği bugünden itibaren ${days} gün olarak ayarlandı.`,
    );
  }

  function saveManualDate(business: Business) {
    const selectedDate = manualDates[business.slug];
    if (!selectedDate) {
      setMessage("Lütfen abonelik bitiş tarihi seçin.");
      return;
    }

    commit(
      {
        ...business,
        subscriptionStatus: "active",
        subscriptionStartedAt: new Date().toISOString(),
        subscriptionExpiresAt: endOfSelectedDate(selectedDate),
        isActive: true,
      },
      `${business.name} abonelik bitiş tarihi güncellendi.`,
    );
  }

  function resetSubscription(business: Business) {
    commit(
      {
        ...business,
        subscriptionStatus: "expired",
        subscriptionStartedAt: null,
        subscriptionExpiresAt: null,
        isActive: false,
      },
      `${business.name} aboneliği sıfırlandı.`,
    );
  }

  function setPassive(business: Business) {
    commit(
      withBusinessAccess(business, false),
      `${business.name} pasife alındı.`,
    );
  }

  function setActive(business: Business) {
    const nextBusiness = withReactivatedBusinessAccess(business);
    if (!nextBusiness) {
      setMessage("İşletmeyi aktifleştirmeden önce geçerli bir abonelik tanımlayın.");
      return;
    }

    commit(
      nextBusiness,
      `${business.name} aktif edildi.`,
    );
  }

  function blockBusiness(business: Business) {
    commit(
      { ...business, subscriptionStatus: "blocked", isActive: false },
      `${business.name} engellendi.`,
    );
  }

  async function deleteBusiness(business: Business) {
    if (!business.id) {
      setSavingSlug(business.slug);
      setMessage("İşletme kayıt kimliği bulunamadı. Liste yenileniyor...");
      setErrorDetail("");
      await refreshAdminData();
      setSavingSlug("");
      return;
    }

    setSavingSlug(business.slug);
    setMessage("");
    setErrorDetail("");

    try {
      const result = await deleteBusinessInSupabase(business.id);
      const targetPage = businesses.length === 1 && page > 1 ? page - 1 : page;
      if (targetPage !== page) setPage(targetPage);
      await refreshAdminData(targetPage);
      setMessage(
        result.notFound
          ? "İşletme zaten silinmiş veya bulunamadı. Liste yenilendi."
          : `${business.name} silindi.`,
      );
    } catch {
      setMessage("İşletme silinemedi.");
      setErrorDetail("İşletme silinemedi. Lütfen tekrar deneyin.");
    } finally {
      setSavingSlug("");
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
        {confirmAction ? (
          <div className="admin-confirm-backdrop" role="presentation">
            <div
              aria-labelledby="admin-confirm-title"
              aria-modal="true"
              className={`admin-confirm-dialog ${
                confirmAction.isCritical ? "critical" : ""
              }`}
              role="dialog"
            >
              <span className="eyebrow">
                {confirmAction.isCritical ? "Kritik işlem" : "İşlem onayı"}
              </span>
              <h2 id="admin-confirm-title">{confirmAction.actionName}</h2>
              <p>
                <strong>{confirmAction.businessName}</strong> işletmesi için bu
                işlem uygulanacak.
              </p>
              <p>{confirmAction.description}</p>
              <div className="admin-confirm-actions">
                <button
                  disabled={isConfirmingAction || Boolean(savingSlug)}
                  type="button"
                  onClick={confirmPendingAdminAction}
                >
                  {isConfirmingAction || savingSlug ? "İşlem sürüyor..." : "Onayla"}
                </button>
                <button
                  disabled={isConfirmingAction || Boolean(savingSlug)}
                  type="button"
                  onClick={() => setConfirmAction(null)}
                >
                  Vazgeç
                </button>
              </div>
            </div>
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
            const remainingDays = getRemainingDays(
              business.subscriptionExpiresAt,
            );
            const isSaving = savingSlug === business.slug;
            const badge = getBadge(business);
            const businessRowId = business.id || business.slug;
            const isExpanded = expandedBusinessId === businessRowId;
            const canReactivate = canReactivateBusinessAccess(business);

            return (
              <article
                className={`admin-card admin-business-card admin-compact-card ${
                  isExpanded ? "expanded" : ""
                }`}
                key={business.slug}
              >
                <button
                  aria-expanded={isExpanded}
                  className="admin-compact-row"
                  type="button"
                  onClick={() =>
                    setExpandedBusinessId((current) =>
                      current === businessRowId ? "" : businessRowId,
                    )
                  }
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
                    {isExpanded ? "Kapat" : "Detay"}
                  </span>
                </button>

                {isExpanded ? (
                  <div className="admin-compact-detail">
                    <div className="admin-detail-groups">
                      <section className="admin-control-group">
                        <h3>Genel Bilgiler</h3>
                        <div className="info-grid admin-info-grid">
                          <p><strong>Slug</strong><span>/{business.slug}</span></p>
                          <p><strong>E-posta</strong><span>{business.email}</span></p>
                          <p><strong>WhatsApp</strong><span>{business.whatsappOrderNumber}</span></p>
                          <p><strong>Şehir</strong><span>{business.city || "-"}</span></p>
                          <p><strong>İlçe</strong><span>{business.district || "-"}</span></p>
                          <p><strong>Mahalle</strong><span>{business.neighborhood || "-"}</span></p>
                          <p><strong>Adres</strong><span>{business.address || "-"}</span></p>
                          <p><strong>Kayıt tarihi</strong><span>{formatDate(business.createdAt)}</span></p>
                        </div>
                      </section>

                      <section className="admin-control-group">
                        <h3>Abonelik</h3>
                        <p className="admin-control-help">
                          Süre uzatma ve manuel abonelik tarihi işlemleri.
                        </p>
                        <div className="info-grid admin-info-grid">
                          <p><strong>Başlangıç</strong><span>{formatDate(business.subscriptionStartedAt)}</span></p>
                          <p><strong>Abonelik bitiş</strong><span>{formatDate(business.subscriptionExpiresAt)}</span></p>
                          <p><strong>Kalan gün</strong><span>{Math.max(0, remainingDays)}</span></p>
                          <p><strong>Durum</strong><span>{`${getAdminSubscriptionStatusLabel(business)} / ${business.isActive ? "aktif" : "pasif"}`}</span></p>
                        </div>
                        <div className="admin-extension-actions">
                          {extensionDays.map((days) => (
                            <button
                              disabled={isSaving}
                              key={days}
                              type="button"
                              onClick={() =>
                                requestAdminActionConfirmation({
                                  businessName: business.name,
                                  actionName: `+${days} gün abonelik`,
                                  description: `Abonelik bugünden itibaren ${days} gün aktif olacak ve işletme sipariş almaya açık kalacak.`,
                                  onConfirm: () => extendSubscription(business, days),
                                })
                              }
                            >
                              +{days} Gün
                            </button>
                          ))}
                        </div>
                        <div className="manual-subscription">
                          <label htmlFor={`manual-${business.slug}`}>Aboneliği Düzelt</label>
                          <div>
                            <input
                              id={`manual-${business.slug}`}
                              type="date"
                              value={manualDates[business.slug] ?? ""}
                              onChange={(event) =>
                                setManualDates((current) => ({
                                  ...current,
                                  [business.slug]: event.target.value,
                                }))
                              }
                            />
                            <button
                              disabled={isSaving}
                              type="button"
                              onClick={() => {
                                if (!manualDates[business.slug]) {
                                  saveManualDate(business);
                                  return;
                                }
                                requestAdminActionConfirmation({
                                  businessName: business.name,
                                  actionName: "Aboneliği düzelt",
                                  description:
                                    "Seçilen tarih abonelik bitiş tarihi olarak kaydedilecek ve işletme aktif duruma alınacak.",
                                  onConfirm: () => saveManualDate(business),
                                });
                              }}
                            >
                              Kaydet
                            </button>
                          </div>
                        </div>
                      </section>

                      <section className="admin-control-group">
                        <h3>İşletme Ayarları</h3>
                        <p className="admin-control-help">
                          İşletme bilgilerini gerektiğinde düzenleyin.
                        </p>
                        {editingBusiness?.originalSlug === business.slug ? (
                          <form
                            className="customer-form admin-create-form admin-edit-form"
                            onSubmit={submitEditBusiness}
                          >
                            <div className="section-title admin-inline-title">
                              <h3>İşletme Bilgilerini Düzenle</h3>
                              <span>İşletme kaydı</span>
                            </div>
                            <div className="field">
                              <label htmlFor={`edit-name-${business.slug}`}>İşletme adı</label>
                              <input
                                id={`edit-name-${business.slug}`}
                                value={editingBusiness.name}
                                onChange={(event) =>
                                  updateEditBusinessForm("name", event.target.value)
                                }
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`edit-slug-${business.slug}`}>Slug</label>
                              <input
                                id={`edit-slug-${business.slug}`}
                                value={editingBusiness.slug}
                                onChange={(event) =>
                                  updateEditBusinessForm("slug", event.target.value)
                                }
                              />
                            </div>
                            <LocationSelector
                              idPrefix={`edit-location-${business.slug}`}
                              value={{
                                city: editingBusiness.city,
                                district: editingBusiness.district,
                                neighborhood: editingBusiness.neighborhood,
                              }}
                              onChange={(location) =>
                                setEditingBusiness((current) =>
                                  current
                                    ? {
                                        ...current,
                                        city: location.city,
                                        district: location.district,
                                        neighborhood: location.neighborhood,
                                      }
                                    : current,
                                )
                              }
                            />
                            <div className="field">
                              <label htmlFor={`edit-address-${business.slug}`}>Adres</label>
                              <textarea
                                id={`edit-address-${business.slug}`}
                                value={editingBusiness.address}
                                onChange={(event) =>
                                  updateEditBusinessForm("address", event.target.value)
                                }
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`edit-whatsapp-${business.slug}`}>
                                WhatsApp sipariş numarası
                              </label>
                              <input
                                id={`edit-whatsapp-${business.slug}`}
                                inputMode="tel"
                                value={editingBusiness.whatsappOrderNumber}
                                onChange={(event) =>
                                  updateEditBusinessForm(
                                    "whatsappOrderNumber",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`edit-description-${business.slug}`}>
                                Açıklama
                              </label>
                              <textarea
                                id={`edit-description-${business.slug}`}
                                value={editingBusiness.description}
                                onChange={(event) =>
                                  updateEditBusinessForm("description", event.target.value)
                                }
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`edit-status-${business.slug}`}>
                                Abonelik durumu
                              </label>
                              <select
                                id={`edit-status-${business.slug}`}
                                value={editingBusiness.subscriptionStatus}
                                onChange={(event) =>
                                  updateEditBusinessForm(
                                    "subscriptionStatus",
                                    event.target.value as EditBusinessForm["subscriptionStatus"],
                                  )
                                }
                              >
                                <option value="expired">Süresi Dolmuş</option>
                                <option value="active">Aktif</option>
                                <option value="blocked">Engelli</option>
                              </select>
                            </div>
                            <div className="field">
                              <label htmlFor={`edit-started-${business.slug}`}>
                                Abonelik başlangıç tarihi
                              </label>
                              <input
                                id={`edit-started-${business.slug}`}
                                type="date"
                                value={editingBusiness.subscriptionStartedAt}
                                onChange={(event) =>
                                  updateEditBusinessForm(
                                    "subscriptionStartedAt",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`edit-expires-${business.slug}`}>
                                Abonelik bitiş tarihi
                              </label>
                              <input
                                id={`edit-expires-${business.slug}`}
                                type="date"
                                value={editingBusiness.subscriptionExpiresAt}
                                onChange={(event) =>
                                  updateEditBusinessForm(
                                    "subscriptionExpiresAt",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                            <label className="field admin-checkbox-field">
                              <span>Aktif/pasif</span>
                              <input
                                checked={editingBusiness.isActive}
                                type="checkbox"
                                onChange={(event) =>
                                  updateEditBusinessForm("isActive", event.target.checked)
                                }
                              />
                            </label>
                            <div className="admin-actions admin-business-actions">
                              <button
                                className="submit-button admin-primary-action"
                                disabled={isUpdatingBusiness}
                                type="submit"
                              >
                                {isUpdatingBusiness ? "Kaydediliyor..." : "Kaydet"}
                              </button>
                              <button
                                disabled={isUpdatingBusiness}
                                type="button"
                                onClick={cancelEditingBusiness}
                              >
                                Vazgeç
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="admin-actions admin-business-actions admin-routine-actions">
                            <button disabled={isSaving} type="button" onClick={() => startEditingBusiness(business)}>
                              Düzenle
                            </button>
                          </div>
                        )}
                      </section>

                      <section className="admin-control-group admin-critical-control-group">
                        <h3>Kritik İşlemler</h3>
                        <p className="admin-control-help">
                          Bu işlemler işletmenin erişimini veya kayıtlarını doğrudan etkiler.
                        </p>
                        <div className="admin-actions admin-business-actions">
                          {business.isActive ? (
                            <button
                              disabled={isSaving}
                              type="button"
                              onClick={() =>
                                requestAdminActionConfirmation({
                                  businessName: business.name,
                                  actionName: "Pasife al",
                                  description:
                                    "İşletmenin platform erişimi kapatılacak; abonelik durumu ve tarihleri korunacak.",
                                  isCritical: true,
                                  onConfirm: () => setPassive(business),
                                })
                              }
                            >
                              Pasife Al
                            </button>
                          ) : canReactivate ? (
                            <button
                              disabled={isSaving}
                              type="button"
                              onClick={() =>
                                requestAdminActionConfirmation({
                                  businessName: business.name,
                                  actionName: "Aktife al",
                                  description:
                                    "Geçerli abonelik korunarak işletmenin platform erişimi tekrar açılacak.",
                                  onConfirm: () => setActive(business),
                                })
                              }
                            >
                              Aktife Al
                            </button>
                          ) : null}
                          <button
                            disabled={isSaving}
                            className="danger-button"
                            type="button"
                            onClick={() =>
                              requestAdminActionConfirmation({
                                businessName: business.name,
                                actionName: "Engelle",
                                description:
                                  "İşletme engellenecek ve erişimi kapatılacak.",
                                isCritical: true,
                                onConfirm: () => blockBusiness(business),
                              })
                            }
                          >
                            Engelle
                          </button>
                          <button
                            disabled={isSaving}
                            className="danger-button"
                            type="button"
                            onClick={() =>
                              requestAdminActionConfirmation({
                                businessName: business.name,
                                actionName: "Aboneliği sıfırla",
                                description:
                                  "Abonelik tarihi temizlenecek, durum süresi dolmuş olarak kaydedilecek ve işletme pasife alınacak.",
                                isCritical: true,
                                onConfirm: () => resetSubscription(business),
                              })
                            }
                          >
                            Aboneliği Sıfırla
                          </button>
                          <button
                            disabled={isSaving}
                            className="danger-button"
                            type="button"
                            onClick={() =>
                              requestAdminActionConfirmation({
                                businessName: business.name,
                                actionName: "Kalıcı sil",
                                description:
                                  "Bu işlem işletme ve ürün kayıtlarını geri alınamaz şekilde kaldıracak.",
                                isCritical: true,
                                onConfirm: () => deleteBusiness(business),
                              })
                            }
                          >
                            Kalıcı Sil
                          </button>
                        </div>
                      </section>
                    </div>
                  </div>
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
