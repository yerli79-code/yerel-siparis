"use client";

import Link from "next/link";
import { FormEvent, use, useEffect, useMemo, useRef, useState } from "react";
import { readBusinesses } from "../../../lib/business-storage";
import type { Business, Product, ProductCategory } from "../../../lib/businesses";
import { getAccessMessage } from "../../../lib/subscription";
import {
  getProductCategories,
  normalizeProductCategory,
  type StandardProductCategory,
} from "../../../lib/product-categories";
import {
  getInitialPaymentMethod,
  getPaymentMethodModeOrDefault,
  isPaymentMethod,
  PAYMENT_METHODS,
  type PaymentMethod,
} from "../../../lib/payment-methods";
import {
  PublicOrderRequestError,
  createPublicOrder,
  type PublicOrderCreateInput,
} from "../../../lib/supabase-orders";
import {
  fetchPublicBusinessBySlug,
  fetchPublicProductsByBusinessSlug,
  type BusinessProduct,
} from "../../../lib/supabase-business";

type CartItem = Product & { quantity: number };

type Customer = {
  fullName: string;
  phone: string;
  address: string;
  note: string;
};

type OrderType = "delivery" | "pickup";

type SavedCustomerDetails = Pick<Customer, "fullName" | "phone" | "address">;

type PendingOrderAttempt = {
  fingerprint: string;
  idempotencyKey: string;
  payload: PublicOrderCreateInput;
  message: {
    businessName: string;
    customer: Customer;
    orderType: OrderType;
    items: Array<{
      name: string;
      quantity: number;
      lineTotal: number;
    }>;
    total: number;
  };
};

type OrderRecoveryMode =
  | "none"
  | "saved"
  | "definitive"
  | "uncertain"
  | "conflict";

type DisplayBusiness = Business & {
  city?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
};

type DisplayProductCategory = ProductCategory & {
  filterKey: string;
};

type ProductCatalog = {
  categories: DisplayProductCategory[];
  products: Product[];
};

const initialCustomer: Customer = {
  fullName: "",
  phone: "",
  address: "",
  note: "",
};

const pageFetchTimeoutMs = 10000;
const ALL_CATEGORY_KEY = "all";
const allCategoriesLabel = "Tümü";
const customerDetailsStorageKey = "yerel-siparis:customer-details:v1";

function formatPrice(price: number) {
  return `${price.toLocaleString("tr-TR")} TL`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = pageFetchTimeoutMs) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("İstek zaman aşımına uğradı."));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

function readFallbackBusiness(slug: string) {
  try {
    return readBusinesses().find((item) => item.slug === slug) ?? null;
  } catch {
    return null;
  }
}

function isSavedCustomerDetails(value: unknown): value is SavedCustomerDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Record<string, unknown>;
  return (
    typeof details.fullName === "string" &&
    typeof details.phone === "string" &&
    typeof details.address === "string"
  );
}

function readSavedCustomerDetails() {
  try {
    const rawValue = window.localStorage.getItem(customerDetailsStorageKey);
    if (!rawValue) return null;
    const parsedValue = JSON.parse(rawValue) as unknown;
    if (!isSavedCustomerDetails(parsedValue)) {
      window.localStorage.removeItem(customerDetailsStorageKey);
      return null;
    }

    return parsedValue;
  } catch {
    try {
      window.localStorage.removeItem(customerDetailsStorageKey);
    } catch {
      // Ignore localStorage cleanup errors.
    }
    return null;
  }
}

function saveCustomerDetails(details: SavedCustomerDetails) {
  try {
    window.localStorage.setItem(customerDetailsStorageKey, JSON.stringify(details));
    return true;
  } catch {
    // Ignore localStorage write errors.
    return false;
  }
}

function removeSavedCustomerDetails() {
  try {
    window.localStorage.removeItem(customerDetailsStorageKey);
  } catch {
    // Ignore localStorage remove errors.
  }
}

