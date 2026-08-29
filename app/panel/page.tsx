"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import LocationSelector from "../../components/LocationSelector";
import PlatformBrand from "../../components/PlatformBrand";
import NewOrderAlert from "./NewOrderAlert";
import PanelOrders from "./PanelOrders";
import PanelIcon from "./PanelIcon";
import { useModalFocusTrap } from "./useModalFocusTrap";
import styles from "./panel.module.css";
import {
  createOrderPrintReceiptModel,
  orderStatusLabels,
  type OrderPrintPaperWidth,
} from "./order-print";
import {
  openPrintDocument,
  type PrintDocumentOpenResult,
} from "./print-document";
import {
  completeNewOrderPoll,
  createInitialNewOrderWatcherState,
  createNewOrderPollingController,
  createNewOrderPollSession,
  dismissPendingNewOrder,
  establishNewOrderBaseline,
  ingestNewOrderWatcherPage,
  NEW_ORDER_WATCHER_PAGE_SIZE,
  type NewOrderPollingCheckResult,
} from "./new-order-watcher";
import {
  getProductCategories,
  isStandardProductCategory,
  normalizeProductCategory,
} from "../../lib/product-categories";
import {
  DEFAULT_PAYMENT_METHOD_MODE,
  getPaymentMethodDisplayLabel,
  isPaymentMethodMode,
  PAYMENT_METHOD_MODES,
  type PaymentMethodMode,
} from "../../lib/payment-methods";
import {
  clearBrowserAuthSession,
  getValidAccessToken,
} from "../../lib/browser-auth-session";
import {
  businessDashboardSummaryErrorMessage,
  fetchBusinessDashboardSummary,
  type BusinessDashboardSummary,
} from "../../lib/business-dashboard-summary";
import {
  BusinessProductMutationError,
  BusinessProductsRequestError,
  createProduct,
  deleteProduct,
  fetchProductsByBusinessId,
  getCurrentUserBusiness,
  isBusinessSubscriptionActive,
  reorderProducts,
  setProductActiveStatus,
  updateBusinessProfile,
  updateProduct,
  uploadBusinessImage,
  uploadProductImage,
  type BusinessPanelBusiness,
  type BusinessProduct,
  type BusinessProductMutationErrorCode,
  type BusinessProfileInput,
  type ProductInput,
} from "../../lib/supabase-business";
import {
  BusinessOrderMutationError,
  BusinessOrdersRequestError,
  businessOrdersLoadErrorMessage,
  fetchBusinessOrders,
  fetchBusinessOrdersPage,
  updateBusinessOrderStatus,
  type BusinessOrder,
  type BusinessOrderMutationErrorCode,
  type BusinessOrderPageQuery,
  type BusinessOrderPagination,
  type OrderStatus,
} from "../../lib/supabase-orders";

const sessionKey = "yerel-siparis-business-session";
const renewalIban = "TR41 0006 2000 4320 0006 2872 06";
const renewalRecipient = "Barış Yerlikaya";
const renewalDescription = "sipariş web sitesi üyelik yenileme ücreti";
const renewalSupportWhatsapp = "https://wa.me/905365857147";

const orderStatusOptions = Object.entries(orderStatusLabels) as [
  OrderStatus,
  string,
][];

const initialOrderPagination: BusinessOrderPagination = {
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
  hasPreviousPage: false,
  hasNextPage: false,
};

function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function getOrderMutationErrorMessage(code: BusinessOrderMutationErrorCode) {
  switch (code) {
    case "ORDER_CONFLICT":
      return "Sipariş başka bir oturumda güncellendi. Güncel bilgileri yükleyin.";
    case "ORDER_NOT_FOUND":
      return "Sipariş artık bulunamıyor. Güncel bilgileri yükleyin.";
    case "ORDER_FORBIDDEN":
      return "İşletmeniz şu anda operasyonel olmadığı için sipariş durumu güncellenemiyor.";
    case "ORDER_UNAUTHORIZED":
      return "Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.";
    case "INVALID_ORDER_MUTATION":
      return "Sipariş durumu güncellenemedi. Güncel bilgileri yükleyip tekrar deneyin.";
    case "ORDER_UNAVAILABLE":
      return "Sipariş durumu geçici bir sorun nedeniyle güncellenemedi. Tekrar deneyin veya güncel bilgileri yükleyin.";
  }
}

function getProductMutationErrorMessage(
  code: BusinessProductMutationErrorCode,
) {
  switch (code) {
    case "PRODUCT_CONFLICT":
      return "Ürün başka bir oturumda güncellendi. Güncel bilgileri yükleyin.";
    case "PRODUCT_NOT_FOUND":
      return "Ürün artık bulunamıyor. Ürün listesini yenileyin.";
    case "PRODUCT_FORBIDDEN":
      return "Abonelik veya işletme durumu nedeniyle bu işlem yapılamıyor.";
    case "PRODUCT_UNAUTHORIZED":
      return "Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.";
    case "INVALID_PRODUCT_MUTATION":
      return "Ürün bilgileri geçersiz. Alanları kontrol edin.";
    case "PRODUCT_UNAVAILABLE":
      return "Ürün işleminin sonucu doğrulanamadı. Güncel bilgileri yükleyin.";
  }
}

type ProductForm = {
  name: string;
  price: string;
  description: string;
  category: string;
  imageLabel: string;
  imageUrl: string;
  sortOrder: string;
  isActive: boolean;
};

type ProfileForm = {
  name: string;
  description: string;
  whatsappOrderNumber: string;
  city: string;
  district: string;
  neighborhood: string;
  address: string;
  deliveryStatus: string;
  paymentMethodMode: PaymentMethodMode;
  minimumOrderAmount: string;
  preparationTimeMinutes: string;
  isOpen: boolean;
  orderNote: string;
  serviceRadiusKm: string;
  logoUrl: string;
  coverImageUrl: string;
};

type PanelSection =
  | "overview"
  | "products"
  | "orders"
  | "create"
  | "categories"
  | "profile"
  | "qr"
  | "renewal";

const panelSectionLabels: Record<PanelSection, string> = {
  overview: "Genel Bakış",
  orders: "Siparişler",
  products: "Ürünler",
  create: "Yeni Ürün",
  categories: "Kategoriler",
  profile: "İşletme Bilgileri",
  qr: "QR Kod",
  renewal: "Abonelik",
};

const emptyForm: ProductForm = {
  name: "",
  price: "",
  description: "",
  category: "Genel",
  imageLabel: "",
  imageUrl: "",
  sortOrder: "",
  isActive: true,
};

const emptyProfileForm: ProfileForm = {
  name: "",
  description: "",
  whatsappOrderNumber: "",
  city: "",
  district: "",
  neighborhood: "",
  address: "",
  deliveryStatus: "",
  paymentMethodMode: DEFAULT_PAYMENT_METHOD_MODE,
  minimumOrderAmount: "",
  preparationTimeMinutes: "",
  isOpen: true,
  orderNote: "",
  serviceRadiusKm: "",
  logoUrl: "",
  coverImageUrl: "",
};

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      ".env.local icinde NEXT_PUBLIC_SUPABASE_URL veya NEXT_PUBLIC_SUPABASE_ANON_KEY eksik.",
    );
  }

  return { url, anonKey };
}

function getBusinessAuthConfig() {
  const { url, anonKey } = getSupabaseConfig();
  return { url, anonKey, sessionKey };
}

function formatPrice(price: number) {
  return `${price.toLocaleString("tr-TR")} TL`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function safeQrFileSlug(slug: string) {
  return (
    slug
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "isletme"
  );
}

function getProductCategory(product: BusinessProduct) {
  return product.category?.trim() || "Genel";
}

function sortProducts(products: BusinessProduct[]) {
  return [...products].sort((first, second) => {
    const sortDifference = first.sortOrder - second.sortOrder;
    if (sortDifference !== 0) return sortDifference;

    const firstDate = new Date(first.createdAt).getTime();
    const secondDate = new Date(second.createdAt).getTime();
    if (Number.isFinite(firstDate) && Number.isFinite(secondDate)) {
      const dateDifference = firstDate - secondDate;
      if (dateDifference !== 0) return dateDifference;
    }

    return first.name.localeCompare(second.name, "tr", { sensitivity: "base" });
  });
}

function getNextSortOrder(products: BusinessProduct[]) {
  return (
    products.reduce((maxOrder, product) => {
      const sortOrder = Number(product.sortOrder);
      return Number.isFinite(sortOrder) ? Math.max(maxOrder, sortOrder) : maxOrder;
    }, 0) + 1
  );
}

function toForm(product: BusinessProduct): ProductForm {
  const currentCategory = product.category?.trim() || "";

  return {
    name: product.name,
    price: String(product.price),
    description: product.description ?? "",
    category:
      normalizeProductCategory(currentCategory) ??
      (currentCategory ? "" : "Genel"),
    imageLabel: product.imageLabel ?? "",
    imageUrl: product.imageUrl ?? "",
    sortOrder: String(product.sortOrder),
    isActive: product.isActive,
  };
}

function toProductInput(form: ProductForm, fallbackSortOrder = 0): ProductInput {
  const sortOrder = form.sortOrder.trim()
    ? Number(form.sortOrder)
    : fallbackSortOrder;

  return {
    name: form.name.trim(),
    price: Number(form.price),
    description: form.description.trim(),
    category: form.category.trim() || null,
    imageLabel: form.imageLabel.trim() || null,
    imageUrl: form.imageUrl.trim() || null,
    sortOrder,
    isActive: form.isActive,
  };
}

function toProfileForm(business: BusinessPanelBusiness): ProfileForm {
  return {
    name: business.name,
    description: business.description,
    whatsappOrderNumber: business.whatsappOrderNumber,
    city: business.city ?? "",
    district: business.district,
    neighborhood: business.neighborhood,
    address: business.address,
    deliveryStatus: business.deliveryStatus ?? "",
    paymentMethodMode: business.paymentMethodMode,
    minimumOrderAmount:
      typeof business.minimumOrderAmount === "number"
        ? String(business.minimumOrderAmount)
        : "",
    preparationTimeMinutes:
      typeof business.preparationTimeMinutes === "number"
        ? String(business.preparationTimeMinutes)
        : "",
    isOpen: business.isOpen ?? true,
    orderNote: business.orderNote ?? "",
    serviceRadiusKm:
      typeof business.serviceRadiusKm === "number"
        ? String(business.serviceRadiusKm)
        : "",
    logoUrl: business.logoUrl ?? "",
    coverImageUrl: business.coverImageUrl ?? "",
  };
}

function toProfileInput(form: ProfileForm): BusinessProfileInput {
  const radius = form.serviceRadiusKm.trim()
    ? Number(form.serviceRadiusKm)
    : null;
  const minimumOrderAmount = form.minimumOrderAmount.trim()
    ? Number(form.minimumOrderAmount)
    : null;
  const preparationTimeMinutes = form.preparationTimeMinutes.trim()
    ? Number(form.preparationTimeMinutes)
    : null;

  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    whatsappOrderNumber: form.whatsappOrderNumber.trim() || null,
    city: form.city.trim() || null,
    district: form.district.trim() || null,
    neighborhood: form.neighborhood.trim() || null,
    address: form.address.trim() || null,
    deliveryStatus: form.deliveryStatus.trim() || null,
    paymentMethodMode: form.paymentMethodMode,
    minimumOrderAmount,
    preparationTimeMinutes,
    isOpen: form.isOpen,
    orderNote: form.orderNote.trim() || null,
    serviceRadiusKm: radius,
    logoUrl: form.logoUrl.trim() || null,
    coverImageUrl: form.coverImageUrl.trim() || null,
  };
}

function BusinessIdentityLogo({
  business,
}: {
  business: BusinessPanelBusiness;
}) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);

  if (!business.logoUrl || failedLogoUrl === business.logoUrl) return null;

  return (
    <span className="business-panel-identity-logo">
      <img
        alt={`${business.name} logosu`}
        src={business.logoUrl}
        onError={() => setFailedLogoUrl(business.logoUrl)}
      />
    </span>
  );
}

