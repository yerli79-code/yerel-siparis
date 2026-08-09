"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import LocationSelector from "../../components/LocationSelector";
import PlatformBrand from "../../components/PlatformBrand";
import OrderPrintReceipt from "./OrderPrintReceipt";
import PanelOrders from "./PanelOrders";
import styles from "./panel.module.css";
import {
  createOrderPrintReceiptModel,
  orderStatusLabels,
  type OrderPrintPaperWidth,
} from "./order-print";
import { runPanelPrint } from "./print-lifecycle";
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
  type BusinessProfileInput,
  type ProductInput,
} from "../../lib/supabase-business";
import {
  businessOrdersLoadErrorMessage,
  fetchBusinessOrders,
  fetchBusinessOrdersPage,
  updateBusinessOrderStatus,
  type BusinessOrder,
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
  | "profile"
  | "renewal";

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
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [isLoadingOverviewOrders, setIsLoadingOverviewOrders] = useState(false);
  const [overviewOrdersError, setOverviewOrdersError] = useState("");
  const [dashboardSummary, setDashboardSummary] =
    useState<BusinessDashboardSummary | null>(null);
  const [dashboardSummaryLoading, setDashboardSummaryLoading] = useState(true);
  const [dashboardSummaryError, setDashboardSummaryError] = useState("");
  const [updatingOrderId, setUpdatingOrderId] = useState("");
  const [showRenewalInfo, setShowRenewalInfo] = useState(false);
  const [customerOrderUrl, setCustomerOrderUrl] = useState("");
  const [qrError, setQrError] = useState("");
  const [isQrReady, setIsQrReady] = useState(false);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [selectedCoverFile, setSelectedCoverFile] = useState<File | null>(null);
  const [activePanelSection, setActivePanelSection] =
    useState<PanelSection>("overview");
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

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

  const canManageProducts = useMemo(
    () => (business ? isBusinessSubscriptionActive(business) : false),
    [business],
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
  const expandedOrder =
    activePanelSection === "orders"
      ? orders.find((order) => order.id === expandedOrderId)
      : undefined;
  const orderPrintReceipt =
    business && expandedOrder
      ? createOrderPrintReceiptModel({
          business: {
            name: business.name,
            address: business.address,
            whatsappOrderNumber: business.whatsappOrderNumber,
          },
          order: expandedOrder,
          paperWidth: orderPrintPaperWidth,
        })
      : null;

  useEffect(() => {
    let isCancelled = false;

    async function loadPanel() {
      try {
        const token = await getFreshAccessToken();
        if (!token || isCancelled) return;

        const foundBusiness = await getCurrentUserBusiness(token);
        if (!foundBusiness) {
          setBusiness(null);
          setProducts([]);
          setError("Giriş yapan kullanıcıya ait işletme bulunamadı.");
          return;
        }

        setBusiness(foundBusiness);
        setProfileForm(toProfileForm(foundBusiness));
        const foundProducts = await fetchProductsByBusinessId(
          foundBusiness.id,
          token,
        );
        setProducts(foundProducts);
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

    if (isLoading || activePanelSection !== "overview") {
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

  async function refreshProducts() {
    if (!business) return;
    const token = await getFreshAccessToken();
    if (!token) return;
    const freshProducts = await fetchProductsByBusinessId(business.id, token);
    setProducts(freshProducts);
  }

  async function refreshOrders(query: BusinessOrderPageQuery) {
    const token = await getFreshAccessToken();
    if (!token) return;

    setIsLoadingOrders(true);
    setOrdersError("");
    try {
      let result = await fetchBusinessOrdersPage(token, query);

      if (
        result.orders.length === 0 &&
        result.pagination.total > 0 &&
        query.page > result.pagination.totalPages
      ) {
        result = await fetchBusinessOrdersPage(token, {
          ...query,
          page: result.pagination.totalPages,
        });
      }

      setOrders(result.orders);
      setOrderPage(result.pagination.page);
      setOrderPagination(result.pagination);
      setExpandedOrderId((currentOrderId) =>
        result.orders.some((order) => order.id === currentOrderId)
          ? currentOrderId
          : "",
      );
      setOrdersError("");
    } catch {
      setOrdersError(businessOrdersLoadErrorMessage);
    } finally {
      setIsLoadingOrders(false);
    }
  }

  async function changeOrderStatus(orderId: string, status: OrderStatus) {
    const token = await getFreshAccessToken();
    if (!token) return;

    setUpdatingOrderId(orderId);
    setError("");
    setMessage("");
    try {
      const updatedOrder = await updateBusinessOrderStatus(orderId, status, token);
      setOverviewOrders((current) =>
        current.map((order) => (order.id === updatedOrder.id ? updatedOrder : order)),
      );
      setMessage("Sipariş durumu güncellendi.");
      void refreshDashboardSummary();
      await refreshOrders(activeOrderQuery);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Sipariş durumu güncellenirken bir hata oluştu.",
      );
    } finally {
      setUpdatingOrderId("");
    }
  }

  function changeOrderStatusFilter(statusFilter: OrderStatus | "all") {
    if (isLoadingOrders) return;

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
    if (isLoadingOrders) return;

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
    if (isLoadingOrders) return;

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
    if (isLoadingOrders || ![10, 20, 50].includes(pageSize)) return;

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
    if (isLoadingOrders) return;
    void refreshOrders(activeOrderQuery);
  }

  function toggleOrderDetails(orderId: string) {
    setExpandedOrderId((currentOrderId) =>
      currentOrderId === orderId ? "" : orderId,
    );
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
    if (!isQrReady) return;
    runPanelPrint({ target: "customer-qr" });
  }

  function printOrder(orderId: string) {
    if (
      activePanelSection !== "orders" ||
      expandedOrderId !== orderId ||
      expandedOrder?.id !== orderId ||
      !orderPrintReceipt ||
      updatingOrderId === orderId
    ) {
      return;
    }

    runPanelPrint({
      target: "order-receipt",
      orderPaperWidth: orderPrintPaperWidth,
    });
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

    if (!business) {
      setError("İşletme oturumu bulunamadı.");
      return;
    }

    const token = await getFreshAccessToken();
    if (!token) return;

    if (!canManageProducts) {
      setError("Aboneliğiniz aktif olmadığı için ürün işlemi yapamazsınız.");
      return;
    }

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    let productFailureMessage =
      "Ürün kaydedilemedi. Lütfen tekrar deneyin.";

    try {
      const payload = toProductInput(
        form,
        editingProductId ? 0 : getNextSortOrder(products),
      );
      const hasUntouchedLegacyCategory =
        Boolean(editingProductId) &&
        Boolean(originalProductCategory.trim()) &&
        !isStandardProductCategory(originalProductCategory) &&
        !isProductCategoryChanged;
      if (hasUntouchedLegacyCategory) {
        delete payload.category;
      }
      if (selectedImageFile) {
        productFailureMessage = "Görsel yüklenemedi. Lütfen tekrar deneyin.";
        setIsUploadingImage(true);
        const uploadedImageUrl = await uploadProductImage(
          business.id,
          selectedImageFile,
          token,
        );
        payload.imageUrl = uploadedImageUrl;
        setForm((current) => ({ ...current, imageUrl: uploadedImageUrl }));
        productFailureMessage = "Ürün kaydedilemedi. Lütfen tekrar deneyin.";
      }
      if (editingProductId) {
        await updateProduct(editingProductId, payload, token);
        setMessage("Ürün güncellendi.");
      } else {
        const createdProduct = await createProduct(payload, token);
        setSelectedCategoryFilter(getProductCategory(createdProduct));
        setMessage("Ürün eklendi.");
      }
      resetForm();
      await refreshProducts();
    } catch {
      setError(productFailureMessage);
    } finally {
      setIsUploadingImage(false);
      setIsSaving(false);
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
    if (!window.confirm(`${product.name} silinsin mi?`)) return;

    setIsSaving(true);
    setError("");
    setMessage("");

    try {
      const token = await getFreshAccessToken();
      if (!token) return;

      await deleteProduct(product.id, token);
      setMessage("Ürün silindi.");
      if (editingProductId === product.id) resetForm();
      if (expandedProductId === product.id) setExpandedProductId("");
      await refreshProducts();
    } catch {
      setError("Ürün silinirken bir hata oluştu.");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleProduct(product: BusinessProduct) {
    if (!canManageProducts) return;

    setIsSaving(true);
    setError("");
    setMessage("");

    try {
      const token = await getFreshAccessToken();
      if (!token) return;

      await setProductActiveStatus(product.id, !product.isActive, token);
      setMessage(product.isActive ? "Ürün pasife alındı." : "Ürün aktif edildi.");
      await refreshProducts();
    } catch {
      setError("Ürün durumu güncellenirken bir hata oluştu.");
    } finally {
      setIsSaving(false);
    }
  }

  async function moveProduct(product: BusinessProduct, direction: "up" | "down") {
    if (!canManageProducts) return;

    const currentIndex = filteredProducts.findIndex((item) => item.id === product.id);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= filteredProducts.length) {
      return;
    }

    const orderSlots = filteredProducts.map((item) => {
      const globalIndex = sortedProducts.findIndex(
        (sortedProduct) => sortedProduct.id === item.id,
      );
      return globalIndex >= 0 ? globalIndex + 1 : item.sortOrder;
    });
    const reorderedProducts = [...filteredProducts];
    const movedProduct = reorderedProducts[currentIndex];
    reorderedProducts[currentIndex] = reorderedProducts[targetIndex];
    reorderedProducts[targetIndex] = movedProduct;

    setIsSaving(true);
    setError("");
    setMessage("");

    try {
      const token = await getFreshAccessToken();
      if (!token) return;

      await reorderProducts(
        reorderedProducts.map((item, index) => ({
          productId: item.id,
          sortOrder: orderSlots[index],
        })),
        token,
      );
      setMessage(
        direction === "up" ? "Ürün yukarı taşındı." : "Ürün aşağı taşındı.",
      );
      await refreshProducts();
    } catch {
      setError("Ürün sırası güncellenirken bir hata oluştu.");
    } finally {
      setIsSaving(false);
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
          <div className="business-panel-header-copy">
            <PlatformBrand className="panel-platform-brand" publicVariant />
            <span className="business-panel-eyebrow">İşletme Paneli</span>
            <h1>{business?.name ?? "İşletme bulunamadı"}</h1>
            <p>Günlük siparişlerinizi ve işletmenizi tek ekrandan yönetin.</p>
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
              <span
                className={`business-panel-status-chip ${
                  canManageProducts ? "active" : "inactive"
                }`}
              >
                {subscriptionLabel}
              </span>
            </div>
          ) : null}
          <button className="business-panel-logout" type="button" onClick={logout}>
            Çıkış Yap
          </button>
        </header>

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
            <nav className="business-panel-nav" aria-label="Panel bölümleri">
              <button
                className={activePanelSection === "overview" ? "active" : ""}
                type="button"
                onClick={() => switchPanelSection("overview")}
              >
                <span className="business-panel-nav-short">Genel</span>
                <span className="business-panel-nav-long">Genel Bakış</span>
              </button>
              <button
                className={activePanelSection === "orders" ? "active" : ""}
                type="button"
                onClick={() => switchPanelSection("orders")}
              >
                Siparişler
                {newOrderCount > 0 ? (
                  <span className="business-panel-nav-badge">{newOrderCount}</span>
                ) : null}
              </button>
              <button
                className={
                  activePanelSection === "products" || activePanelSection === "create"
                    ? "active"
                    : ""
                }
                type="button"
                onClick={() => switchPanelSection("products")}
              >
                Ürünler
              </button>
              <button
                className={
                  activePanelSection === "profile" || activePanelSection === "renewal"
                    ? "active"
                    : ""
                }
                type="button"
                onClick={() => switchPanelSection("profile")}
              >
                İşletme
              </button>
            </nav>
              <div className="business-panel-sidebar-membership">
                <span>Üyelik durumu</span>
                <strong>{subscriptionLabel}</strong>
                <button type="button" onClick={() => switchPanelSection("renewal")}>
                  Üyelik ayrıntıları
                </button>
              </div>
            </aside>

            <div className="business-panel-content">

            {activePanelSection === "overview" ? (
              <section className="section panel-section panel-overview-section business-panel-section">
                <div className="business-panel-section-heading">
                  <div>
                    <span className="business-panel-section-kicker">Bugünün görünümü</span>
                    <h2>Genel Bakış</h2>
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
                      <span>Bugünkü sipariş</span>
                      <strong>{dashboardSummary?.orders.total ?? "—"}</strong>
                      <small>İptaller dahil</small>
                    </div>
                    <div className="business-panel-operation-card">
                      <span>Bekleyen sipariş</span>
                      <strong>{dashboardSummary?.orders.pending ?? "—"}</strong>
                      <small>Yeni, hazırlanıyor ve hazır</small>
                    </div>
                    <div className="business-panel-operation-card">
                      <span>Tamamlanan sipariş</span>
                      <strong>{dashboardSummary?.orders.delivered ?? "—"}</strong>
                      <small>Teslim edilen</small>
                    </div>
                    <div className="business-panel-operation-card">
                      <span>Günlük ciro</span>
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
                            <small>
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

                <div className="business-panel-quick-actions">
                  <button type="button" onClick={() => switchPanelSection("create")}>
                    <strong>Yeni Ürün Ekle</strong>
                    <span>Menüye yeni bir ürün ekleyin</span>
                  </button>
                  <button type="button" onClick={() => openOrdersFromOverview()}>
                    <strong>Siparişlere Git</strong>
                    <span>Yeni ve devam eden siparişleri yönetin</span>
                  </button>
                  <button type="button" onClick={() => switchPanelSection("profile")}>
                    <strong>İşletme Bilgileri</strong>
                    <span>Profil ve sipariş ayarlarını düzenleyin</span>
                  </button>
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
                        QR kodu masanızda veya paketlerinizde kullanarak müşterileri
                        doğrudan sipariş sayfanıza yönlendirin.
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
                          <p className="panel-qr-error" role="alert">
                            {qrError}
                          </p>
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
                          <p className="panel-qr-status">
                            Sipariş bağlantısı hazırlanıyor...
                          </p>
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

            {activePanelSection === "orders" ? (
              <PanelOrders
                appliedDateFrom={appliedOrderDateFrom}
                appliedDateTo={appliedOrderDateTo}
                appliedSearch={appliedOrderSearch}
                dateFromDraft={orderDateFromDraft}
                dateToDraft={orderDateToDraft}
                expandedOrderId={expandedOrderId}
                formatDateTime={formatDateTime}
                formatPrice={formatPrice}
                getPaymentMethodLabel={getPaymentMethodDisplayLabel}
                isLoadingOrders={isLoadingOrders}
                orders={orders}
                ordersError={ordersError}
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

              <form className="customer-form panel-form" onSubmit={handleSubmit}>
                <div className="field">
                  <label htmlFor="name">Ürün adı</label>
                  <input
                    disabled={!canManageProducts || isSaving || isUploadingImage}
                    id="name"
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="price">Fiyat</label>
                  <input
                    disabled={!canManageProducts || isSaving || isUploadingImage}
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
                    disabled={!canManageProducts || isSaving || isUploadingImage}
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
                          disabled={isSaving || isUploadingImage}
                          type="button"
                          onClick={keepOriginalProductCategory}
                        >
                          Mevcut kategoriyi koru
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>

                <div className="field">
                  <label htmlFor="description">Açıklama</label>
                  <textarea
                    disabled={!canManageProducts || isSaving || isUploadingImage}
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
                    disabled={!canManageProducts || isSaving || isUploadingImage}
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
                    disabled={!canManageProducts || isSaving || isUploadingImage}
                    id="imageUrl"
                    value={form.imageUrl}
                    onChange={(event) => updateForm("imageUrl", event.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="imageFile">Ürün görseli yükle</label>
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    disabled={!canManageProducts || isSaving || isUploadingImage}
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
                    disabled={!canManageProducts || isSaving || isUploadingImage}
                    id="sortOrder"
                    inputMode="numeric"
                    type="number"
                    value={form.sortOrder}
                    onChange={(event) =>
                      updateForm("sortOrder", event.target.value)
                    }
                  />
                </div>

                <label className="field">
                  <span>Aktif ürün</span>
                  <input
                    checked={form.isActive}
                    disabled={!canManageProducts || isSaving || isUploadingImage}
                    type="checkbox"
                    onChange={(event) =>
                      updateForm("isActive", event.target.checked)
                    }
                  />
                </label>

                <button
                  className="submit-button panel-primary-action"
                  disabled={!canManageProducts || isSaving || isUploadingImage}
                  type="submit"
                >
                  {isUploadingImage
                    ? "Görsel yükleniyor..."
                    : isSaving
                    ? "Kaydediliyor..."
                    : editingProductId
                      ? "Ürünü Güncelle"
                      : "Ürün Ekle"}
                </button>

                {editingProductId ? (
                  <button
                    className="submit-button panel-secondary-action"
                    disabled={isSaving || isUploadingImage}
                    type="button"
                    onClick={resetForm}
                  >
                    Vazgec
                  </button>
                ) : null}
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
                              {product.isActive ? "Aktif" : "Pasif"}
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
                                <span>{product.isActive ? "Aktif" : "Pasif"}</span>
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
                                  isProductOrderingFiltered ||
                                  index === 0
                                }
                                type="button"
                                onClick={() => moveProduct(product, "up")}
                              >
                                Yukarı Taşı
                              </button>
                              <button
                                disabled={
                                  !canManageProducts ||
                                  isSaving ||
                                  isProductOrderingFiltered ||
                                  index === filteredProducts.length - 1
                                }
                                type="button"
                                onClick={() => moveProduct(product, "down")}
                              >
                                Aşağı Taşı
                              </button>
                              <button
                                disabled={!canManageProducts || isSaving}
                                type="button"
                                onClick={() => startEdit(product)}
                              >
                                Düzenle
                              </button>
                              <button
                                disabled={!canManageProducts || isSaving}
                                type="button"
                                onClick={() => toggleProduct(product)}
                              >
                                {product.isActive ? "Pasife Al" : "Aktif Et"}
                              </button>
                              <button
                                className="danger-button"
                                disabled={!canManageProducts || isSaving}
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
      {orderPrintReceipt ? (
        <OrderPrintReceipt receipt={orderPrintReceipt} />
      ) : null}
    </main>
  );
}