function getLogoText(business: Business) {
  if (business.logoText?.trim()) return business.logoText.trim();
  return business.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function normalizeWhatsAppPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");

  if (!digits) return "";
  if (digits.startsWith("90") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `90${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 10) return `90${digits}`;

  return digits;
}

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);
}

function openMobileWhatsApp(appLink: string, fallbackLink: string) {
  let fallbackTimer: number | undefined;

  const cleanup = () => {
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", cleanup);
    window.removeEventListener("blur", cleanup);
  };

  const handleVisibilityChange = () => {
    if (document.hidden) cleanup();
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", cleanup, { once: true });
  window.addEventListener("blur", cleanup, { once: true });

  fallbackTimer = window.setTimeout(() => {
    cleanup();
    window.location.href = fallbackLink;
  }, 1800);

  window.location.href = appLink;
}

function organizeProductCategories(
  sourceCategories: ProductCategory[],
): ProductCatalog {
  const productsByCategory = new Map<StandardProductCategory, Product[]>();
  const products: Product[] = [];

  sourceCategories.forEach((category) => {
    const sourceCategoryName = category.name?.trim() || "Genel";
    const standardCategory = normalizeProductCategory(sourceCategoryName);
    const categoryProducts = category.products.map((product) => ({
      ...product,
      imageLabel: product.imageLabel || sourceCategoryName,
    }));

    products.push(...categoryProducts);

    if (!standardCategory) return;
    const existingProducts = productsByCategory.get(standardCategory) ?? [];
    existingProducts.push(...categoryProducts);
    productsByCategory.set(standardCategory, existingProducts);
  });

  return {
    categories: getProductCategories().flatMap((category) => {
      const categoryProducts = productsByCategory.get(category.label) ?? [];
      if (categoryProducts.length === 0) return [];

      const filterKey = `standard:${category.key}`;
      return [
        {
          id: filterKey,
          name: category.label,
          products: categoryProducts,
          filterKey,
        },
      ];
    }),
    products,
  };
}

function groupSupabaseProducts(
  products: BusinessProduct[],
): ProductCatalog {
  const sourceCategories: ProductCategory[] = [];

  products.forEach((product, index) => {
    const categoryName = product.category?.trim() || "Genel";
    sourceCategories.push({
      id: `supabase-source-${index}`,
      name: categoryName,
      products: [
        {
          id: product.id,
          name: product.name,
          price: product.price,
          description: product.description ?? "",
          imageLabel: product.imageLabel || categoryName,
          imageUrl: product.imageUrl,
          isActive: product.isActive,
        },
      ],
    });
  });

  return organizeProductCategories(sourceCategories);
}

export default function BusinessPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [business, setBusiness] = useState<Business | null>(null);
  const [supabaseCatalog, setSupabaseCatalog] = useState<ProductCatalog | null>(
    null,
  );
  const [isLoadingBusiness, setIsLoadingBusiness] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<Customer>(initialCustomer);
  const [orderType, setOrderType] = useState<OrderType>("delivery");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [paymentMethodError, setPaymentMethodError] = useState("");
  const [rememberCustomerDetails, setRememberCustomerDetails] = useState(false);
  const [hasSavedCustomerDetails, setHasSavedCustomerDetails] = useState(false);
  const [warning, setWarning] = useState("");
  const [orderRecordWarning, setOrderRecordWarning] = useState("");
  const [orderRecoveryMode, setOrderRecoveryMode] =
    useState<OrderRecoveryMode>("none");
  const [fallbackWhatsAppMessage, setFallbackWhatsAppMessage] = useState("");
  const [isRecordingOrder, setIsRecordingOrder] = useState(false);
  const [showCartOnMobile, setShowCartOnMobile] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORY_KEY);
  const cartSectionRef = useRef<HTMLElement | null>(null);
  const cartCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const cartTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pendingOrderAttemptRef = useRef<PendingOrderAttempt | null>(null);
  const activeOrderRequestRef = useRef<PendingOrderAttempt | null>(null);
  const isRecordingOrderRef = useRef(false);

  useEffect(() => {
    const savedDetails = readSavedCustomerDetails();
    if (!savedDetails) return;

    setCustomer((current) => ({
      ...current,
      fullName: savedDetails.fullName,
      phone: savedDetails.phone,
      address: savedDetails.address,
    }));
    setRememberCustomerDetails(true);
    setHasSavedCustomerDetails(true);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    setBusiness(null);
    setSupabaseCatalog(null);
    setLoadError("");
    setIsLoadingBusiness(true);
    setPaymentMethod("");
    setPaymentMethodError("");

    async function loadBusinessPage() {
      const fallbackBusiness = readFallbackBusiness(slug);

      try {
        const supabaseBusiness = await withTimeout(fetchPublicBusinessBySlug(slug));
        if (isCancelled) return;

        const nextBusiness = supabaseBusiness ?? fallbackBusiness;
        setBusiness(nextBusiness);
        setPaymentMethod(
          getInitialPaymentMethod(
            getPaymentMethodModeOrDefault(nextBusiness?.paymentMethodMode),
          ),
        );
        if (!nextBusiness) setLoadError("İşletme bulunamadı.");
      } catch {
        if (isCancelled) return;
        setBusiness(fallbackBusiness);
        setPaymentMethod(
          getInitialPaymentMethod(
            getPaymentMethodModeOrDefault(fallbackBusiness?.paymentMethodMode),
          ),
        );
        if (!fallbackBusiness) {
          setLoadError("İşletme bilgisi alınamadı.");
        }
      } finally {
        if (!isCancelled) setIsLoadingBusiness(false);
      }

      try {
        const products = await withTimeout(fetchPublicProductsByBusinessSlug(slug));
        if (isCancelled) return;
        setSupabaseCatalog(
          products.length > 0 ? groupSupabaseProducts(products) : null,
        );
      } catch {
        if (!isCancelled) setSupabaseCatalog(null);
      }
    }

    loadBusinessPage();

    return () => {
      isCancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (cart.length === 0) setShowCartOnMobile(false);
  }, [cart.length]);

  useEffect(() => {
    if (!showCartOnMobile) return;

    const mobileViewport = window.matchMedia("(max-width: 759px)");
    if (!mobileViewport.matches) {
      setShowCartOnMobile(false);
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cartCloseButtonRef.current?.focus();

    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setShowCartOnMobile(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeCartOnMobile();
        return;
      }

      if (event.key !== "Tab") return;
      const focusableElements = cartSectionRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]',
      );
      if (!focusableElements?.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    mobileViewport.addEventListener("change", handleViewportChange);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      mobileViewport.removeEventListener("change", handleViewportChange);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showCartOnMobile]);

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart],
  );
  const cartItemCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart],
  );
  const fallbackCatalog = useMemo(() => {
    if (!business) return { categories: [], products: [] };

    return organizeProductCategories(
      business.productCategories
        .map((category) => ({
          ...category,
          products: category.products.filter(
            (product) => product.isActive !== false,
          ),
        }))
        .filter((category) => category.products.length > 0),
    );
  }, [business]);
  const catalog = supabaseCatalog ?? fallbackCatalog;
  const categories = catalog.categories;
  const allProducts = catalog.products;

  useEffect(() => {
    if (
      isLoadingBusiness ||
      !business ||
      selectedCategory === ALL_CATEGORY_KEY
    ) {
      return;
    }

    const selectedCategoryExists = categories.some(
      (category) => category.filterKey === selectedCategory,
    );
    if (!selectedCategoryExists) setSelectedCategory(ALL_CATEGORY_KEY);
  }, [business, categories, isLoadingBusiness, selectedCategory]);

  function openCartOnMobile() {
    setShowCartOnMobile(true);
  }

  function closeCartOnMobile() {
    setShowCartOnMobile(false);
    window.setTimeout(() => {
      cartTriggerRef.current?.focus();
    }, 0);
  }

  if (isLoadingBusiness) {
    return (
      <main className="page">
        <div className="shell section">
          <p>İşletme bilgisi yükleniyor...</p>
        </div>
      </main>
    );
  }

  if (!business) {
    return (
      <main className="page">
        <div className="shell section">
          <h1>{loadError || "İşletme bulunamadı"}</h1>
          <Link href="/">Ana sayfaya dön</Link>
        </div>
      </main>
    );
  }

  const currentBusiness = business;
  const paymentMethodMode = getPaymentMethodModeOrDefault(
    currentBusiness.paymentMethodMode,
  );
  const fixedPaymentOption =
    paymentMethodMode === "cash_or_card"
      ? null
      : PAYMENT_METHODS.find((option) => option.value === paymentMethodMode) ??
        PAYMENT_METHODS[0];
  const accessMessage = getAccessMessage(currentBusiness);
  const totalProductCount = allProducts.length;
  const hasAnyProducts = totalProductCount > 0;
  const visibleCategories: ProductCategory[] =
    selectedCategory === ALL_CATEGORY_KEY
      ? allProducts.length > 0
        ? [{ id: ALL_CATEGORY_KEY, name: "", products: allProducts }]
        : []
      : categories.filter(
          (category) => category.filterKey === selectedCategory,
        );
  const displayBusiness = currentBusiness as DisplayBusiness;
  const coverImageUrl = displayBusiness.coverImageUrl?.trim();
  const addressText = [
    currentBusiness.neighborhood,
    currentBusiness.district,
    displayBusiness.city,
  ]
    .filter(Boolean)
    .join(" / ");
  const heroStyle = coverImageUrl
    ? {
        backgroundImage: `linear-gradient(135deg, rgba(23, 33, 27, 0.68), rgba(17, 130, 59, 0.78)), url("${coverImageUrl.replaceAll('"', "%22")}")`,
      }
    : undefined;
  const minimumOrderAmount =
    typeof currentBusiness.minimumOrderAmount === "number" &&
    Number.isFinite(currentBusiness.minimumOrderAmount) &&
    currentBusiness.minimumOrderAmount > 0
      ? currentBusiness.minimumOrderAmount
      : null;
  const preparationTimeMinutes =
    typeof currentBusiness.preparationTimeMinutes === "number" &&
    Number.isFinite(currentBusiness.preparationTimeMinutes) &&
    currentBusiness.preparationTimeMinutes > 0
      ? currentBusiness.preparationTimeMinutes
      : null;
  const isOrderingOpen = currentBusiness.isOpen !== false;
  const orderNote = currentBusiness.orderNote?.trim() || "";
  const hasExplicitOrderInfo =
    Boolean(currentBusiness.deliveryStatus?.trim()) ||
    minimumOrderAmount !== null ||
    preparationTimeMinutes !== null ||
    Boolean(orderNote);
  const minimumRemaining =
    minimumOrderAmount !== null ? Math.max(minimumOrderAmount - total, 0) : 0;
  const minimumOrderWarning =
    minimumOrderAmount !== null && cart.length > 0 && minimumRemaining > 0
      ? `Minimum sipariş tutarı ${formatPrice(
          minimumOrderAmount,
        )}. Sipariş için sepete ${formatPrice(minimumRemaining)} daha ekleyin.`
      : "";
  const orderInfoItems = [
    currentBusiness.deliveryStatus?.trim() || "",
    minimumOrderAmount !== null ? `Min. ${formatPrice(minimumOrderAmount)}` : "",
    preparationTimeMinutes !== null ? `Tahmini ${preparationTimeMinutes} dk` : "",
    !isOrderingOpen ? "Şu an kapalı" : hasExplicitOrderInfo ? "Açık" : "",
  ].filter(Boolean);
  const isOrderSubmitDisabled =
    cart.length === 0 ||
    !isOrderingOpen ||
    Boolean(minimumOrderWarning) ||
    isRecordingOrder;

  function clearPendingOrderAttempt() {
    pendingOrderAttemptRef.current = null;
    setOrderRecordWarning("");
    setOrderRecoveryMode("none");
    setFallbackWhatsAppMessage("");
  }

  function updatePaymentMethod(nextPaymentMethod: PaymentMethod) {
    if (isRecordingOrderRef.current) return;
    setPaymentMethod(nextPaymentMethod);
    setPaymentMethodError("");
    setWarning("");
    clearPendingOrderAttempt();
  }

  function addToCart(product: Product) {
    if (isRecordingOrderRef.current) return;
    if (!isOrderingOpen) {
      setWarning("Bu işletme şu an sipariş almıyor.");
      return;
    }
    setWarning("");
    clearPendingOrderAttempt();
    setCart((items) => {
      const existing = items.find((item) => item.id === product.id);
      if (!existing) return [...items, { ...product, quantity: 1 }];
      return items.map((item) =>
        item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
      );
    });
  }

  function decrease(productId: string) {
    if (isRecordingOrderRef.current) return;
    if (!isOrderingOpen) {
      setWarning("Bu işletme şu an sipariş almıyor.");
      return;
    }
    setWarning("");
    clearPendingOrderAttempt();
    setCart((items) =>
      items
        .map((item) =>
          item.id === productId ? { ...item, quantity: item.quantity - 1 } : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  function increase(productId: string) {
    if (isRecordingOrderRef.current) return;
    if (!isOrderingOpen) {
      setWarning("Bu işletme şu an sipariş almıyor.");
      return;
    }
    setWarning("");
    clearPendingOrderAttempt();
    setCart((items) =>
      items.map((item) =>
        item.id === productId ? { ...item, quantity: item.quantity + 1 } : item,
      ),
    );
  }

  function updateCustomer(field: keyof Customer, value: string) {
    if (isRecordingOrderRef.current) return;
    setWarning("");
    clearPendingOrderAttempt();
    const nextCustomer = { ...customer, [field]: value };
    setCustomer(nextCustomer);

    if (
      rememberCustomerDetails &&
      (field === "fullName" || field === "phone" || field === "address")
    ) {
      setHasSavedCustomerDetails(
        saveCustomerDetails({
          fullName: nextCustomer.fullName,
          phone: nextCustomer.phone,
          address: nextCustomer.address,
        }),
      );
    }
  }

  function toggleRememberCustomerDetails(shouldRemember: boolean) {
    setRememberCustomerDetails(shouldRemember);
    if (shouldRemember) {
      setHasSavedCustomerDetails(
        saveCustomerDetails({
          fullName: customer.fullName,
          phone: customer.phone,
          address: customer.address,
        }),
      );
      return;
    }

    removeSavedCustomerDetails();
    setHasSavedCustomerDetails(false);
  }

  function clearSavedCustomerDetails() {
    if (isRecordingOrderRef.current) return;
    removeSavedCustomerDetails();
    setRememberCustomerDetails(false);
    setHasSavedCustomerDetails(false);
    clearPendingOrderAttempt();
    setCustomer((current) => ({
      ...current,
      fullName: "",
      phone: "",
      address: "",
    }));
  }

  function createMessage(attempt: PendingOrderAttempt, orderNumber?: number) {
    const lines = attempt.message.items
      .map(
        (item) =>
          `- ${item.name} x ${item.quantity} = ${formatPrice(item.lineTotal)}`,
      )
      .join("\n");
    const orderTypeLabel =
      attempt.message.orderType === "delivery" ? "Teslimat" : "Gel-al";
    const customerLines = [
      `Ad Soyad: ${attempt.message.customer.fullName}`,
      `Telefon: ${attempt.message.customer.phone}`,
      `Sipariş Türü: ${orderTypeLabel}`,
      ...(attempt.message.orderType === "delivery"
        ? [`Adres: ${attempt.message.customer.address}`]
        : []),
      `Not: ${attempt.message.customer.note || "-"}`,
    ];

    return [
      "Yeni Sipariş",
      ...(orderNumber ? [`Sipariş No: #${orderNumber}`] : []),
      `İşletme: ${attempt.message.businessName}`,
      "",
      "Müşteri Bilgileri:",
      ...customerLines,
      "",
      "Sipariş:",
      lines,
      "",
      `Genel Toplam: ${formatPrice(attempt.message.total)}`,
    ].join("\n");
  }

  function sendWhatsAppMessage(
    message: string,
    preparedWindow: Window | null = null,
  ) {
    const phone = normalizeWhatsAppPhone(currentBusiness.whatsappOrderNumber);
    if (!phone) {
      setWarning("İşletmenin WhatsApp numarası bulunamadı.");
      return false;
    }

    const encodedMessage = encodeURIComponent(message);
    const webLink = `https://wa.me/${phone}?text=${encodedMessage}`;

    if (!isMobileDevice()) {
      try {
        const targetWindow =
          preparedWindow ?? window.open("about:blank", "_blank");
        if (!targetWindow) return false;
        targetWindow.opener = null;
        targetWindow.location.replace(webLink);
        return true;
      } catch {
        preparedWindow?.close();
        return false;
      }
    }

    openMobileWhatsApp(
      `whatsapp://send?phone=${phone}&text=${encodedMessage}`,
      webLink,
    );
    return true;
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRecordingOrderRef.current) return;
    setOrderRecordWarning("");
    setOrderRecoveryMode("none");
    setFallbackWhatsAppMessage("");
    setPaymentMethodError("");
    if (!isOrderingOpen) {
      setWarning("Bu işletme şu an sipariş almıyor.");
      return;
    }
    if (cart.length === 0) {
      setWarning("Sipariş oluşturmak için sepete en az bir ürün ekleyin.");
      return;
    }
    if (minimumOrderWarning) {
      setWarning(minimumOrderWarning);
      return;
    }
    if (!isPaymentMethod(paymentMethod)) {
      setPaymentMethodError("Lütfen ödeme yöntemini seçin.");
      return;
    }
    if (!customer.fullName.trim() || !customer.phone.trim()) {
      setWarning("Lütfen Ad Soyad ve Telefon alanlarını doldurun.");
      return;
    }
    if (orderType === "delivery" && !customer.address.trim()) {
      setWarning("Teslimat için adres bilgisi girin.");
      return;
    }

    const phone = normalizeWhatsAppPhone(currentBusiness.whatsappOrderNumber);
    if (!phone) {
      setWarning("İşletmenin WhatsApp numarası bulunamadı.");
      return;
    }

    const normalizedCustomer = {
      fullName: customer.fullName.trim(),
      phone: customer.phone.trim(),
      address: orderType === "delivery" ? customer.address.trim() : null,
      note: customer.note.trim(),
    };
    const normalizedItems = cart
      .map((item) => ({
        productId: item.id,
        quantity: item.quantity,
      }))
      .sort((first, second) => first.productId.localeCompare(second.productId));
    const attemptFingerprint = JSON.stringify({
      businessSlug: currentBusiness.slug,
      orderType,
      paymentMethod,
      customer: normalizedCustomer,
      items: normalizedItems,
    });

    let attempt =
      pendingOrderAttemptRef.current?.fingerprint === attemptFingerprint
        ? pendingOrderAttemptRef.current
        : null;
    if (!attempt) {
      if (
        typeof crypto === "undefined" ||
        typeof crypto.randomUUID !== "function"
      ) {
        setWarning("Sipariş güvenli biçimde başlatılamadı. Lütfen tekrar deneyin.");
        return;
      }
      const idempotencyKey = crypto.randomUUID();
      attempt = {
        fingerprint: attemptFingerprint,
        idempotencyKey,
        payload: {
          businessSlug: currentBusiness.slug,
          orderType,
          paymentMethod,
          customer: normalizedCustomer,
          items: normalizedItems,
          idempotencyKey,
        },
        message: {
          businessName: currentBusiness.name,
          customer: {
            ...normalizedCustomer,
            address: normalizedCustomer.address ?? "",
          },
          orderType,
          items: cart.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            lineTotal: item.price * item.quantity,
          })),
          total,
        },
      };
      pendingOrderAttemptRef.current = attempt;
    }

    const preparedWhatsAppWindow = !isMobileDevice()
      ? window.open("about:blank", "_blank")
      : null;
    if (preparedWhatsAppWindow) preparedWhatsAppWindow.opener = null;

    activeOrderRequestRef.current = attempt;
    isRecordingOrderRef.current = true;
    setIsRecordingOrder(true);
    try {
      const result = await createPublicOrder(attempt.payload);
      if (
        activeOrderRequestRef.current !== attempt ||
        pendingOrderAttemptRef.current !== attempt
      ) {
        preparedWhatsAppWindow?.close();
        return;
      }
      pendingOrderAttemptRef.current = null;
      setWarning("");
      const whatsappOpened = sendWhatsAppMessage(
        createMessage(attempt, result.orderNumber),
        preparedWhatsAppWindow,
      );
      if (!whatsappOpened) {
        setOrderRecoveryMode("saved");
        setFallbackWhatsAppMessage(createMessage(attempt, result.orderNumber));
        setOrderRecordWarning(
          "Sipariş kaydedildi. WhatsApp penceresini açmak için aşağıdaki butonu kullanın.",
        );
      }
    } catch (error) {
      preparedWhatsAppWindow?.close();
      if (
        activeOrderRequestRef.current !== attempt ||
        pendingOrderAttemptRef.current !== attempt
      ) {
        return;
      }
      setWarning("");
      setFallbackWhatsAppMessage(createMessage(attempt));
      if (
        error instanceof PublicOrderRequestError &&
        error.kind === "uncertain"
      ) {
        setOrderRecoveryMode("uncertain");
        setOrderRecordWarning(
          "Siparişiniz kaydedilmiş olabilir. Çift siparişi önlemek için önce aynı siparişi tekrar kontrol edin.",
        );
      } else if (
        error instanceof PublicOrderRequestError &&
        error.code === "IDEMPOTENCY_CONFLICT"
      ) {
        setOrderRecoveryMode("conflict");
        setFallbackWhatsAppMessage("");
        setOrderRecordWarning(
          "Sipariş bilgileri bu deneme sırasında değişti. Lütfen sayfayı yenileyip tekrar deneyin.",
        );
      } else {
        setOrderRecoveryMode("definitive");
        setOrderRecordWarning(
          "Sipariş panel kaydı oluşturulamadı. WhatsApp ile yine de gönderebilirsiniz.",
        );
      }
    } finally {
      if (activeOrderRequestRef.current === attempt) {
        activeOrderRequestRef.current = null;
        isRecordingOrderRef.current = false;
        setIsRecordingOrder(false);
      }
    }
  }

  async function retryPendingOrder() {
    if (isRecordingOrderRef.current) return;
    const attempt = pendingOrderAttemptRef.current;
    if (!attempt) {
      setOrderRecoveryMode("conflict");
      setOrderRecordWarning(
        "Bekleyen sipariş denemesi bulunamadı. Lütfen siparişi yeniden oluşturun.",
      );
      return;
    }

    activeOrderRequestRef.current = attempt;
    isRecordingOrderRef.current = true;
    setIsRecordingOrder(true);
    setWarning("");
    setOrderRecordWarning("Sipariş sonucu tekrar kontrol ediliyor...");
    try {
      const result = await createPublicOrder(attempt.payload);
      if (
        activeOrderRequestRef.current !== attempt ||
        pendingOrderAttemptRef.current !== attempt
      ) {
        return;
      }
      pendingOrderAttemptRef.current = null;
      setOrderRecoveryMode("saved");
      setFallbackWhatsAppMessage(createMessage(attempt, result.orderNumber));
      setOrderRecordWarning(
        "Sipariş kaydedildi. WhatsApp ile devam etmek için aşağıdaki butonu kullanın.",
      );
    } catch (error) {
      if (
        activeOrderRequestRef.current !== attempt ||
        pendingOrderAttemptRef.current !== attempt
      ) {
        return;
      }
      if (
        error instanceof PublicOrderRequestError &&
        error.kind === "uncertain"
      ) {
        setOrderRecoveryMode("uncertain");
        setOrderRecordWarning(
          "Sipariş sonucu hâlâ doğrulanamadı. Aynı siparişi yeniden kontrol edebilir veya uyarıyı dikkate alarak numarasız gönderebilirsiniz.",
        );
      } else if (
        error instanceof PublicOrderRequestError &&
        error.code === "IDEMPOTENCY_CONFLICT"
      ) {
        setOrderRecoveryMode("conflict");
        setFallbackWhatsAppMessage("");
        setOrderRecordWarning(
          "Sipariş bilgileri bu deneme sırasında değişti. Lütfen sayfayı yenileyip tekrar deneyin.",
        );
      } else {
        setOrderRecoveryMode("definitive");
        setOrderRecordWarning(
          "Sipariş kaydı oluşturulamadı. WhatsApp ile yine de gönderebilirsiniz.",
        );
      }
    } finally {
      if (activeOrderRequestRef.current === attempt) {
        activeOrderRequestRef.current = null;
        isRecordingOrderRef.current = false;
        setIsRecordingOrder(false);
      }
    }
  }

  return (
    <main className="page public-order-page">
      <div className="shell public-order-shell">
        <header className="hero business-hero public-order-hero" style={heroStyle}>
          <div className="hero-content business-hero-content public-order-hero-content">
            <div className="business-topline public-order-topline">
              <Link className="eyebrow business-back-link" href="/">
                ← İşletmeler
              </Link>
            </div>

            <div className="business-identity public-order-identity">
              {displayBusiness.logoUrl ? (
                <img
                  alt={currentBusiness.name}
                  className="business-logo public-order-logo"
                  src={displayBusiness.logoUrl}
                />
              ) : (
                <span className="business-logo-text public-order-logo">
                  {getLogoText(currentBusiness)}
                </span>
              )}
              <div className="public-order-identity-copy">
                <h1>{currentBusiness.name}</h1>
                <p>{currentBusiness.description}</p>
              </div>
            </div>

            <div className="business-meta public-order-location">
              {addressText ? <span>{addressText}</span> : null}
              {currentBusiness.address ? <span>{currentBusiness.address}</span> : null}
            </div>
          </div>
        </header>

        {orderInfoItems.length > 0 || orderNote ? (
          <section
            className="business-order-info public-order-info"
            aria-label="Sipariş bilgileri"
          >
            {orderInfoItems.length > 0 ? (
              <div className="business-order-badges public-order-badges">
                {orderInfoItems.map((item) => (
                  <span
                    className={`business-order-badge public-order-badge ${
                      item === "Şu an kapalı" ? "closed" : ""
                    }`}
                    key={item}
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : null}
            {orderNote ? (
              <p className="business-order-note public-order-note">
                <strong>Sipariş notu:</strong> {orderNote}
              </p>
            ) : null}
          </section>
        ) : null}

        {accessMessage ? (
          <section className="section access-message public-order-access-message">
            <h2>Sipariş alınamıyor</h2>
            <p>{accessMessage}</p>
          </section>
        ) : (
          <div className="layout public-order-layout">
            <section className="section menu-section public-order-menu">
              {!isOrderingOpen ? (
                <p className="manual-order-warning public-order-rule-warning">
                  Bu işletme şu an sipariş almıyor.
                </p>
              ) : null}
              <div className="menu-heading public-order-menu-heading">
                <div>
                  <span className="menu-kicker">Menü</span>
                  <h2>Ürünler</h2>
                </div>
                <span>{categories.length} kategori</span>
              </div>
              {hasAnyProducts ? (
                <div
                  className="menu-category-tabs public-order-category-tabs"
                  aria-label="Kategori menüsü"
                >
                  <button
                    className={`menu-category-tab public-order-category-tab ${
                      selectedCategory === ALL_CATEGORY_KEY ? "selected" : ""
                    }`}
                    type="button"
                    onClick={() => setSelectedCategory(ALL_CATEGORY_KEY)}
                  >
                    {allCategoriesLabel} ({totalProductCount})
                  </button>
                  {categories.map((category) => (
                    <button
                      className={`menu-category-tab public-order-category-tab ${
                        selectedCategory === category.filterKey ? "selected" : ""
                      }`}
                      key={category.id}
                      type="button"
                      onClick={() => setSelectedCategory(category.filterKey)}
                    >
                      {category.name} ({category.products.length})
                    </button>
                  ))}
                </div>
              ) : null}
              {!hasAnyProducts ? (
                <div className="menu-empty-state public-order-empty-state">
                  <strong>Menü henüz hazır değil.</strong>
                  <p>Bu işletme ürünlerini eklediğinde burada görünecek.</p>
                </div>
              ) : visibleCategories.length === 0 ? (
                <div className="menu-empty-state public-order-empty-state">
                  <strong>Bu kategoride ürün yok.</strong>
                  <p>Başka bir kategori seçerek menüye göz atabilirsiniz.</p>
                </div>
              ) : null}
              {visibleCategories.map((category) => (
                <div className="category public-order-category" key={category.id}>
                  {category.name ? (
                    <h3 className="category-title public-order-category-title">
                      {category.name}
                    </h3>
                  ) : null}
                  <div className="products public-order-products">
                    {category.products.map((product) => (
                      <article
                        className="product-card menu-product-card public-order-product"
                        key={product.id}
                      >
                        <div className="product-card-body public-order-product-body">
                          {product.imageUrl ? (
                            <img
                              alt={product.name}
                              className="product-card-image public-order-product-image"
                              src={product.imageUrl}
                            />
                          ) : (
                            <span className="product-image-placeholder public-order-product-image">
                              {product.imageLabel || category.name}
                            </span>
                          )}
                          <div className="product-copy public-order-product-copy">
                            <p className="product-name">{product.name}</p>
                            {product.description ? (
                              <p className="product-description">{product.description}</p>
                            ) : null}
                            <span className="price">{formatPrice(product.price)}</span>
                          </div>
                        </div>
                        <button
                          className="add-button public-order-add-button"
                          disabled={!isOrderingOpen || isRecordingOrder}
                          type="button"
                          onClick={() => addToCart(product)}
                        >
                          {isOrderingOpen ? "+ Ekle" : "Kapalı"}
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            {cart.length > 0 && showCartOnMobile ? (
              <button
                aria-hidden="true"
                className="public-order-cart-backdrop"
                tabIndex={-1}
                type="button"
                onClick={closeCartOnMobile}
              />
            ) : null}
            <aside
              aria-labelledby="public-order-cart-title"
              aria-modal={showCartOnMobile ? true : undefined}
              className={`order-panel public-order-cart-panel ${
                showCartOnMobile ? "public-order-cart-panel-open" : ""
              } ${
                cart.length > 0 && showCartOnMobile ? "" : "mobile-cart-hidden"
              }`}
              id="public-order-cart-panel"
              ref={cartSectionRef}
              role={showCartOnMobile ? "dialog" : undefined}
            >
              <div className="order-inner section order-card public-order-cart-sheet">
                <div className="section-title public-order-cart-header">
                  <div>
                    <span className="public-order-cart-grip" aria-hidden="true" />
                    <h2 id="public-order-cart-title">Sepetim</h2>
                    <span>{cartItemCount} adet ürün</span>
                  </div>
                  <button
                    aria-label="Sepeti kapat"
                    className="public-order-cart-close"
                    ref={cartCloseButtonRef}
                    type="button"
                    onClick={closeCartOnMobile}
                  >
                    ×
                  </button>
                </div>

                <form
                  className="customer-form public-order-checkout-form"
                  onSubmit={submitOrder}
                >
                  {!isOrderingOpen ? (
                    <p className="order-rule-warning public-order-rule-warning">
                      Bu işletme şu an sipariş almıyor.
                    </p>
                  ) : minimumOrderWarning ? (
                    <p className="order-rule-warning public-order-rule-warning">
                      {minimumOrderWarning}
                    </p>
                  ) : null}

                  <div className="field public-order-type-field">
                    <span className="order-type-label">Sipariş Türü</span>
                    <div
                      className="order-type-toggle public-order-type-toggle"
                      role="group"
                      aria-label="Sipariş türü"
                    >
                      <button
                        aria-pressed={orderType === "delivery"}
                        className={`order-type-button public-order-type-button ${
                          orderType === "delivery" ? "selected" : ""
                        }`}
                        disabled={isRecordingOrder}
                        type="button"
                        onClick={() => {
                          setWarning("");
                          clearPendingOrderAttempt();
                          setOrderType("delivery");
                        }}
                      >
                        Teslimat
                      </button>
                      <button
                        aria-pressed={orderType === "pickup"}
                        className={`order-type-button public-order-type-button ${
                          orderType === "pickup" ? "selected" : ""
                        }`}
                        disabled={isRecordingOrder}
                        type="button"
                        onClick={() => {
                          setWarning("");
                          clearPendingOrderAttempt();
                          setOrderType("pickup");
                        }}
                      >
                        Gel-al
                      </button>
                    </div>
                  </div>

                  <fieldset className="public-order-payment-field">
                    <legend>Ödeme yöntemi</legend>
                    {fixedPaymentOption ? (
                      <div className="public-order-payment-fixed">
                        <strong>{fixedPaymentOption.displayLabel}</strong>
                        <span>
                          {fixedPaymentOption.value === "card"
                            ? "Ödeme teslimat veya gel-al sırasında fiziksel POS ile yapılır. Online ödeme alınmaz."
                            : "Bu işletme yalnız nakit ödeme kabul ediyor."}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="public-order-payment-options">
                          {PAYMENT_METHODS.map((option) => (
                            <label
                              className={`public-order-payment-option${
                                paymentMethod === option.value ? " selected" : ""
                              }`}
                              key={option.value}
                            >
                              <input
                                checked={paymentMethod === option.value}
                                disabled={isRecordingOrder}
                                name="paymentMethod"
                                type="radio"
                                value={option.value}
                                onChange={() => updatePaymentMethod(option.value)}
                              />
                              <span>{option.displayLabel}</span>
                            </label>
                          ))}
                        </div>
                        <p className="public-order-payment-help">
                          Kart ödemesi teslimat veya gel-al sırasında fiziksel POS ile
                          yapılır. Online ödeme alınmaz.
                        </p>
                      </>
                    )}
                    {paymentMethodError ? (
                      <p className="public-order-payment-error" role="alert">
                        {paymentMethodError}
                      </p>
                    ) : null}
                  </fieldset>

                  <div className="cart public-order-cart-items">
                    {cart.length === 0 ? (
                      <p className="empty-cart">Sepetiniz boş.</p>
                    ) : (
                      cart.map((item) => (
                        <div className="cart-item public-order-cart-item" key={item.id}>
                          <div className="cart-line public-order-cart-line">
                            <strong>{item.name}</strong>
                            <span>{formatPrice(item.price * item.quantity)}</span>
                          </div>
                          <div className="cart-actions">
                            <div className="quantity public-order-quantity">
                              <button
                                aria-label={`${item.name} adedini azalt`}
                                className="quantity-button public-order-quantity-button"
                                disabled={!isOrderingOpen || isRecordingOrder}
                                type="button"
                                onClick={() => decrease(item.id)}
                              >
                                −
                              </button>
                              <strong aria-label={`${item.quantity} adet`}>
                                {item.quantity}
                              </strong>
                              <button
                                aria-label={`${item.name} adedini artır`}
                                className="quantity-button public-order-quantity-button"
                                disabled={!isOrderingOpen || isRecordingOrder}
                                type="button"
                                onClick={() => increase(item.id)}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="cart-total public-order-cart-total">
                    <span>Genel Toplam</span>
                    <strong>{formatPrice(total)}</strong>
                  </div>

                  <div className="public-order-form-heading">
                    <span>Siparişi tamamla</span>
                    <p>Bilgilerinizi girin, siparişinizi güvenle oluşturalım.</p>
                  </div>
                  <div className="field public-order-field">
                    <label htmlFor="fullName">Ad Soyad *</label>
                    <input
                      autoComplete="name"
                      disabled={isRecordingOrder}
                      id="fullName"
                      value={customer.fullName}
                      onChange={(event) => updateCustomer("fullName", event.target.value)}
                    />
                  </div>
                  <div className="field public-order-field">
                    <label htmlFor="phone">Telefon *</label>
                    <input
                      autoComplete="tel"
                      disabled={isRecordingOrder}
                      id="phone"
                      inputMode="tel"
                      value={customer.phone}
                      onChange={(event) => updateCustomer("phone", event.target.value)}
                    />
                  </div>
                  {orderType === "delivery" ? (
                    <div className="field public-order-field">
                      <label htmlFor="address">Teslimat Adresi *</label>
                      <textarea
                        autoComplete="street-address"
                        disabled={isRecordingOrder}
                        id="address"
                        value={customer.address}
                        onChange={(event) => updateCustomer("address", event.target.value)}
                      />
                    </div>
                  ) : (
                    <p className="pickup-address-hint public-order-pickup-hint">
                      Gel-al siparişlerinde adres gerekmez.
                    </p>
                  )}
                  <div className="customer-remember-panel public-order-remember-panel">
                    <label className="customer-remember-option public-order-remember-option">
                      <input
                        checked={rememberCustomerDetails}
                        className="customer-remember-checkbox"
                        disabled={isRecordingOrder}
                        type="checkbox"
                        onChange={(event) =>
                          toggleRememberCustomerDetails(event.target.checked)
                        }
                      />
                      <span>Bilgilerimi bu cihazda hatırla</span>
                    </label>
                    <p>Ortak cihazlarda bilgilerinizi kaydetmeyin.</p>
                    {hasSavedCustomerDetails ? (
                      <button
                        className="clear-saved-customer-button"
                        disabled={isRecordingOrder}
                        type="button"
                        onClick={clearSavedCustomerDetails}
                      >
                        Kaydedilen bilgileri sil
                      </button>
                    ) : null}
                  </div>
                  <p className="order-data-note public-order-data-note">
                    Siparişinizi hazırlamak ve takip etmek için adınız, telefonunuz,
                    teslimat adresiniz ve sipariş notunuz işletmenin sipariş panelinde
                    siparişin oluşturulmasından 180 gün sonra periyodik olarak silinir.
                    Gel-al siparişlerinde adres kaydedilmez.
                  </p>
                  <div className="field public-order-field">
                    <label htmlFor="note">Sipariş Notu</label>
                    <textarea
                      disabled={isRecordingOrder}
                      id="note"
                      value={customer.note}
                      onChange={(event) => updateCustomer("note", event.target.value)}
                    />
                  </div>
                  {warning ? (
                    <p className="alert public-order-alert" role="alert">
                      {warning}
                    </p>
                  ) : null}
                  {orderRecordWarning ? (
                    <div
                      className={`order-record-fallback public-order-recovery${
                        orderRecoveryMode === "uncertain"
                          ? " order-record-uncertain"
                          : ""
                      }`}
                    >
                      <p>{orderRecordWarning}</p>
                      {orderRecoveryMode === "uncertain" ? (
                        <button
                          className="submit-button order-retry-button public-order-retry-button"
                          disabled={isRecordingOrder}
                          type="button"
                          onClick={retryPendingOrder}
                        >
                          {isRecordingOrder
                            ? "Sipariş kontrol ediliyor..."
                            : "Siparişi tekrar dene"}
                        </button>
                      ) : null}
                      {orderRecoveryMode !== "conflict" &&
                      fallbackWhatsAppMessage ? (
                        <button
                          className="submit-button secondary-whatsapp-button public-order-secondary-button"
                          disabled={isRecordingOrder}
                          type="button"
                          onClick={() => {
                            setOrderRecordWarning("");
                            sendWhatsAppMessage(fallbackWhatsAppMessage);
                          }}
                        >
                          {orderRecoveryMode === "uncertain"
                            ? "Yine de numarasız WhatsApp ile gönder"
                            : orderRecoveryMode === "saved"
                              ? "WhatsApp ile devam et"
                            : "WhatsApp ile yine de gönder"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <button
                    className="submit-button public-order-submit-button"
                    disabled={isOrderSubmitDisabled}
                    type="submit"
                  >
                    {isRecordingOrder
                      ? "Sipariş kaydediliyor..."
                      : "WhatsApp ile Sipariş Oluştur"}
                  </button>
                </form>
              </div>
            </aside>
            {cart.length > 0 && !showCartOnMobile && isOrderingOpen ? (
              <button
                aria-controls="public-order-cart-panel"
                aria-expanded={showCartOnMobile}
                className="mobile-cart-shortcut public-order-cart-bar"
                ref={cartTriggerRef}
                type="button"
                onClick={openCartOnMobile}
              >
                <span>
                  <strong>Sepette {cartItemCount} ürün</strong>
                  <small>Toplam: {formatPrice(total)}</small>
                </span>
                <b>Sepeti Gör</b>
              </button>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