export default function PanelPage() {
  const router = useRouter();
  const [, setAccessToken] = useState("");
  const [business, setBusiness] = useState<BusinessPanelBusiness | null>(null);
  const [products, setProducts] = useState<BusinessProduct[]>([]);
  const [orders, setOrders] = useState<BusinessOrder[]>([]);
  const [overviewOrders, setOverviewOrders] = useState<BusinessOrder[]>([]);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [profileForm, setProfileForm] = useState<ProfileForm>(emptyProfileForm);
  const [editingProductId, setEditingProductId] = useState("");
  const [originalProductCategory, setOriginalProductCategory] = useState("");
  const [isProductCategoryChanged, setIsProductCategoryChanged] =
    useState(false);
  const [expandedProductId, setExpandedProductId] = useState("");
  const [productOperationError, setProductOperationError] = useState("");
  const [conflictedProductIds, setConflictedProductIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileUploadStatus, setProfileUploadStatus] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("Tüm ürünler");
  const [productSearch, setProductSearch] = useState("");
  const [selectedOrderStatusFilter, setSelectedOrderStatusFilter] =
    useState<OrderStatus | "all">("all");
  const [orderSearchDraft, setOrderSearchDraft] = useState("");
  const [orderDateFromDraft, setOrderDateFromDraft] = useState("");
  const [orderDateToDraft, setOrderDateToDraft] = useState("");
  const [appliedOrderSearch, setAppliedOrderSearch] = useState("");
  const [appliedOrderDateFrom, setAppliedOrderDateFrom] = useState("");
  const [appliedOrderDateTo, setAppliedOrderDateTo] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(20);
  const [orderPagination, setOrderPagination] =
    useState<BusinessOrderPagination>(initialOrderPagination);
  const [expandedOrderId, setExpandedOrderId] = useState("");
  const [orderPrintPaperWidth, setOrderPrintPaperWidth] =
    useState<OrderPrintPaperWidth>("80mm");
  const [pendingNewOrders, setPendingNewOrders] = useState<BusinessOrder[]>([]);
  const [watcherFailureCount, setWatcherFailureCount] = useState(0);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [isLoadingOverviewOrders, setIsLoadingOverviewOrders] = useState(false);
  const [overviewOrdersError, setOverviewOrdersError] = useState("");
  const [dashboardSummary, setDashboardSummary] =
    useState<BusinessDashboardSummary | null>(null);
  const [dashboardSummaryLoading, setDashboardSummaryLoading] = useState(true);
  const [dashboardSummaryError, setDashboardSummaryError] = useState("");
  const [updatingOrderId, setUpdatingOrderId] = useState("");
  const [orderMutationMessages, setOrderMutationMessages] = useState<
    Record<string, string>
  >({});
  const [conflictedOrderIds, setConflictedOrderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showRenewalInfo, setShowRenewalInfo] = useState(false);
  const [customerOrderUrl, setCustomerOrderUrl] = useState("");
  const [qrError, setQrError] = useState("");
  const [isQrReady, setIsQrReady] = useState(false);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [selectedCoverFile, setSelectedCoverFile] = useState<File | null>(null);
  const [activePanelSection, setActivePanelSection] =
    useState<PanelSection>("overview");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuDialogRef = useRef<HTMLElement | null>(null);
  const mobileMenuCloseRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const watcherStateRef = useRef(createInitialNewOrderWatcherState());
  const audioContextRef = useRef<AudioContext | null>(null);
  const isAudioUnlockedRef = useRef(false);
  const ordersRef = useRef<BusinessOrder[]>([]);
  const productsRef = useRef<BusinessProduct[]>([]);
  const inFlightProductMutationsRef = useRef(new Set<string>());
  const conflictedProductIdsRef = useRef(new Set<string>());
  const createProductInFlightRef = useRef(false);
  const productMutationCountRef = useRef(0);
  const productListAbortControllerRef = useRef<AbortController | null>(null);
  const productListRequestGenerationRef = useRef(0);
  const inFlightOrderMutationsRef = useRef(new Set<string>());
  const conflictedOrderIdsRef = useRef(new Set<string>());
  const orderListAbortControllerRef = useRef<AbortController | null>(null);
  const orderListRequestGenerationRef = useRef(0);

  function endBusinessSession() {
    clearBrowserAuthSession(sessionKey);
    setAccessToken("");
    router.replace("/giris");
  }

  async function getFreshAccessToken() {
    const token = await getValidAccessToken(getBusinessAuthConfig());
    if (!token) {
      endBusinessSession();
      return "";
    }
    setAccessToken(token);
    return token;
  }

  useEffect(() => {
    return () => {
      orderListRequestGenerationRef.current += 1;
      orderListAbortControllerRef.current?.abort();
      orderListAbortControllerRef.current = null;
      productListRequestGenerationRef.current += 1;
      productListAbortControllerRef.current?.abort();
      productListAbortControllerRef.current = null;
      productsRef.current = [];
      inFlightProductMutationsRef.current.clear();
      conflictedProductIdsRef.current.clear();
      createProductInFlightRef.current = false;
      productMutationCountRef.current = 0;
      inFlightOrderMutationsRef.current.clear();
      conflictedOrderIdsRef.current.clear();
    };
  }, []);

  const canManageProducts = useMemo(
    () => (business ? isBusinessSubscriptionActive(business) : false),
    [business],
  );
  const isEditingProductConflicted = Boolean(
    editingProductId && conflictedProductIds.has(editingProductId),
  );
  const subscriptionLabel = canManageProducts
    ? "Abonelik aktif"
    : business?.subscriptionStatus === "blocked"
      ? "Erişim kapalı"
      : "Abonelik pasif";
  const isSavingBusinessProfile = isSavingProfile || Boolean(profileUploadStatus);
  const sortedProducts = useMemo(() => sortProducts(products), [products]);
  const categorySummaries = useMemo(() => {
    const counts = new Map<string, number>();

    sortedProducts.forEach((product) => {
      const category = getProductCategory(product);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((first, second) =>
        first.name.localeCompare(second.name, "tr", { sensitivity: "base" }),
      );
  }, [sortedProducts]);
  const filteredProducts = useMemo(() => {
    const normalizedSearch = productSearch.trim().toLocaleLowerCase("tr-TR");

    return sortedProducts.filter((product) => {
      const matchesCategory =
        selectedCategoryFilter === "Tüm ürünler" ||
        getProductCategory(product) === selectedCategoryFilter;
      const matchesSearch =
        !normalizedSearch ||
        product.name.toLocaleLowerCase("tr-TR").includes(normalizedSearch);

      return matchesCategory && matchesSearch;
    });
  }, [productSearch, sortedProducts, selectedCategoryFilter]);
  const activeProductCount = products.filter((product) => product.isActive).length;
  const passiveProductCount = products.length - activeProductCount;
  const hasAnyProductConflict = conflictedProductIds.size > 0;
  const isProductOrderingFiltered =
    Boolean(productSearch.trim()) || selectedCategoryFilter !== "Tüm ürünler";
  const newOrderCount = overviewOrders.filter(
    (order) => order.status === "new",
  ).length;
  const recentOrders = overviewOrders.slice(0, 3);
  const activeOrderQuery: BusinessOrderPageQuery = {
    status:
      selectedOrderStatusFilter === "all"
        ? undefined
        : selectedOrderStatusFilter,
    search: appliedOrderSearch || undefined,
    dateFrom: appliedOrderDateFrom || undefined,
    dateTo: appliedOrderDateTo || undefined,
    page: orderPage,
    pageSize: orderPageSize,
  };
  const activePendingNewOrder = pendingNewOrders[0];

  function playNewOrderSound() {
    const audioContext = audioContextRef.current;
    if (!isAudioUnlockedRef.current || audioContext?.state !== "running") return;

    try {
      const startAt = audioContext.currentTime;
      [
        { frequency: 660, offset: 0 },
        { frequency: 880, offset: 0.16 },
      ].forEach(({ frequency, offset }) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, startAt + offset);
        gain.gain.setValueAtTime(0.0001, startAt + offset);
        gain.gain.exponentialRampToValueAtTime(0.08, startAt + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.12);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(startAt + offset);
        oscillator.stop(startAt + offset + 0.13);
      });
    } catch {
      // Audio is best-effort; the persistent visual alert remains available.
    }
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadPanel() {
      try {
        const token = await getFreshAccessToken();
        if (!token || isCancelled) return;

        const foundBusiness = await getCurrentUserBusiness(token);
        if (!foundBusiness) {
          setBusiness(null);
          commitAuthoritativeProducts([]);
          setError("Giriş yapan kullanıcıya ait işletme bulunamadı.");
          return;
        }

        setBusiness(foundBusiness);
        setProfileForm(toProfileForm(foundBusiness));
        await refreshProducts({
          targetBusiness: foundBusiness,
          accessToken: token,
        });
      } catch {
        setError("Panel verileri yüklenirken bir hata oluştu.");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    loadPanel();

    return () => {
      isCancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let isDisposed = false;

    const unlockAudio = () => {
      if (isDisposed) return;
      try {
        const audioContext =
          audioContextRef.current ?? new window.AudioContext();
        audioContextRef.current = audioContext;
        void audioContext
          .resume()
          .then(() => {
            if (!isDisposed && audioContext.state === "running") {
              isAudioUnlockedRef.current = true;
            }
          })
          .catch(() => undefined);
      } catch {
        // Browsers without an available AudioContext still receive visual alerts.
      }
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      isDisposed = true;
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      isAudioUnlockedRef.current = false;
      const audioContext = audioContextRef.current;
      audioContextRef.current = null;
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    if (isLoading || !business) return;

    let isActive = true;
    let abortController: AbortController | null = null;
    watcherStateRef.current = {
      ...createInitialNewOrderWatcherState(),
      initialized: true,
    };
    setPendingNewOrders([]);
    setWatcherFailureCount(0);

    const runWatcherCheck = async (): Promise<NewOrderPollingCheckResult> => {
      const token = await getValidAccessToken(getBusinessAuthConfig());
      if (!isActive) return "stop";
      if (!token) {
        endBusinessSession();
        return "stop";
      }

      abortController = new AbortController();
      try {
        let pageResult = await fetchBusinessOrdersPage(
          token,
          { page: 1, pageSize: NEW_ORDER_WATCHER_PAGE_SIZE },
          { signal: abortController.signal },
        );
        if (!isActive) return "stop";

        if (!watcherStateRef.current.baselineEstablished) {
          watcherStateRef.current = establishNewOrderBaseline(
            watcherStateRef.current,
            pageResult.orders,
          ).state;
          return "success";
        }

        let session = createNewOrderPollSession(watcherStateRef.current);
        while (isActive) {
          const ingested = ingestNewOrderWatcherPage(session, pageResult);
          session = ingested.session;
          if (!ingested.shouldFetchNextPage) break;

          pageResult = await fetchBusinessOrdersPage(
            token,
            {
              page: pageResult.pagination.page + 1,
              pageSize: NEW_ORDER_WATCHER_PAGE_SIZE,
            },
            { signal: abortController.signal },
          );
          if (!isActive) return "stop";
        }

        const completed = completeNewOrderPoll(
          watcherStateRef.current,
          session,
        );
        watcherStateRef.current = completed.state;
        setPendingNewOrders(completed.state.pendingNewOrders);
        if (completed.newOrders.length > 0) playNewOrderSound();
        return "success";
      } catch (caughtError) {
        if (!isActive) return "stop";
        if (
          caughtError instanceof BusinessOrdersRequestError &&
          caughtError.status === 401
        ) {
          endBusinessSession();
          return "stop";
        }
        return "failure";
      } finally {
        abortController = null;
      }
    };

    const controller = createNewOrderPollingController({
      runtime: {
        isVisible: () => document.visibilityState === "visible",
        isOnline: () => navigator.onLine !== false,
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (timer) => window.clearTimeout(timer as number),
      },
      runCheck: runWatcherCheck,
      onFailureCountChange(failureCount) {
        watcherStateRef.current = {
          ...watcherStateRef.current,
          consecutiveFailures: failureCount,
        };
        if (isActive) setWatcherFailureCount(failureCount);
      },
    });
    const handleVisibilityChange = () => controller.handleVisibilityChange();
    const handleOnline = () => controller.handleOnline();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    controller.start();

    return () => {
      isActive = false;
      controller.cleanup();
      abortController?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [business?.id, isLoading, router]);

  useEffect(() => {
    if (!business?.slug) {
      setCustomerOrderUrl("");
      setQrError("");
      setIsQrReady(false);
      return;
    }

    const nextCustomerOrderUrl = `${window.location.origin}/isletme/${encodeURIComponent(
      business.slug,
    )}`;
    setCustomerOrderUrl(nextCustomerOrderUrl);

    if (isLoading || activePanelSection !== "qr") {
      setIsQrReady(false);
      return;
    }

    const canvas = qrCanvasRef.current;
    if (!canvas) {
      setIsQrReady(false);
      return;
    }

    let isCancelled = false;
    setQrError("");
    setIsQrReady(false);

    void QRCode.toCanvas(canvas, nextCustomerOrderUrl, {
      width: 280,
      margin: 4,
      errorCorrectionLevel: "M",
      color: {
        dark: "#14231a",
        light: "#ffffff",
      },
    })
      .then(() => {
        if (!isCancelled) setIsQrReady(true);
      })
      .catch(() => {
        if (isCancelled) return;
        setIsQrReady(false);
        setQrError("QR kod hazırlanamadı. Lütfen sayfayı yenileyip tekrar deneyin.");
      });

    return () => {
      isCancelled = true;
    };
  }, [activePanelSection, business?.slug, isLoading]);

  useModalFocusTrap({
    isOpen: isMobileMenuOpen,
    dialogRef: mobileMenuDialogRef,
    initialFocusRef: mobileMenuCloseRef,
    returnFocusRef: mobileMenuTriggerRef,
    onClose: () => setIsMobileMenuOpen(false),
  });

  useEffect(() => {
    if (isLoading || !business) return;

    let isCancelled = false;

    async function loadOverviewOrders() {
      const token = await getFreshAccessToken();
      if (!token || isCancelled) return;

      setIsLoadingOverviewOrders(true);
      setOverviewOrdersError("");
      try {
        const freshOrders = await fetchBusinessOrders(token);
        if (!isCancelled) setOverviewOrders(freshOrders);
      } catch {
        if (!isCancelled) {
          setOverviewOrdersError("Sipariş özeti şu anda alınamıyor.");
        }
      } finally {
        if (!isCancelled) setIsLoadingOverviewOrders(false);
      }
    }

    void loadOverviewOrders();

    return () => {
      isCancelled = true;
    };
  }, [business?.id, isLoading]);

  useEffect(() => {
    if (isLoading || !business) return;

    let isCancelled = false;
    void refreshDashboardSummary(() => isCancelled);

    return () => {
      isCancelled = true;
    };
  }, [business?.id, isLoading]);

  async function refreshDashboardSummary(
    shouldIgnoreResult: () => boolean = () => false,
  ) {
    setDashboardSummaryLoading(true);
    setDashboardSummaryError("");

    try {
      const token = await getFreshAccessToken();
      if (!token || shouldIgnoreResult()) return;

      const summary = await fetchBusinessDashboardSummary(token);
      if (shouldIgnoreResult()) return;

      setDashboardSummary(summary);
      setDashboardSummaryError("");
    } catch {
      if (!shouldIgnoreResult()) {
        setDashboardSummaryError(businessDashboardSummaryErrorMessage);
      }
    } finally {
      if (!shouldIgnoreResult()) setDashboardSummaryLoading(false);
    }
  }

  function reconcileProductCategoryFilter(nextProducts: BusinessProduct[]) {
    setSelectedCategoryFilter((current) => {
      if (current === "Tüm ürünler") return current;
      return nextProducts.some(
        (product) => getProductCategory(product) === current,
      )
        ? current
        : "Tüm ürünler";
    });
  }

  function commitAuthoritativeProducts(nextProducts: BusinessProduct[]) {
    productsRef.current = nextProducts;
    setProducts(nextProducts);
    reconcileProductCategoryFilter(nextProducts);
  }

  function mergeAuthoritativeProduct(authoritativeProduct: BusinessProduct) {
    const exists = productsRef.current.some(
      (product) => product.id === authoritativeProduct.id,
    );
    const nextProducts = exists
      ? productsRef.current.map((product) =>
          product.id === authoritativeProduct.id
            ? authoritativeProduct
            : product,
        )
      : [...productsRef.current, authoritativeProduct];
    commitAuthoritativeProducts(nextProducts);
    setConflictedProductIds((current) => {
      if (!current.has(authoritativeProduct.id)) return current;
      const next = new Set(current);
      next.delete(authoritativeProduct.id);
      conflictedProductIdsRef.current = next;
      return next;
    });
  }

  function mergeAuthoritativeProducts(
    authoritativeProducts: BusinessProduct[],
  ) {
    const authoritativeById = new Map(
      authoritativeProducts.map((product) => [product.id, product]),
    );
    commitAuthoritativeProducts(
      productsRef.current.map(
        (product) => authoritativeById.get(product.id) ?? product,
      ),
    );
  }

  function removeAuthoritativeProduct(productId: string) {
    commitAuthoritativeProducts(
      productsRef.current.filter((product) => product.id !== productId),
    );
  }

  function cancelActiveProductListRequest() {
    productListRequestGenerationRef.current += 1;
    productListAbortControllerRef.current?.abort();
    productListAbortControllerRef.current = null;
  }

  function beginProductMutation(productIds: string[], isCreate = false) {
    if (
      (isCreate && createProductInFlightRef.current) ||
      productIds.some((productId) =>
        inFlightProductMutationsRef.current.has(productId),
      )
    ) {
      return false;
    }

    if (isCreate) createProductInFlightRef.current = true;
    productIds.forEach((productId) =>
      inFlightProductMutationsRef.current.add(productId),
    );
    productMutationCountRef.current += 1;
    setIsSaving(true);
    cancelActiveProductListRequest();
    return true;
  }

  function endProductMutation(productIds: string[], isCreate = false) {
    if (isCreate) createProductInFlightRef.current = false;
    productIds.forEach((productId) =>
      inFlightProductMutationsRef.current.delete(productId),
    );
    productMutationCountRef.current = Math.max(
      0,
      productMutationCountRef.current - 1,
    );
    setIsSaving(productMutationCountRef.current > 0);
  }

  function handleProductMutationFailure(
    caughtError: unknown,
    affectedProductIds: string[],
  ) {
    const mutationError =
      caughtError instanceof BusinessProductMutationError
        ? caughtError
        : new BusinessProductMutationError("PRODUCT_UNAVAILABLE", null);

    if (mutationError.code === "PRODUCT_UNAUTHORIZED") {
      endBusinessSession();
      return;
    }
    if (mutationError.code === "PRODUCT_CONFLICT") {
      setConflictedProductIds((current) => {
        const next = new Set(current);
        affectedProductIds.forEach((productId) => next.add(productId));
        conflictedProductIdsRef.current = next;
        return next;
      });
    }
    setProductOperationError(getProductMutationErrorMessage(mutationError.code));
  }

  async function refreshProducts(
    options: {
      targetBusiness?: BusinessPanelBusiness;
      accessToken?: string;
      replaceEditingForm?: boolean;
    } = {},
  ) {
    const targetBusiness = options.targetBusiness ?? business;
    if (!targetBusiness) return null;

    const requestGeneration = productListRequestGenerationRef.current + 1;
    productListRequestGenerationRef.current = requestGeneration;
    productListAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    productListAbortControllerRef.current = abortController;

    try {
      const token = options.accessToken ?? (await getFreshAccessToken());
      if (!token || requestGeneration !== productListRequestGenerationRef.current) {
        return null;
      }
      const freshProducts = await fetchProductsByBusinessId(
        targetBusiness.id,
        token,
        { signal: abortController.signal },
      );
      if (requestGeneration !== productListRequestGenerationRef.current) {
        return null;
      }

      commitAuthoritativeProducts(freshProducts);
      conflictedProductIdsRef.current = new Set();
      setConflictedProductIds(conflictedProductIdsRef.current);
      setProductOperationError("");
      if (options.replaceEditingForm && editingProductId) {
        const refreshedProduct = freshProducts.find(
          (product) => product.id === editingProductId,
        );
        if (refreshedProduct) {
          setForm(toForm(refreshedProduct));
          setOriginalProductCategory(refreshedProduct.category?.trim() || "");
          setIsProductCategoryChanged(false);
          setSelectedImageFile(null);
          if (imageInputRef.current) imageInputRef.current.value = "";
        } else {
          resetForm();
        }
      }
      return freshProducts;
    } catch (caughtError) {
      if (
        isAbortError(caughtError) ||
        requestGeneration !== productListRequestGenerationRef.current
      ) {
        return null;
      }
      if (
        caughtError instanceof BusinessProductsRequestError &&
        caughtError.status === 401
      ) {
        endBusinessSession();
        return null;
      }
      setProductOperationError(
        "Ürünler yüklenemedi. Lütfen tekrar deneyin.",
      );
      return null;
    } finally {
      if (productListAbortControllerRef.current === abortController) {
        productListAbortControllerRef.current = null;
      }
    }
  }

  function cancelActiveOrderListRequest() {
    orderListRequestGenerationRef.current += 1;
    orderListAbortControllerRef.current?.abort();
    orderListAbortControllerRef.current = null;
    setIsLoadingOrders(false);
  }

  function mergeAuthoritativeOrder(updatedOrder: BusinessOrder) {
    const nextOrders = ordersRef.current.map((order) =>
      order.id === updatedOrder.id ? updatedOrder : order,
    );
    ordersRef.current = nextOrders;
    setOrders(nextOrders);
    setOverviewOrders((current) =>
      current.map((order) =>
        order.id === updatedOrder.id ? updatedOrder : order,
      ),
    );
    watcherStateRef.current = {
      ...watcherStateRef.current,
      pendingNewOrders: watcherStateRef.current.pendingNewOrders.map((order) =>
        order.id === updatedOrder.id ? updatedOrder : order,
      ),
    };
    setPendingNewOrders(watcherStateRef.current.pendingNewOrders);
    setOrderMutationMessages((current) => {
      if (!(updatedOrder.id in current)) return current;
      const next = { ...current };
      delete next[updatedOrder.id];
      return next;
    });
    setConflictedOrderIds((current) => {
      if (!current.has(updatedOrder.id)) return current;
      const next = new Set(current);
      next.delete(updatedOrder.id);
      conflictedOrderIdsRef.current = next;
      return next;
    });
  }

  async function refreshOrders(
    query: BusinessOrderPageQuery,
    targetOrderId = "",
  ) {
    const requestGeneration = orderListRequestGenerationRef.current + 1;
    orderListRequestGenerationRef.current = requestGeneration;
    orderListAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    orderListAbortControllerRef.current = abortController;

    setIsLoadingOrders(true);
    setOrdersError("");
    try {
      const token = await getFreshAccessToken();
      if (
        !token ||
        abortController.signal.aborted ||
        requestGeneration !== orderListRequestGenerationRef.current
      ) {
        return null;
      }

      let result = await fetchBusinessOrdersPage(token, query, {
        signal: abortController.signal,
      });

      if (
        result.orders.length === 0 &&
        result.pagination.total > 0 &&
        query.page > result.pagination.totalPages
      ) {
        result = await fetchBusinessOrdersPage(
          token,
          {
            ...query,
            page: result.pagination.totalPages,
          },
          { signal: abortController.signal },
        );
      }

      if (
        abortController.signal.aborted ||
        requestGeneration !== orderListRequestGenerationRef.current
      ) {
        return null;
      }

      ordersRef.current = result.orders;
      setOrders(result.orders);
      setOrderPage(result.pagination.page);
      setOrderPagination(result.pagination);
      setExpandedOrderId((currentOrderId) =>
        targetOrderId
          ? result.orders.some((order) => order.id === targetOrderId)
            ? targetOrderId
            : ""
          : result.orders.some((order) => order.id === currentOrderId)
            ? currentOrderId
            : "",
      );
      conflictedOrderIdsRef.current = new Set();
      setConflictedOrderIds(conflictedOrderIdsRef.current);
      setOrderMutationMessages({});
      setOrdersError("");
      return result;
    } catch (caughtError) {
      if (
        isAbortError(caughtError) ||
        abortController.signal.aborted ||
        requestGeneration !== orderListRequestGenerationRef.current
      ) {
        return null;
      }
      setOrdersError(businessOrdersLoadErrorMessage);
      return null;
    } finally {
      if (requestGeneration === orderListRequestGenerationRef.current) {
        if (orderListAbortControllerRef.current === abortController) {
          orderListAbortControllerRef.current = null;
        }
        setIsLoadingOrders(false);
      }
    }
  }

  async function changeOrderStatus(orderId: string, status: OrderStatus) {
    const authoritativeOrder = ordersRef.current.find(
      (order) => order.id === orderId,
    );
    if (
      !authoritativeOrder ||
      authoritativeOrder.status === status ||
      conflictedOrderIdsRef.current.has(orderId) ||
      inFlightOrderMutationsRef.current.has(orderId)
    ) {
      return;
    }

    inFlightOrderMutationsRef.current.add(orderId);
    cancelActiveOrderListRequest();

    setUpdatingOrderId(orderId);
    setError("");
    setMessage("");
    setOrderMutationMessages((current) => {
      if (!(orderId in current)) return current;
      const next = { ...current };
      delete next[orderId];
      return next;
    });
    try {
      const token = await getFreshAccessToken();
      if (!token) return;

      const updatedOrder = await updateBusinessOrderStatus(
        orderId,
        status,
        authoritativeOrder.updatedAt,
        token,
      );
      cancelActiveOrderListRequest();
      mergeAuthoritativeOrder(updatedOrder);
      setMessage("Sipariş durumu güncellendi.");
      void refreshDashboardSummary();
      if (
        activeOrderQuery.status &&
        activeOrderQuery.status !== updatedOrder.status
      ) {
        await refreshOrders(activeOrderQuery);
      }
    } catch (caughtError) {
      cancelActiveOrderListRequest();
      const mutationError =
        caughtError instanceof BusinessOrderMutationError
          ? caughtError
          : new BusinessOrderMutationError("ORDER_UNAVAILABLE", null);

      if (mutationError.code === "ORDER_UNAUTHORIZED") {
        endBusinessSession();
        return;
      }

      setOrderMutationMessages((current) => ({
        ...current,
        [orderId]: getOrderMutationErrorMessage(mutationError.code),
      }));
      if (mutationError.code === "ORDER_CONFLICT") {
        setConflictedOrderIds((current) => {
          const next = new Set(current).add(orderId);
          conflictedOrderIdsRef.current = next;
          return next;
        });
      }
    } finally {
      inFlightOrderMutationsRef.current.delete(orderId);
      setUpdatingOrderId((current) => (current === orderId ? "" : current));
    }
  }

  function changeOrderStatusFilter(statusFilter: OrderStatus | "all") {
    if (isLoadingOrders || inFlightOrderMutationsRef.current.size > 0) return;

    setSelectedOrderStatusFilter(statusFilter);
    setOrderPage(1);
    setExpandedOrderId("");
    if (activePanelSection === "orders") {
      void refreshOrders({
        ...activeOrderQuery,
        status: statusFilter === "all" ? undefined : statusFilter,
        page: 1,
      });
    }
  }

  function applyOrderFilters() {
    if (isLoadingOrders || inFlightOrderMutationsRef.current.size > 0) return;

    const nextSearch = orderSearchDraft.trim();
    const nextDateFrom = orderDateFromDraft;
    const nextDateTo = orderDateToDraft;

    setAppliedOrderSearch(nextSearch);
    setAppliedOrderDateFrom(nextDateFrom);
    setAppliedOrderDateTo(nextDateTo);
    setOrderPage(1);
    setExpandedOrderId("");
    void refreshOrders({
      ...activeOrderQuery,
      search: nextSearch || undefined,
      dateFrom: nextDateFrom || undefined,
      dateTo: nextDateTo || undefined,
      page: 1,
    });
  }

  function clearOrderFilters() {
    if (isLoadingOrders || inFlightOrderMutationsRef.current.size > 0) return;

    setOrderSearchDraft("");
    setOrderDateFromDraft("");
    setOrderDateToDraft("");
    setAppliedOrderSearch("");
    setAppliedOrderDateFrom("");
    setAppliedOrderDateTo("");
    setSelectedOrderStatusFilter("all");
    setOrderPage(1);
    setExpandedOrderId("");
    void refreshOrders({
      page: 1,
      pageSize: orderPageSize,
    });
  }

  function changeOrderPageSize(pageSize: number) {
    if (
      isLoadingOrders ||
      inFlightOrderMutationsRef.current.size > 0 ||
      ![10, 20, 50].includes(pageSize)
    ) return;

    setOrderPageSize(pageSize);
    setOrderPage(1);
    setExpandedOrderId("");
    void refreshOrders({
      ...activeOrderQuery,
      page: 1,
      pageSize,
    });
  }

  function changeOrderPage(page: number) {
    if (
      isLoadingOrders ||
      inFlightOrderMutationsRef.current.size > 0 ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > orderPagination.totalPages ||
      page === orderPage
    ) {
      return;
    }

    setOrderPage(page);
    setExpandedOrderId("");
    void refreshOrders({
      ...activeOrderQuery,
      page,
    });
  }

  function refreshActiveOrders() {
    if (isLoadingOrders || inFlightOrderMutationsRef.current.size > 0) return;
    void refreshOrders(activeOrderQuery);
  }

  function toggleOrderDetails(orderId: string) {
    setIsMobileMenuOpen(false);
    setExpandedOrderId((currentOrderId) =>
      currentOrderId === orderId ? "" : orderId,
    );
  }

  function openMobileMenu(event: React.MouseEvent<HTMLButtonElement>) {
    mobileMenuTriggerRef.current = event.currentTarget;
    setExpandedOrderId("");
    setIsMobileMenuOpen(true);
  }

  function updateForm(field: keyof ProductForm, value: string | boolean) {
    setError("");
    setMessage("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateProfileForm(
    field: keyof ProfileForm,
    value: ProfileForm[keyof ProfileForm],
  ) {
    setError("");
    setMessage("");
    setProfileForm((current) => ({ ...current, [field]: value }));
  }

  async function copyRenewalText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setError("");
      setMessage(`${label} kopyalandı.`);
    } catch {
      setError(`${label} kopyalanamadı. Manuel olarak seçip kopyalayabilirsiniz.`);
    }
  }

  async function copyCustomerOrderLink() {
    if (!customerOrderUrl) return;
    try {
      await navigator.clipboard.writeText(customerOrderUrl);
      setError("");
      setMessage("Sipariş bağlantısı kopyalandı.");
    } catch {
      setMessage("");
      setError("Sipariş bağlantısı kopyalanamadı. Manuel olarak seçebilirsiniz.");
    }
  }

  function downloadCustomerQrCode() {
    if (!business?.slug || !qrCanvasRef.current || !isQrReady) return;
    try {
      const downloadLink = document.createElement("a");
      downloadLink.download = `siparis-qr-${safeQrFileSlug(business.slug)}.png`;
      downloadLink.href = qrCanvasRef.current.toDataURL("image/png");
      downloadLink.click();
      setError("");
      setMessage("QR kod PNG olarak indirildi.");
    } catch {
      setMessage("");
      setError("QR kod indirilemedi. Lütfen tekrar deneyin.");
    }
  }

  function printCustomerQrCode() {
    if (
      !business ||
      !customerOrderUrl ||
      !qrCanvasRef.current ||
      !isQrReady
    ) {
      return;
    }

    try {
      const result = openPrintDocument({
        type: "customer-qr",
        businessName: business.name,
        orderUrl: customerOrderUrl,
        qrDataUrl: qrCanvasRef.current.toDataURL("image/png"),
      });
      handlePrintDocumentResult(result);
    } catch {
      setMessage("");
      setError("QR kod yazdırma için hazırlanamadı. Lütfen tekrar deneyin.");
    }
  }

  function handlePrintDocumentResult(result: PrintDocumentOpenResult) {
    if (result === "opened") {
      setError("");
      return;
    }

    setMessage("");
    setError(
      result === "busy"
        ? "Yazdırma penceresi zaten açık. Açık pencereyi kapatıp tekrar deneyin."
        : "Yazdırma penceresi açılamadı. Tarayıcınızda açılır pencereye izin verip tekrar deneyin.",
    );
  }

  function printBusinessOrder(order: BusinessOrder) {
    if (!business || updatingOrderId === order.id) return;
    const receipt = createOrderPrintReceiptModel({
      business: {
        name: business.name,
        address: business.address,
        whatsappOrderNumber: business.whatsappOrderNumber,
      },
      order,
      paperWidth: orderPrintPaperWidth,
    });
    handlePrintDocumentResult(
      openPrintDocument({
        type: "order-receipt",
        receipt,
      }),
    );
  }

  function printOrder(orderId: string) {
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order || expandedOrderId !== orderId) return;
    printBusinessOrder(order);
  }

  function dismissNewOrderAlert(orderId: string) {
    watcherStateRef.current = dismissPendingNewOrder(
      watcherStateRef.current,
      orderId,
    );
    setPendingNewOrders(watcherStateRef.current.pendingNewOrders);
  }

  async function viewBusinessOrder(order: BusinessOrder) {
    clearProductEditingState();
    setSelectedOrderStatusFilter("all");
    setOrderSearchDraft("");
    setOrderDateFromDraft("");
    setOrderDateToDraft("");
    setAppliedOrderSearch("");
    setAppliedOrderDateFrom("");
    setAppliedOrderDateTo("");
    setOrderPage(1);
    setExpandedOrderId("");
    setActivePanelSection("orders");
    setError("");
    setMessage("");

    const firstPage = await refreshOrders(
      { page: 1, pageSize: orderPageSize },
      order.id,
    );
    if (!firstPage || firstPage.orders.some(({ id }) => id === order.id)) return;

    const exactOrderSearch = String(order.orderNumber);
    setOrderSearchDraft(exactOrderSearch);
    setAppliedOrderSearch(exactOrderSearch);
    await refreshOrders(
      { search: exactOrderSearch, page: 1, pageSize: orderPageSize },
      order.id,
    );
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingProductId("");
    setOriginalProductCategory("");
    setIsProductCategoryChanged(false);
    setSelectedImageFile(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function changeProductCategory(category: string) {
    setIsProductCategoryChanged(true);
    updateForm("category", category);
  }

  function keepOriginalProductCategory() {
    if (
      !editingProductId ||
      !originalProductCategory.trim() ||
      isStandardProductCategory(originalProductCategory) ||
      isSaving ||
      isUploadingImage
    ) {
      return;
    }

    setIsProductCategoryChanged(false);
    updateForm("category", "");
  }

  function clearProductEditingState() {
    setExpandedProductId("");
    if (editingProductId) resetForm();
  }

  function switchPanelSection(section: PanelSection) {
    if (section !== activePanelSection) {
      clearProductEditingState();
    }
    setActivePanelSection(section);
    setIsMobileMenuOpen(false);
    setError("");
    setMessage("");
    if (section === "orders") {
      void refreshOrders(activeOrderQuery);
    }
  }

  function openOrdersFromOverview(orderId = "") {
    clearProductEditingState();
    setSelectedOrderStatusFilter("all");
    setExpandedOrderId(orderId);
    setActivePanelSection("orders");
    setError("");
    setMessage("");
    setOrderPage(1);
    void refreshOrders({
      ...activeOrderQuery,
      status: undefined,
      page: 1,
    });
  }

  function openCategoryProducts(category: string) {
    setSelectedCategoryFilter(category);
    switchPanelSection("products");
  }

  function validateForm() {
    const price = Number(form.price);
    const sortOrder = Number(form.sortOrder || 0);

    if (!form.name.trim()) return "Ürün adı boş olamaz.";
    if (!Number.isFinite(price) || price < 0) return "Fiyat geçerli bir sayı olmalıdır.";
    if (!Number.isFinite(sortOrder)) return "Sıralama geçerli bir sayı olmalıdır.";
    const hasUntouchedLegacyCategory =
      Boolean(editingProductId) &&
      Boolean(originalProductCategory.trim()) &&
      !isStandardProductCategory(originalProductCategory) &&
      !isProductCategoryChanged;
    if (
      !hasUntouchedLegacyCategory &&
      !isStandardProductCategory(form.category)
    ) {
      return "Lütfen geçerli bir kategori seçin.";
    }
    return "";
  }

  function validateProfileForm() {
    const radius = profileForm.serviceRadiusKm.trim()
      ? Number(profileForm.serviceRadiusKm)
      : null;
    const minimumOrderAmount = profileForm.minimumOrderAmount.trim()
      ? Number(profileForm.minimumOrderAmount)
      : null;
    const preparationTimeMinutes = profileForm.preparationTimeMinutes.trim()
      ? Number(profileForm.preparationTimeMinutes)
      : null;

    if (!profileForm.name.trim()) return "İşletme adı boş olamaz.";
    if (!isPaymentMethodMode(profileForm.paymentMethodMode)) {
      return "Lütfen geçerli bir ödeme kabul yöntemi seçin.";
    }
    if (radius !== null && (!Number.isFinite(radius) || radius < 0)) {
      return "Servis yarıçapı geçerli bir sayı olmalıdır.";
    }
    if (
      minimumOrderAmount !== null &&
      (!Number.isFinite(minimumOrderAmount) || minimumOrderAmount < 0)
    ) {
      return "Minimum sipariş tutarı 0 veya daha büyük bir sayı olmalıdır.";
    }
    if (
      preparationTimeMinutes !== null &&
      (!Number.isInteger(preparationTimeMinutes) ||
        preparationTimeMinutes < 1 ||
        preparationTimeMinutes > 720)
    ) {
      return "Tahmini hazırlık süresi 1 ile 720 dakika arasında tam sayı olmalıdır.";
    }
    if (profileForm.deliveryStatus.trim().length > 120) {
      return "Teslimat / gel-al bilgisi en fazla 120 karakter olabilir.";
    }
    if (profileForm.orderNote.trim().length > 300) {
      return "Kısa sipariş notu en fazla 300 karakter olabilir.";
    }
    return "";
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!business) {
      setError("İşletme oturumu bulunamadı.");
      return;
    }

    const token = await getFreshAccessToken();
    if (!token) return;

    const validationError = validateProfileForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSavingProfile(true);
    let profileFailureMessage =
      "İşletme bilgileri kaydedilemedi. Lütfen tekrar deneyin.";

    try {
      const profilePayload = toProfileInput(profileForm);
      if (selectedLogoFile) {
        profileFailureMessage = "Görsel yüklenemedi. Lütfen tekrar deneyin.";
        setProfileUploadStatus("Logo yükleniyor...");
        const uploadedLogoUrl = await uploadBusinessImage(
          business.id,
          selectedLogoFile,
          "logo",
          token,
        );
        profilePayload.logoUrl = uploadedLogoUrl;
        setProfileForm((current) => ({ ...current, logoUrl: uploadedLogoUrl }));
        profileFailureMessage =
          "İşletme bilgileri kaydedilemedi. Lütfen tekrar deneyin.";
      }
      if (selectedCoverFile) {
        profileFailureMessage = "Görsel yüklenemedi. Lütfen tekrar deneyin.";
        setProfileUploadStatus("Kapak görseli yükleniyor...");
        const uploadedCoverUrl = await uploadBusinessImage(
          business.id,
          selectedCoverFile,
          "cover",
          token,
        );
        profilePayload.coverImageUrl = uploadedCoverUrl;
        setProfileForm((current) => ({
          ...current,
          coverImageUrl: uploadedCoverUrl,
        }));
        profileFailureMessage =
          "İşletme bilgileri kaydedilemedi. Lütfen tekrar deneyin.";
      }
      const updatedBusiness = await updateBusinessProfile(
        business.id,
        profilePayload,
        token,
      );
      if (updatedBusiness) {
        setBusiness(updatedBusiness);
        setProfileForm(toProfileForm(updatedBusiness));
      }
      setSelectedLogoFile(null);
      setSelectedCoverFile(null);
      if (logoInputRef.current) logoInputRef.current.value = "";
      if (coverInputRef.current) coverInputRef.current.value = "";
      setMessage("İşletme bilgileri kaydedildi.");
    } catch {
      setError(profileFailureMessage);
    } finally {
      setProfileUploadStatus("");
      setIsSavingProfile(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setProductOperationError("");

    if (!business) {
      setError("İşletme oturumu bulunamadı.");
      return;
    }

    if (!canManageProducts) {
      setError("Aboneliğiniz aktif olmadığı için ürün işlemi yapamazsınız.");
      return;
    }
    if (
      isEditingProductConflicted ||
      (editingProductId && conflictedProductIdsRef.current.has(editingProductId))
    ) {
      setProductOperationError(
        "Ürün başka bir oturumda güncellendi. Güncel bilgileri yükleyin.",
      );
      return;
    }

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    const targetProductId = editingProductId;
    const mutationProductIds = targetProductId ? [targetProductId] : [];
    const isCreateMutation = !targetProductId;
    if (!beginProductMutation(mutationProductIds, isCreateMutation)) return;

    try {
      const token = await getFreshAccessToken();
      if (!token) return;

      const payload = toProductInput(
        form,
        targetProductId ? 0 : getNextSortOrder(productsRef.current),
      );
      const hasUntouchedLegacyCategory =
        Boolean(targetProductId) &&
        Boolean(originalProductCategory.trim()) &&
        !isStandardProductCategory(originalProductCategory) &&
        !isProductCategoryChanged;
      if (hasUntouchedLegacyCategory) {
        delete payload.category;
      }
      if (selectedImageFile) {
        setIsUploadingImage(true);
        const uploadedImageUrl = await uploadProductImage(
          business.id,
          selectedImageFile,
          token,
        );
        payload.imageUrl = uploadedImageUrl;
        setForm((current) => ({ ...current, imageUrl: uploadedImageUrl }));
      }
      if (targetProductId) {
        const authoritativeProduct = productsRef.current.find(
          (product) => product.id === targetProductId,
        );
        if (!authoritativeProduct) {
          throw new BusinessProductMutationError("PRODUCT_NOT_FOUND", 404);
        }
        const updatedProduct = await updateProduct(
          targetProductId,
          payload,
          authoritativeProduct.updatedAt,
          token,
        );
        mergeAuthoritativeProduct(updatedProduct);
        setMessage("Ürün güncellendi.");
      } else {
        const createdProduct = await createProduct(payload, token);
        mergeAuthoritativeProduct(createdProduct);
        setSelectedCategoryFilter(getProductCategory(createdProduct));
        setMessage("Ürün eklendi.");
      }
      resetForm();
    } catch (caughtError) {
      handleProductMutationFailure(caughtError, mutationProductIds);
    } finally {
      setIsUploadingImage(false);
      endProductMutation(mutationProductIds, isCreateMutation);
    }
  }

  function startEdit(product: BusinessProduct) {
    if (!canManageProducts) return;
    setActivePanelSection("products");
    setExpandedProductId(product.id);
    setEditingProductId(product.id);
    setOriginalProductCategory(product.category?.trim() || "");
    setIsProductCategoryChanged(false);
    setForm(toForm(product));
    setSelectedImageFile(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
    setError("");
    setMessage("");
  }

  async function removeProduct(product: BusinessProduct) {
    if (!canManageProducts) return;
    const authoritativeProduct = productsRef.current.find(
      (candidate) => candidate.id === product.id,
    );
    if (!authoritativeProduct || conflictedProductIdsRef.current.has(product.id)) return;
    if (!window.confirm(`${authoritativeProduct.name} silinsin mi?`)) return;
    if (!beginProductMutation([product.id])) return;

    setError("");
    setMessage("");
    setProductOperationError("");

    try {
      const token = await getFreshAccessToken();
      if (!token) return;

      const deletedProduct = await deleteProduct(
        authoritativeProduct.id,
        authoritativeProduct.updatedAt,
        token,
      );
      removeAuthoritativeProduct(deletedProduct.id);
      setMessage("Ürün silindi.");
      if (editingProductId === product.id) resetForm();
      if (expandedProductId === product.id) setExpandedProductId("");
    } catch (caughtError) {
      handleProductMutationFailure(caughtError, [product.id]);
    } finally {
      endProductMutation([product.id]);
    }
  }

  async function toggleProduct(product: BusinessProduct) {
    if (!canManageProducts) return;
    const authoritativeProduct = productsRef.current.find(
      (candidate) => candidate.id === product.id,
    );
    if (!authoritativeProduct || conflictedProductIdsRef.current.has(product.id)) return;
    if (!beginProductMutation([product.id])) return;

    setError("");
    setMessage("");
    setProductOperationError("");

    try {
      const token = await getFreshAccessToken();
      if (!token) return;

      const updatedProduct = await setProductActiveStatus(
        authoritativeProduct.id,
        !authoritativeProduct.isActive,
        authoritativeProduct.updatedAt,
        token,
      );
      mergeAuthoritativeProduct(updatedProduct);
      setMessage(
        authoritativeProduct.isActive
          ? "Ürün pasife alındı."
          : "Ürün aktif edildi.",
      );
    } catch (caughtError) {
      handleProductMutationFailure(caughtError, [product.id]);
    } finally {
      endProductMutation([product.id]);
    }
  }

  async function moveProduct(product: BusinessProduct, direction: "up" | "down") {
    if (!canManageProducts || isProductOrderingFiltered) return;

    const currentProducts = sortProducts(productsRef.current);
    const currentIndex = currentProducts.findIndex((item) => item.id === product.id);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= currentProducts.length) {
      return;
    }

    const orderSlots = currentProducts.map((item) => {
      const globalIndex = currentProducts.findIndex(
        (sortedProduct) => sortedProduct.id === item.id,
      );
      return globalIndex >= 0 ? globalIndex + 1 : item.sortOrder;
    });
    const reorderedProducts = [...currentProducts];
    const movedProduct = reorderedProducts[currentIndex];
    reorderedProducts[currentIndex] = reorderedProducts[targetIndex];
    reorderedProducts[targetIndex] = movedProduct;
    const affectedProductIds = reorderedProducts.map((item) => item.id);
    if (
      affectedProductIds.some((productId) => conflictedProductIdsRef.current.has(productId)) ||
      !beginProductMutation(affectedProductIds)
    ) {
      return;
    }

    setError("");
    setMessage("");
    setProductOperationError("");

    try {
      const token = await getFreshAccessToken();
      if (!token) return;

      const authoritativeProducts = await reorderProducts(
        reorderedProducts.map((item, index) => ({
          productId: item.id,
          sortOrder: orderSlots[index],
          expectedUpdatedAt: item.updatedAt,
        })),
        token,
      );
      mergeAuthoritativeProducts(authoritativeProducts);
      setMessage(
        direction === "up" ? "Ürün yukarı taşındı." : "Ürün aşağı taşındı.",
      );
    } catch (caughtError) {
      handleProductMutationFailure(caughtError, affectedProductIds);
    } finally {
      endProductMutation(affectedProductIds);
    }
  }

  function logout() {
    clearBrowserAuthSession(sessionKey);
    router.replace("/giris");
  }

  function toggleProductDetails(productId: string) {
    const isClosingCurrentProduct = expandedProductId === productId;

    if (
      editingProductId &&
      (isClosingCurrentProduct || editingProductId !== productId)
    ) {
      resetForm();
    }

    setExpandedProductId(isClosingCurrentProduct ? "" : productId);
  }

  if (isLoading) {
    return (
      <main className={`page ${styles.panelScope}`}>
        <div className="shell section">
          <p>Panel yükleniyor...</p>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`page panel-qr-print-root business-panel-page ${styles.panelScope}`}
    >
      <div className="shell business-panel-shell">
        <header className="business-panel-header">
          <button
            aria-label="Panel menüsünü aç"
            className="business-panel-menu-trigger"
            type="button"
            onClick={openMobileMenu}
          >
            <PanelIcon name="menu" size={21} />
          </button>
          <div className="business-panel-header-copy">
            <PlatformBrand className="panel-platform-brand" publicVariant />
            <span className="business-panel-eyebrow">
              {business?.name ?? "İşletme Paneli"}
            </span>
            <div className="business-panel-identity">
              {business ? <BusinessIdentityLogo business={business} /> : null}
              <h1>{panelSectionLabels[activePanelSection]}</h1>
            </div>
            <p>İşletmenizi ve siparişlerinizi tek yerden yönetin.</p>
          </div>
          {business ? (
            <div className="business-panel-header-status">
              <span
                className={`business-panel-status-chip ${
                  business.isOpen ? "open" : "closed"
                }`}
              >
                {business.isOpen ? "Siparişe açık" : "Siparişe kapalı"}
              </span>
            </div>
          ) : null}
        </header>

        {activePendingNewOrder ? (
          <NewOrderAlert
            connectionWarning={watcherFailureCount >= 3}
            order={activePendingNewOrder}
            paperWidth={orderPrintPaperWidth}
            pendingCount={pendingNewOrders.length}
            onDismiss={dismissNewOrderAlert}
            onPaperWidthChange={setOrderPrintPaperWidth}
            onPrintOrder={printBusinessOrder}
            onViewOrder={(order) => void viewBusinessOrder(order)}
          />
        ) : null}

        {error ? <p className="alert">{error}</p> : null}
        {message ? <p className="alert success">{message}</p> : null}

        {!business ? (
          <section className="section">
            <h2>İşletme bulunamadı</h2>
            <p>Bu kullanıcıya bağlı bir işletme kaydı bulunamadı.</p>
          </section>
        ) : (
          <div className="business-panel-workspace">
            <aside className="business-panel-sidebar">
              <div className="business-panel-sidebar-brand">
                <PlatformBrand className="panel-platform-brand" publicVariant />
              </div>
              <div className="business-panel-sidebar-identity">
                {business ? <BusinessIdentityLogo business={business} /> : null}
                <span>
                  <strong>{business.name}</strong>
                  <small>İşletme hesabı</small>
                </span>
              </div>
              <nav
                className="business-panel-nav business-panel-desktop-nav"
                aria-label="Panel bölümleri"
              >
                <button
                  aria-current={activePanelSection === "overview" ? "page" : undefined}
                  className={activePanelSection === "overview" ? "active" : ""}
                  type="button"
                  onClick={() => switchPanelSection("overview")}
                >
                  <PanelIcon name="home" />
                  <span>Genel Bakış</span>
                </button>
                <button
                  aria-current={activePanelSection === "orders" ? "page" : undefined}
                  className={activePanelSection === "orders" ? "active" : ""}
                  type="button"
                  onClick={() => switchPanelSection("orders")}
                >
                  <PanelIcon name="orders" />
                  <span>Siparişler</span>
                  {newOrderCount > 0 ? (
                    <span className="business-panel-nav-badge">{newOrderCount}</span>
                  ) : null}
                </button>
                <button
                  aria-current={
                    activePanelSection === "products" || activePanelSection === "create"
                      ? "page"
                      : undefined
                  }
                  className={
                    activePanelSection === "products" || activePanelSection === "create"
                      ? "active"
                      : ""
                  }
                  type="button"
                  onClick={() => switchPanelSection("products")}
                >
                  <PanelIcon name="package" />
                  <span>Ürünler</span>
                </button>
                <button
                  aria-current={activePanelSection === "categories" ? "page" : undefined}
                  className={activePanelSection === "categories" ? "active" : ""}
                  type="button"
                  onClick={() => switchPanelSection("categories")}
                >
                  <PanelIcon name="categories" />
                  <span>Kategoriler</span>
                </button>
                <button
                  aria-current={activePanelSection === "profile" ? "page" : undefined}
                  className={activePanelSection === "profile" ? "active" : ""}
                  type="button"
                  onClick={() => switchPanelSection("profile")}
                >
                  <PanelIcon name="store" />
                  <span>İşletme Bilgileri</span>
                </button>
                <button
                  aria-current={activePanelSection === "qr" ? "page" : undefined}
                  className={activePanelSection === "qr" ? "active" : ""}
                  type="button"
                  onClick={() => switchPanelSection("qr")}
                >
                  <PanelIcon name="qr" />
                  <span>QR Kod</span>
                </button>
                <button
                  aria-current={activePanelSection === "renewal" ? "page" : undefined}
                  className={activePanelSection === "renewal" ? "active" : ""}
                  type="button"
                  onClick={() => switchPanelSection("renewal")}
                >
                  <PanelIcon name="subscription" />
                  <span>Abonelik</span>
                </button>
              </nav>
              <div className="business-panel-sidebar-membership">
                <span>Üyelik durumu</span>
                <strong>{subscriptionLabel}</strong>
                <button type="button" onClick={() => switchPanelSection("renewal")}>
                  Üyelik ayrıntıları
                </button>
              </div>
              <button className="business-panel-logout" type="button" onClick={logout}>
                <PanelIcon name="logout" />
                Çıkış Yap
              </button>
            </aside>

            <div className="business-panel-content">

            {activePanelSection === "overview" ? (
              <section className="section panel-section panel-overview-section business-panel-section">
                <div className="business-panel-section-heading">
                  <div>
                    <span className="business-panel-section-kicker">Bugünün görünümü</span>
                    <h2>Genel Bakış</h2>
                    <p>İşletmenizin güncel durumunu hızlıca takip edin.</p>
                  </div>
                  <span
                    className={`business-panel-status-chip ${
                      business.isOpen ? "open" : "closed"
                    }`}
                  >
                    {business.isOpen ? "Siparişe açık" : "Siparişe kapalı"}
                  </span>
                </div>

                <div
                  aria-busy={dashboardSummaryLoading}
                  className="business-panel-summary-area"
                >
                  <div className="business-panel-operations">
                    <div className="business-panel-operation-card priority">
                      <span className="business-panel-operation-label">
                        Bugünkü sipariş
                        <i><PanelIcon name="orders" size={17} /></i>
                      </span>
                      <strong>{dashboardSummary?.orders.total ?? "—"}</strong>
                      <small>İptaller dahil</small>
                    </div>
                    <div className="business-panel-operation-card">
                      <span className="business-panel-operation-label">
                        Bekleyen sipariş
                        <i><PanelIcon name="bell" size={17} /></i>
                      </span>
                      <strong>{dashboardSummary?.orders.pending ?? "—"}</strong>
                      <small>Yeni, hazırlanıyor ve hazır</small>
                    </div>
                    <div className="business-panel-operation-card">
                      <span className="business-panel-operation-label">
                        Tamamlanan sipariş
                        <i><PanelIcon name="package" size={17} /></i>
                      </span>
                      <strong>{dashboardSummary?.orders.delivered ?? "—"}</strong>
                      <small>Teslim edilen</small>
                    </div>
                    <div className="business-panel-operation-card">
                      <span className="business-panel-operation-label">
                        Günlük ciro
                        <i><PanelIcon name="subscription" size={17} /></i>
                      </span>
                      <strong>
                        {dashboardSummary
                          ? formatPrice(dashboardSummary.revenue.delivered)
                          : "—"}
                      </strong>
                      <small>Teslim edilen siparişler</small>
                    </div>
                  </div>

                  {dashboardSummaryError ? (
                    <div
                      className="business-panel-inline-state error business-panel-summary-error"
                      role="alert"
                    >
                      <span>{dashboardSummaryError}</span>
                      <button
                        disabled={dashboardSummaryLoading}
                        type="button"
                        onClick={() => void refreshDashboardSummary()}
                      >
                        {dashboardSummaryLoading
                          ? "Yeniden deneniyor..."
                          : "Tekrar dene"}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="business-panel-subsection-heading">
                  <span className="business-panel-section-kicker">Kısayollar</span>
                  <h3>Hızlı İşlemler</h3>
                </div>
                <div className="business-panel-quick-actions">
                  <button type="button" onClick={() => switchPanelSection("create")}>
                    <i><PanelIcon name="plus" size={19} /></i>
                    <span>
                      <strong>Yeni Ürün Ekle</strong>
                      <small>Menünüze yeni bir ürün ekleyin</small>
                    </span>
                    <PanelIcon name="arrow" size={17} />
                  </button>
                  <button type="button" onClick={() => switchPanelSection("qr")}>
                    <i><PanelIcon name="qr" size={19} /></i>
                    <span>
                      <strong>QR Kodumu Gör</strong>
                      <small>Sipariş sayfanızı paylaşın</small>
                    </span>
                    <PanelIcon name="arrow" size={17} />
                  </button>
                  <button type="button" onClick={() => switchPanelSection("profile")}>
                    <i><PanelIcon name="edit" size={18} /></i>
                    <span>
                      <strong>Bilgileri Düzenle</strong>
                      <small>İşletmenizi güncel tutun</small>
                    </span>
                    <PanelIcon name="arrow" size={17} />
                  </button>
                </div>

                <section className="business-panel-recent-orders">
                  <div className="business-panel-card-heading">
                    <div>
                      <h3>Son siparişler</h3>
                      <p>En güncel üç siparişin kısa özeti</p>
                    </div>
                    <button type="button" onClick={() => openOrdersFromOverview()}>
                      Tüm siparişleri gör
                    </button>
                  </div>

                  {isLoadingOverviewOrders ? (
                    <p className="business-panel-inline-state">Sipariş özeti yükleniyor...</p>
                  ) : overviewOrdersError ? (
                    <p className="business-panel-inline-state error">{overviewOrdersError}</p>
                  ) : recentOrders.length === 0 ? (
                    <p className="business-panel-inline-state">Henüz sipariş bulunmuyor.</p>
                  ) : (
                    <div className="business-panel-recent-list">
                      {recentOrders.map((order) => (
                        <button
                          className={`business-panel-recent-order ${
                            order.status === "new" ? "new" : ""
                          }`}
                          key={order.id}
                          type="button"
                          onClick={() => openOrdersFromOverview(order.id)}
                        >
                          <span>
                            <strong>#{order.orderNumber}</strong>
                            <b>{order.customerName}</b>
                            <small>
                              {order.items.reduce((total, item) => total + item.quantity, 0)} ürün ·{" "}
                              {order.orderType === "delivery" ? "Teslimat" : "Gel-al"} ·{" "}
                              {formatDateTime(order.createdAt)}
                            </small>
                          </span>
                          <span
                            className={`order-status-badge order-status-${order.status}`}
                          >
                            {orderStatusLabels[order.status]}
                          </span>
                          <b>{formatPrice(order.totalAmount)}</b>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="business-panel-membership-card">
                  <div>
                    <span>Üyelik durumu</span>
                    <strong>{subscriptionLabel}</strong>
                    <p>
                      Ürün ve profil işlemleriniz mevcut abonelik kurallarıyla korunur.
                    </p>
                  </div>
                  <button type="button" onClick={() => switchPanelSection("renewal")}>
                    Üyelik ayrıntıları
                  </button>
                </section>
              </section>
            ) : null}

            {activePanelSection === "qr" ? (
              <section className="section panel-section business-panel-section business-panel-qr-section">
                <div className="business-panel-section-heading">
                  <div>
                    <span className="business-panel-section-kicker">Müşteri bağlantısı</span>
                    <h2>QR Kod</h2>
                    <p>Müşterilerinizi gerçek sipariş sayfanıza yönlendirin.</p>
                  </div>
                </div>
                <section
                  className="panel-qr-card panel-qr-print-target business-panel-qr-card"
                  aria-labelledby="panel-qr-title"
                >
                  <div className="business-panel-qr-layout">
                    <div className="panel-qr-copy">
                      <span className="panel-qr-kicker">Müşteri sipariş sayfası</span>
                      <h3 id="panel-qr-title">Müşteri QR Kodu</h3>
                      <p>
                        QR kodu masalarda, paketlerde veya işletme girişinde
                        kullanabilirsiniz.
                      </p>
                      <strong className="panel-qr-print-business-name">
                        {business.name}
                      </strong>
                      <p className="panel-qr-print-instruction">
                        Sipariş için QR kodu okutun
                      </p>
                    </div>

                    {business.slug ? (
                      <div className="business-panel-qr-tools">
                        <div className="panel-qr-canvas-wrap">
                          <canvas
                            aria-label="Müşteri sipariş sayfası QR kodu"
                            className={`panel-qr-canvas ${
                              isQrReady ? "panel-qr-canvas-ready" : ""
                            }`}
                            ref={qrCanvasRef}
                            role="img"
                          />
                          {!isQrReady && !qrError ? (
                            <p className="panel-qr-status" aria-live="polite">
                              QR kod hazırlanıyor...
                            </p>
                          ) : null}
                        </div>

                        {qrError ? (
                          <p className="panel-qr-error" role="alert">{qrError}</p>
                        ) : null}

                        {customerOrderUrl ? (
                          <a
                            className="panel-qr-link"
                            href={customerOrderUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {customerOrderUrl}
                          </a>
                        ) : (
                          <p className="panel-qr-status">Sipariş bağlantısı hazırlanıyor...</p>
                        )}

                        <div className="panel-qr-actions panel-qr-screen-only">
                          <button
                            disabled={!customerOrderUrl}
                            type="button"
                            onClick={copyCustomerOrderLink}
                          >
                            Bağlantıyı Kopyala
                          </button>
                          <button
                            disabled={!isQrReady}
                            type="button"
                            onClick={downloadCustomerQrCode}
                          >
                            PNG İndir
                          </button>
                          <button
                            disabled={!isQrReady}
                            type="button"
                            onClick={printCustomerQrCode}
                          >
                            Yazdır
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="panel-qr-error">
                        QR kod için işletme bağlantısı bulunamadı.
                      </p>
                    )}
                  </div>
                </section>
              </section>
            ) : null}

            {activePanelSection === "orders" ? (
              <PanelOrders
                appliedDateFrom={appliedOrderDateFrom}
                appliedDateTo={appliedOrderDateTo}
                appliedSearch={appliedOrderSearch}
                conflictedOrderIds={conflictedOrderIds}
                dateFromDraft={orderDateFromDraft}
                dateToDraft={orderDateToDraft}
                expandedOrderId={expandedOrderId}
                formatDateTime={formatDateTime}
                formatPrice={formatPrice}
                getPaymentMethodLabel={getPaymentMethodDisplayLabel}
                isLoadingOrders={isLoadingOrders}
                orders={orders}
                ordersError={ordersError}
                orderMutationMessages={orderMutationMessages}
                pagination={orderPagination}
                pageSize={orderPageSize}
                orderPrintPaperWidth={orderPrintPaperWidth}
                orderStatusLabels={orderStatusLabels}
                orderStatusOptions={orderStatusOptions}
                searchDraft={orderSearchDraft}
                selectedOrderStatusFilter={selectedOrderStatusFilter}
                updatingOrderId={updatingOrderId}
                onApplyFilters={applyOrderFilters}
                onClearFilters={clearOrderFilters}
                onDateFromDraftChange={setOrderDateFromDraft}
                onDateToDraftChange={setOrderDateToDraft}
                onPageChange={changeOrderPage}
                onPageSizeChange={changeOrderPageSize}
                onRefreshOrders={refreshActiveOrders}
                onOrderPrintPaperWidthChange={setOrderPrintPaperWidth}
                onPrintOrder={printOrder}
                onSearchDraftChange={setOrderSearchDraft}
                onStatusFilterChange={changeOrderStatusFilter}
                onToggleOrderDetails={toggleOrderDetails}
                onUpdateOrderStatus={changeOrderStatus}
              />
            ) : null}

            {activePanelSection === "categories" ? (
              <section className="section panel-section business-panel-section business-panel-categories-section">
                <div className="business-panel-section-heading">
                  <div>
                    <span className="business-panel-section-kicker">Menü düzeni</span>
                    <h2>Kategoriler</h2>
                    <p>Ürünlerinizde kullanılan kategorilerin güncel görünümü.</p>
                  </div>
                </div>
                <p className="business-panel-category-note">
                  Kategoriler ürün kayıtlarından oluşur. Bir kategoriyi değiştirmek
                  için ilgili ürünü düzenleyin.
                </p>
                {categorySummaries.length === 0 ? (
                  <p className="empty-cart">Henüz kategori oluşturacak bir ürün yok.</p>
                ) : (
                  <div className="business-panel-category-list">
                    {categorySummaries.map((category) => (
                      <button
                        key={category.name}
                        type="button"
                        onClick={() => openCategoryProducts(category.name)}
                      >
                        <i><PanelIcon name="categories" size={18} /></i>
                        <span>
                          <strong>{category.name}</strong>
                          <small>{category.count} ürün</small>
                        </span>
                        <PanelIcon name="arrow" size={17} />
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {activePanelSection === "renewal" ? (
            <section
              className={`section panel-section renewal-section business-panel-section ${
                canManageProducts ? "" : "renewal-section-highlight"
              }`}
            >
              <div className="section-title">
                <h2>{canManageProducts ? "Üyeliği Yenile" : "Üyeliği Aktif Et"}</h2>
                <span>{subscriptionLabel}</span>
              </div>
              <p>
                Üyelik ödemesi manuel banka havalesi ile alınır. Ödeme sonrası destek
                hattından bilgi verdiğinizde abonelik admin panelinden manuel uzatılır.
              </p>
              {!canManageProducts ? (
                <p className="alert panel-warning">
                  Aboneliğiniz aktif değil. Ürün işlemleri kapalıdır; ödeme sonrası
                  admin tarafından tekrar aktif edilir.
                </p>
              ) : null}
              <button
                className="submit-button panel-secondary-action renewal-toggle"
                type="button"
                onClick={() => setShowRenewalInfo((current) => !current)}
              >
                {showRenewalInfo ? "Banka Bilgilerini Gizle" : "Banka Bilgilerini Göster"}
              </button>

              {showRenewalInfo ? (
                <div className="renewal-card">
                  <div className="renewal-row">
                    <strong>Banka adı:</strong>
                    <span>Garanti Bankası</span>
                  </div>
                  <div className="renewal-copy-row renewal-copy-row-compact">
                    <div>
                      <strong>Alıcı adı:</strong>
                      <span>{renewalRecipient}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyRenewalText("Alıcı adı", renewalRecipient)}
                    >
                      Kopyala
                    </button>
                  </div>
                  <div className="renewal-copy-row renewal-copy-row-featured">
                    <div>
                      <strong>IBAN</strong>
                      <span>{renewalIban}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyRenewalText("IBAN", renewalIban)}
                    >
                      Kopyala
                    </button>
                  </div>
                  <div className="renewal-copy-row renewal-copy-row-featured">
                    <div>
                      <strong>Ödeme açıklaması</strong>
                      <span>{renewalDescription}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        copyRenewalText("Ödeme açıklaması", renewalDescription)
                      }
                    >
                      Kopyala
                    </button>
                  </div>
                  <p className="renewal-note">
                    Ödeme yaptıktan sonra WhatsApp destek hattından bilgi veriniz.
                  </p>
                  <a
                    className="submit-button renewal-whatsapp"
                    href={renewalSupportWhatsapp}
                    rel="noreferrer"
                    target="_blank"
                  >
                    WhatsApp Destek: 0536 585 71 47
                  </a>
                </div>
              ) : null}
            </section>
            ) : null}

            {activePanelSection === "profile" ? (
            <section className="section panel-section business-panel-section">
              <div className="business-panel-section-heading">
                <div>
                  <span className="business-panel-section-kicker">İşletme ayarları</span>
                  <h2>İşletme Bilgileri</h2>
                </div>
                <button
                  className="business-panel-secondary-command"
                  type="button"
                  onClick={() => switchPanelSection("renewal")}
                >
                  {subscriptionLabel}
                </button>
              </div>

              <form className="customer-form panel-form" onSubmit={handleProfileSubmit}>
                <section className="business-panel-form-group">
                  <div className="business-panel-form-group-heading">
                    <h3>Temel Bilgiler</h3>
                    <p>İşletme adı, açıklaması ve sipariş iletişim numarası</p>
                  </div>
                <div className="field">
                  <label htmlFor="businessName">İşletme adı</label>
                  <input
                    disabled={isSavingProfile}
                    id="businessName"
                    value={profileForm.name}
                    onChange={(event) =>
                      updateProfileForm("name", event.target.value)
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="businessDescription">Açıklama</label>
                  <textarea
                    disabled={isSavingProfile}
                    id="businessDescription"
                    value={profileForm.description}
                    onChange={(event) =>
                      updateProfileForm("description", event.target.value)
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="businessWhatsapp">WhatsApp sipariş numarası</label>
                  <input
                    disabled={isSavingProfile}
                    id="businessWhatsapp"
                    inputMode="tel"
                    value={profileForm.whatsappOrderNumber}
                    onChange={(event) =>
                      updateProfileForm("whatsappOrderNumber", event.target.value)
                    }
                  />
                </div>
                </section>

                <section className="business-panel-form-group">
                  <div className="business-panel-form-group-heading">
                    <h3>Konum</h3>
                    <p>Müşterilere gösterilen adres ve servis alanı bilgileri</p>
                  </div>
                <fieldset
                  className="business-panel-location-selector"
                  disabled={isSavingProfile}
                >
                  <LocationSelector
                    idPrefix="businessProfileLocation"
                    required={false}
                    value={{
                      city: profileForm.city,
                      district: profileForm.district,
                      neighborhood: profileForm.neighborhood,
                    }}
                    onChange={(location) =>
                      setProfileForm((current) => ({
                        ...current,
                        city: location.city,
                        district: location.district,
                        neighborhood: location.neighborhood,
                      }))
                    }
                  />
                </fieldset>

                <div className="field">
                  <label htmlFor="businessAddress">Açık adres</label>
                  <textarea
                    disabled={isSavingProfile}
                    id="businessAddress"
                    value={profileForm.address}
                    onChange={(event) =>
                      updateProfileForm("address", event.target.value)
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="businessRadius">Servis yarıçapı (km)</label>
                  <input
                    disabled={isSavingProfile}
                    id="businessRadius"
                    inputMode="decimal"
                    min="0"
                    step="0.1"
                    type="number"
                    value={profileForm.serviceRadiusKm}
                    onChange={(event) =>
                      updateProfileForm("serviceRadiusKm", event.target.value)
                    }
                  />
                </div>
                </section>

                <section className="business-panel-form-group">
                  <div className="business-panel-form-group-heading">
                    <h3>Sipariş Kuralları</h3>
                    <p>Müşteri sipariş sayfasında kullanılan çalışma ayarları</p>
                  </div>
                <div className="field">
                  <label htmlFor="businessDeliveryStatus">Teslimat / Gel-al Bilgisi</label>
                  <input
                    disabled={isSavingProfile}
                    id="businessDeliveryStatus"
                    maxLength={120}
                    placeholder="Örn: Paket servis ve gel-al mevcut"
                    value={profileForm.deliveryStatus}
                    onChange={(event) =>
                      updateProfileForm("deliveryStatus", event.target.value)
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="businessPaymentMethodMode">
                    Ödeme kabul yöntemi
                  </label>
                  <select
                    disabled={isSavingProfile}
                    id="businessPaymentMethodMode"
                    required
                    value={profileForm.paymentMethodMode}
                    onChange={(event) => {
                      if (isPaymentMethodMode(event.target.value)) {
                        updateProfileForm("paymentMethodMode", event.target.value);
                      }
                    }}
                  >
                    {PAYMENT_METHOD_MODES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="field-help">
                    Kart seçeneği, teslimatta veya gel-al sırasında fiziksel POS
                    cihazıyla ödeme anlamına gelir. Online ödeme alınmaz.
                  </span>
                </div>

                <div className="field">
                  <label htmlFor="businessMinimumOrder">
                    Minimum Sipariş Tutarı (TL)
                  </label>
                  <input
                    disabled={isSavingProfile}
                    id="businessMinimumOrder"
                    inputMode="decimal"
                    min="0"
                    placeholder="Örn: 150"
                    step="0.01"
                    type="number"
                    value={profileForm.minimumOrderAmount}
                    onChange={(event) =>
                      updateProfileForm("minimumOrderAmount", event.target.value)
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="businessPreparationTime">
                    Tahmini Hazırlık Süresi (dakika)
                  </label>
                  <input
                    disabled={isSavingProfile}
                    id="businessPreparationTime"
                    inputMode="numeric"
                    max="720"
                    min="1"
                    placeholder="Örn: 20"
                    step="1"
                    type="number"
                    value={profileForm.preparationTimeMinutes}
                    onChange={(event) =>
                      updateProfileForm("preparationTimeMinutes", event.target.value)
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="businessIsOpen">Sipariş Durumu</label>
                  <select
                    disabled={isSavingProfile}
                    id="businessIsOpen"
                    value={profileForm.isOpen ? "open" : "closed"}
                    onChange={(event) =>
                      updateProfileForm("isOpen", event.target.value === "open")
                    }
                  >
                    <option value="open">Açık</option>
                    <option value="closed">Kapalı</option>
                  </select>
                  <span className="field-help">
                    Bu ayar abonelik veya sistem aktifliğini değiştirmez.
                  </span>
                </div>

                <div className="field">
                  <label htmlFor="businessOrderNote">Kısa Sipariş Notu</label>
                  <textarea
                    disabled={isSavingProfile}
                    id="businessOrderNote"
                    maxLength={300}
                    placeholder="Örn: Yoğun saatlerde hazırlık süresi uzayabilir."
                    value={profileForm.orderNote}
                    onChange={(event) =>
                      updateProfileForm("orderNote", event.target.value)
                    }
                  />
                  <span className="field-help">
                    {profileForm.orderNote.trim().length}/300 karakter
                  </span>
                </div>
                </section>

                <section className="business-panel-form-group">
                  <div className="business-panel-form-group-heading">
                    <h3>Görseller</h3>
                    <p>İşletme logosu ve müşteri sayfası kapak görseli</p>
                  </div>
                <div className="field">
                  <label htmlFor="businessLogoUrl">Logo URL</label>
                  {profileForm.logoUrl ? (
                    <img
                      alt="İşletme logosu"
                      className="business-logo-preview"
                      src={profileForm.logoUrl}
                    />
                  ) : null}
                  <input
                    disabled={isSavingBusinessProfile}
                    id="businessLogoUrl"
                    value={profileForm.logoUrl}
                    onChange={(event) =>
                      updateProfileForm("logoUrl", event.target.value)
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="businessLogoFile">Logo görseli yükle</label>
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    disabled={isSavingBusinessProfile}
                    id="businessLogoFile"
                    ref={logoInputRef}
                    type="file"
                    onChange={(event) => {
                      setError("");
                      setMessage("");
                      setSelectedLogoFile(event.target.files?.[0] ?? null);
                    }}
                  />
                  {selectedLogoFile ? (
                    <span className="field-help">{selectedLogoFile.name}</span>
                  ) : (
                    <span className="field-help">JPG, PNG veya WEBP logo seçin.</span>
                  )}
                </div>

                <div className="field">
                  <label htmlFor="businessCoverUrl">Kapak görseli URL</label>
                  {profileForm.coverImageUrl ? (
                    <img
                      alt="İşletme kapak görseli"
                      className="business-cover-preview"
                      src={profileForm.coverImageUrl}
                    />
                  ) : null}
                  <input
                    disabled={isSavingBusinessProfile}
                    id="businessCoverUrl"
                    value={profileForm.coverImageUrl}
                    onChange={(event) =>
                      updateProfileForm("coverImageUrl", event.target.value)
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="businessCoverFile">Kapak görseli yükle</label>
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    disabled={isSavingBusinessProfile}
                    id="businessCoverFile"
                    ref={coverInputRef}
                    type="file"
                    onChange={(event) => {
                      setError("");
                      setMessage("");
                      setSelectedCoverFile(event.target.files?.[0] ?? null);
                    }}
                  />
                  {selectedCoverFile ? (
                    <span className="field-help">{selectedCoverFile.name}</span>
                  ) : (
                    <span className="field-help">JPG, PNG veya WEBP kapak görseli seçin.</span>
                  )}
                </div>
                </section>

                <div className="business-panel-save-bar">
                {profileUploadStatus ? (
                  <p className="alert success panel-upload-status">
                    {profileUploadStatus}
                  </p>
                ) : null}

                <button
                  className="submit-button panel-primary-action"
                  disabled={isSavingBusinessProfile}
                  type="submit"
                >
                  {profileUploadStatus
                    ? profileUploadStatus
                    : isSavingProfile
                    ? "Kaydediliyor..."
                    : "İşletme Bilgilerini Kaydet"}
                </button>
                </div>
              </form>
            </section>
            ) : null}

            {(activePanelSection === "create" ||
              activePanelSection === "products") ? (
            <div
              className={`layout panel-layout ${
                activePanelSection === "create" ? "business-panel-create-layout" : ""
              }`}
            >
            {productOperationError ? (
              <div
                className="alert panel-product-mutation-message"
                role="alert"
              >
                <p>{productOperationError}</p>
                <button
                  disabled={isSaving || isUploadingImage}
                  type="button"
                  onClick={() => {
                    void refreshProducts({ replaceEditingForm: true });
                  }}
                >
                  Güncel Bilgileri Yükle
                </button>
              </div>
            ) : null}
            {(activePanelSection === "create" || editingProductId) ? (
            <section className="section panel-section business-panel-section">
              <div className="business-panel-section-heading">
                <div>
                  <span className="business-panel-section-kicker">
                    {editingProductId ? "Ürün düzenleme" : "Yeni kayıt"}
                  </span>
                  <h2>{editingProductId ? "Ürünü Düzenle" : "Yeni Ürün Ekle"}</h2>
                </div>
                {activePanelSection === "create" ? (
                  <button
                    className="business-panel-secondary-command"
                    type="button"
                    onClick={() => switchPanelSection("products")}
                  >
                    Ürün listesine dön
                  </button>
                ) : null}
              </div>

              {!canManageProducts ? (
                <p className="alert panel-warning">
                  Aboneliğiniz aktif değil. Ürün ekleme ve düzenleme işlemleri
                  kapalıdır.
                </p>
              ) : null}

              <form
                aria-busy={isSaving || isUploadingImage}
                className="customer-form panel-form business-panel-product-form"
                onSubmit={handleSubmit}
              >
                <div className="field">
                  <label htmlFor="name">Ürün adı</label>
                  <input
                    disabled={!canManageProducts || isSaving || isUploadingImage || isEditingProductConflicted}
                    id="name"
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="price">Fiyat</label>
                  <input
                    disabled={!canManageProducts || isSaving || isUploadingImage || isEditingProductConflicted}
                    id="price"
                    inputMode="decimal"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={(event) => updateForm("price", event.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="category">Kategori</label>
                  <select
                    disabled={!canManageProducts || isSaving || isUploadingImage || isEditingProductConflicted}
                    id="category"
                    value={form.category}
                    onChange={(event) =>
                      changeProductCategory(event.target.value)
                    }
                  >
                    {form.category ? null : (
                      <option value="">Standart kategori seçin</option>
                    )}
                    {getProductCategories().map((category) => (
                      <option key={category.key} value={category.label}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                  {editingProductId &&
                  originalProductCategory.trim() &&
                  !isStandardProductCategory(originalProductCategory) ? (
                    <>
                      <span className="field-help">
                        Mevcut kategori: {originalProductCategory}
                      </span>
                      {isProductCategoryChanged ? (
                        <button
                          className="panel-category-chip"
                          disabled={isSaving || isUploadingImage || isEditingProductConflicted}
                          type="button"
                          onClick={keepOriginalProductCategory}
                        >
                          Mevcut kategoriyi koru
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>

                <div className="field business-panel-form-wide">
                  <label htmlFor="description">Açıklama</label>
                  <textarea
                    disabled={!canManageProducts || isSaving || isUploadingImage || isEditingProductConflicted}
                    id="description"
                    value={form.description}
                    onChange={(event) =>
                      updateForm("description", event.target.value)
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="imageLabel">Görsel etiketi</label>
                  <input
                    disabled={!canManageProducts || isSaving || isUploadingImage || isEditingProductConflicted}
                    id="imageLabel"
                    value={form.imageLabel}
                    onChange={(event) =>
                      updateForm("imageLabel", event.target.value)
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="imageUrl">Görsel URL</label>
                  <input
                    disabled={!canManageProducts || isSaving || isUploadingImage || isEditingProductConflicted}
                    id="imageUrl"
                    value={form.imageUrl}
                    onChange={(event) => updateForm("imageUrl", event.target.value)}
                  />
                </div>

                <div className="field business-panel-form-wide business-panel-image-field">
                  <label htmlFor="imageFile">Ürün görseli yükle</label>
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    disabled={!canManageProducts || isSaving || isUploadingImage || isEditingProductConflicted}
                    id="imageFile"
                    ref={imageInputRef}
                    type="file"
                    onChange={(event) => {
                      setError("");
                      setMessage("");
                      setSelectedImageFile(event.target.files?.[0] ?? null);
                    }}
                  />
                  {selectedImageFile ? (
                    <span className="field-help">{selectedImageFile.name}</span>
                  ) : (
                    <span className="field-help">JPG, PNG veya WEBP dosyası seçin.</span>
                  )}
                </div>

                <div className="field">
                  <label htmlFor="sortOrder">Sıralama</label>
                  <input
                    disabled={!canManageProducts || isSaving || isUploadingImage || isEditingProductConflicted}
                    id="sortOrder"
                    inputMode="numeric"
                    min="0"
                    type="number"
                    value={form.sortOrder}
                    onChange={(event) =>
                      updateForm("sortOrder", event.target.value)
                    }
                  />
                </div>

                <label className="field business-panel-sale-status">
                  <span>Satış Durumu</span>
                  <span className="business-panel-switch-row">
                    <input
                      checked={form.isActive}
                      disabled={!canManageProducts || isSaving || isUploadingImage || isEditingProductConflicted}
                      type="checkbox"
                      onChange={(event) =>
                        updateForm("isActive", event.target.checked)
                      }
                    />
                    <strong>{form.isActive ? "Satışta" : "Satış Dışı"}</strong>
                  </span>
                </label>

                <div className="business-panel-form-actions">
                  <button
                    className="submit-button panel-secondary-action"
                    disabled={isSaving || isUploadingImage}
                    type="button"
                    onClick={() => {
                      resetForm();
                      if (activePanelSection === "create") {
                        switchPanelSection("products");
                      }
                    }}
                  >
                    Vazgeç
                  </button>
                  <button
                    className="submit-button panel-primary-action"
                    disabled={!canManageProducts || isSaving || isUploadingImage || isEditingProductConflicted}
                    type="submit"
                  >
                    {isUploadingImage
                      ? "Görsel yükleniyor..."
                      : isSaving
                      ? "Kaydediliyor..."
                      : editingProductId
                        ? "Ürünü Güncelle"
                        : "Ürünü Kaydet"}
                  </button>
                </div>
              </form>
            </section>
            ) : null}

            {activePanelSection === "products" ? (
            <section className="section panel-section business-panel-section">
              <div className="business-panel-section-heading">
                <div>
                  <span className="business-panel-section-kicker">Menü yönetimi</span>
                  <h2>Ürünler</h2>
                  <small>
                    {filteredProducts.length} / {products.length} kayıt
                  </small>
                </div>
                <button
                  className="business-panel-primary-command"
                  disabled={!canManageProducts}
                  type="button"
                  onClick={() => switchPanelSection("create")}
                >
                  Yeni Ürün Ekle
                </button>
              </div>

              <label className="business-panel-product-search">
                <span>Ürün ara</span>
                <input
                  placeholder="Ürün adına göre ara"
                  type="search"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                />
              </label>

              {categorySummaries.length > 0 ? (
                <div className="panel-category-filter" aria-label="Kategori filtresi">
                  <button
                    className={`panel-category-chip ${
                      selectedCategoryFilter === "Tüm ürünler" ? "selected" : ""
                    }`}
                    type="button"
                    onClick={() => setSelectedCategoryFilter("Tüm ürünler")}
                  >
                    Tüm ürünler ({products.length})
                  </button>
                  {categorySummaries.map((category) => (
                    <button
                      className={`panel-category-chip ${
                        selectedCategoryFilter === category.name ? "selected" : ""
                      }`}
                      key={category.name}
                      type="button"
                      onClick={() => setSelectedCategoryFilter(category.name)}
                    >
                      {category.name} ({category.count})
                    </button>
                  ))}
                </div>
              ) : null}

              {isProductOrderingFiltered ? (
                <p className="business-panel-inline-state">
                  Ürün sıralamak için arama ve kategori filtresini temizleyin.
                </p>
              ) : null}

              <div className="cart panel-product-list">
                {products.length === 0 ? (
                  <p className="empty-cart">Henüz ürün yok.</p>
                ) : filteredProducts.length === 0 ? (
                  <p className="empty-cart">Bu kategoride ürün yok.</p>
                ) : (
                  filteredProducts.map((product, index) => {
                    const isExpanded = expandedProductId === product.id;
                    const hasProductConflict = conflictedProductIds.has(product.id);

                    return (
                      <article
                        className={`cart-item panel-product-card panel-compact-card ${
                          isExpanded ? "expanded" : ""
                        }`}
                        key={product.id}
                      >
                        <button
                          aria-expanded={isExpanded}
                          className="panel-compact-row"
                          type="button"
                          onClick={() => toggleProductDetails(product.id)}
                        >
                          {product.imageUrl ? (
                            <img
                              alt={product.name}
                              className="panel-product-thumb panel-compact-thumb"
                              src={product.imageUrl}
                            />
                          ) : (
                            <span className="panel-compact-thumb panel-compact-thumb-empty">
                              Görsel
                            </span>
                          )}
                          <span className="panel-compact-main">
                            <strong>{product.name}</strong>
                            <span>{getProductCategory(product)}</span>
                          </span>
                          <span className="panel-compact-meta">
                            <strong>{formatPrice(product.price)}</strong>
                            <span
                              className={`panel-product-status ${
                                product.isActive ? "active" : "passive"
                              }`}
                            >
                              {product.isActive ? "Satışta" : "Satış Dışı"}
                            </span>
                          </span>
                          <span className="panel-compact-toggle">
                            {isExpanded ? "Kapat" : "Detay"}
                          </span>
                        </button>

                        {isExpanded ? (
                          <div className="panel-compact-detail">
                            <p>{product.description || "Açıklama yok."}</p>
                            <div className="info-grid">
                              <p>
                                <strong>Kategori</strong>
                                <span className="panel-category-badge">
                                  {getProductCategory(product)}
                                </span>
                              </p>
                              <p>
                                <strong>Durum</strong>
                                <span>{product.isActive ? "Satışta" : "Satış Dışı"}</span>
                              </p>
                              <p>
                                <strong>Sıra</strong>
                                <span>{index + 1}</span>
                              </p>
                            </div>
                            <div className="admin-actions panel-product-actions">
                              <button
                                disabled={
                                  !canManageProducts ||
                                  isSaving ||
                                  hasAnyProductConflict ||
                                  isProductOrderingFiltered ||
                                  index === 0
                                }
                                aria-label={`${product.name} ürününü yukarı taşı`}
                                type="button"
                                onClick={() => moveProduct(product, "up")}
                              >
                                Yukarı Taşı
                              </button>
                              <button
                                disabled={
                                  !canManageProducts ||
                                  isSaving ||
                                  hasAnyProductConflict ||
                                  isProductOrderingFiltered ||
                                  index === filteredProducts.length - 1
                                }
                                aria-label={`${product.name} ürününü aşağı taşı`}
                                type="button"
                                onClick={() => moveProduct(product, "down")}
                              >
                                Aşağı Taşı
                              </button>
                              <button
                                aria-label={`${product.name} ürününü düzenle`}
                                disabled={!canManageProducts || isSaving || hasProductConflict}
                                type="button"
                                onClick={() => startEdit(product)}
                              >
                                Düzenle
                              </button>
                              <button
                                aria-label={`${product.name} ürününü ${product.isActive ? "pasife al" : "aktif et"}`}
                                disabled={!canManageProducts || isSaving || hasProductConflict}
                                type="button"
                                onClick={() => toggleProduct(product)}
                              >
                                {product.isActive ? "Pasife Al" : "Aktif Et"}
                              </button>
                              <button
                                className="danger-button"
                                aria-label={`${product.name} ürününü sil`}
                                disabled={!canManageProducts || isSaving || hasProductConflict}
                                type="button"
                                onClick={() => removeProduct(product)}
                              >
                                Sil
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                )}
              </div>
            </section>
            ) : null}
            </div>
            ) : null}
            </div>
          </div>
        )}
      </div>

      <nav className="business-panel-mobile-nav" aria-label="Mobil panel navigasyonu">
        <button
          aria-current={activePanelSection === "overview" ? "page" : undefined}
          className={activePanelSection === "overview" ? "active" : ""}
          type="button"
          onClick={() => switchPanelSection("overview")}
        >
          <PanelIcon name="home" size={20} />
          <span>Genel</span>
        </button>
        <button
          aria-current={activePanelSection === "orders" ? "page" : undefined}
          className={activePanelSection === "orders" ? "active" : ""}
          type="button"
          onClick={() => switchPanelSection("orders")}
        >
          <PanelIcon name="orders" size={20} />
          <span>Siparişler</span>
          {newOrderCount > 0 ? (
            <small className="business-panel-mobile-badge">{newOrderCount}</small>
          ) : null}
        </button>
        <button
          aria-current={
            activePanelSection === "products" || activePanelSection === "create"
              ? "page"
              : undefined
          }
          className={
            activePanelSection === "products" || activePanelSection === "create"
              ? "active"
              : ""
          }
          type="button"
          onClick={() => switchPanelSection("products")}
        >
          <PanelIcon name="package" size={20} />
          <span>Ürünler</span>
        </button>
        <button
          aria-expanded={isMobileMenuOpen}
          className={
            isMobileMenuOpen ||
            ["categories", "profile", "qr", "renewal"].includes(activePanelSection)
              ? "active"
              : ""
          }
          type="button"
          onClick={openMobileMenu}
        >
          <PanelIcon name="menu" size={20} />
          <span>Menü</span>
        </button>
      </nav>

      {isMobileMenuOpen ? (
        <div
          className="business-panel-mobile-menu-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsMobileMenuOpen(false);
          }}
        >
          <aside
            aria-label="Panel menüsü"
            aria-modal="true"
            className="business-panel-mobile-menu"
            ref={mobileMenuDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="business-panel-mobile-menu-head">
              <div>
                <span>İşletme Paneli</span>
                <strong>{business?.name}</strong>
              </div>
              <button
                aria-label="Menüyü kapat"
                ref={mobileMenuCloseRef}
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <PanelIcon name="close" size={21} />
              </button>
            </div>
            <nav aria-label="İkincil panel bölümleri">
              <button type="button" onClick={() => switchPanelSection("categories")}>
                <PanelIcon name="categories" />
                <span>Kategoriler</span>
                <PanelIcon name="arrow" size={17} />
              </button>
              <button type="button" onClick={() => switchPanelSection("profile")}>
                <PanelIcon name="store" />
                <span>İşletme Bilgileri</span>
                <PanelIcon name="arrow" size={17} />
              </button>
              <button type="button" onClick={() => switchPanelSection("qr")}>
                <PanelIcon name="qr" />
                <span>QR Kod</span>
                <PanelIcon name="arrow" size={17} />
              </button>
              <button type="button" onClick={() => switchPanelSection("renewal")}>
                <PanelIcon name="subscription" />
                <span>Abonelik</span>
                <PanelIcon name="arrow" size={17} />
              </button>
            </nav>
            <button className="business-panel-mobile-logout" type="button" onClick={logout}>
              <PanelIcon name="logout" />
              Çıkış Yap
            </button>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
