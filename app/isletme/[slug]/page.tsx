"use client";

import Link from "next/link";
import { FormEvent, use, useEffect, useMemo, useRef, useState } from "react";
import { readBusinesses } from "../../../lib/business-storage";
import type { Business, Product, ProductCategory } from "../../../lib/businesses";
import { getAccessMessage } from "../../../lib/subscription";
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

const initialCustomer: Customer = {
  fullName: "",
  phone: "",
  address: "",
  note: "",
};

const pageFetchTimeoutMs = 10000;
const allCategoriesFilter = "Tümü";
const customerDetailsStorageKey = "yerel-siparis:customer-details:v1";

function formatPrice(price: number) {
  return `${price.toLocaleString("tr-TR")} TL`;
}

function normalizeCategoryName(name?: string | null) {
  return name?.trim() || "Genel";
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

function groupSupabaseProducts(products: BusinessProduct[]): ProductCategory[] {
  const categories = new Map<string, Product[]>();

  products.forEach((product) => {
    const categoryName = normalizeCategoryName(product.category);
    const categoryProducts = categories.get(categoryName) ?? [];
    categoryProducts.push({
      id: product.id,
      name: product.name,
      price: product.price,
      description: product.description ?? "",
      imageLabel: product.imageLabel || categoryName,
      imageUrl: product.imageUrl,
      isActive: product.isActive,
    });
    categories.set(categoryName, categoryProducts);
  });

  return Array.from(categories.entries()).map(([name, categoryProducts], index) => ({
    id: `supabase-${index}-${name.toLowerCase().replaceAll(" ", "-")}`,
    name,
    products: categoryProducts,
  }));
}

export default function BusinessPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [business, setBusiness] = useState<Business | null>(null);
  const [supabaseCategories, setSupabaseCategories] = useState<ProductCategory[] | null>(null);
  const [isLoadingBusiness, setIsLoadingBusiness] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<Customer>(initialCustomer);
  const [orderType, setOrderType] = useState<OrderType>("delivery");
  const [rememberCustomerDetails, setRememberCustomerDetails] = useState(false);
  const [hasSavedCustomerDetails, setHasSavedCustomerDetails] = useState(false);
  const [warning, setWarning] = useState("");
  const [orderRecordWarning, setOrderRecordWarning] = useState("");
  const [orderRecoveryMode, setOrderRecoveryMode] =
    useState<OrderRecoveryMode>("none");
  const [fallbackWhatsAppMessage, setFallbackWhatsAppMessage] = useState("");
  const [isRecordingOrder, setIsRecordingOrder] = useState(false);
  const [showCartOnMobile, setShowCartOnMobile] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(allCategoriesFilter);
  const cartSectionRef = useRef<HTMLElement | null>(null);
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
    setSupabaseCategories(null);
    setLoadError("");
    setIsLoadingBusiness(true);

    async function loadBusinessPage() {
      const fallbackBusiness = readFallbackBusiness(slug);

      try {
        const supabaseBusiness = await withTimeout(fetchPublicBusinessBySlug(slug));
        if (isCancelled) return;

        const nextBusiness = supabaseBusiness ?? fallbackBusiness;
        setBusiness(nextBusiness);
        if (!nextBusiness) setLoadError("İşletme bulunamadı.");
      } catch {
        if (isCancelled) return;
        setBusiness(fallbackBusiness);
        if (!fallbackBusiness) {
          setLoadError("İşletme bilgisi alınamadı.");
        }
      } finally {
        if (!isCancelled) setIsLoadingBusiness(false);
      }

      try {
        const products = await withTimeout(fetchPublicProductsByBusinessSlug(slug));
        if (isCancelled) return;
        setSupabaseCategories(
          products.length > 0 ? groupSupabaseProducts(products) : null,
        );
      } catch {
        if (!isCancelled) setSupabaseCategories(null);
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

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart],
  );
  const cartItemCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart],
  );

  function scrollToCart() {
    setShowCartOnMobile(true);
    window.setTimeout(() => {
      cartSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
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
  const accessMessage = getAccessMessage(currentBusiness);
  const fallbackCategories = currentBusiness.productCategories
    .map((category) => ({
      ...category,
      name: normalizeCategoryName(category.name),
      products: category.products.filter((product) => product.isActive !== false),
    }))
    .filter((category) => category.products.length > 0);
  const categories = supabaseCategories ?? fallbackCategories;
  const totalProductCount = categories.reduce(
    (count, category) => count + category.products.length,
    0,
  );
  const hasAnyProducts = totalProductCount > 0;
  const selectedCategoryExists =
    selectedCategory === allCategoriesFilter ||
    categories.some((category) => category.name === selectedCategory);
  const effectiveSelectedCategory = selectedCategoryExists
    ? selectedCategory
    : allCategoriesFilter;
  const visibleCategories =
    effectiveSelectedCategory === allCategoriesFilter
      ? categories
      : categories.filter((category) => category.name === effectiveSelectedCategory);
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
    <main className="page">
      <div className="shell">
        <header className="hero business-hero" style={heroStyle}>
          <div className="hero-content business-hero-content">
            <div className="business-topline">
              <Link className="eyebrow business-back-link" href="/">
                ← İşletmeler
              </Link>
            </div>

            <div className="business-identity">
              {displayBusiness.logoUrl ? (
                <img
                  alt={currentBusiness.name}
                  className="business-logo"
                  src={displayBusiness.logoUrl}
                />
              ) : (
                <span className="business-logo-text">{getLogoText(currentBusiness)}</span>
              )}
              <div>
                <h1>{currentBusiness.name}</h1>
                <p>{currentBusiness.description}</p>
              </div>
            </div>

            <div className="business-meta">
              {addressText ? <span>{addressText}</span> : null}
              {currentBusiness.address ? <span>{currentBusiness.address}</span> : null}
            </div>
          </div>
        </header>

        {orderInfoItems.length > 0 || orderNote ? (
          <section className="business-order-info" aria-label="Sipariş bilgileri">
            {orderInfoItems.length > 0 ? (
              <div className="business-order-badges">
                {orderInfoItems.map((item) => (
                  <span
                    className={`business-order-badge ${
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
              <p className="business-order-note">
                <strong>Sipariş notu:</strong> {orderNote}
              </p>
            ) : null}
          </section>
        ) : null}

        {accessMessage ? (
          <section className="section access-message">
            <h2>Sipariş alınamıyor</h2>
            <p>{accessMessage}</p>
          </section>
        ) : (
          <div className="layout">
            <section className="section menu-section">
              {!isOrderingOpen ? (
                <p className="manual-order-warning">
                  Bu işletme şu an sipariş almıyor.
                </p>
              ) : null}
              <div className="menu-heading">
                <div>
                  <span className="menu-kicker">Menü</span>
                  <h2>Ürünler</h2>
                </div>
                <span>{categories.length} kategori</span>
              </div>
              {hasAnyProducts ? (
                <div className="menu-category-tabs" aria-label="Kategori menüsü">
                  <button
                    className={`menu-category-tab ${
                      effectiveSelectedCategory === allCategoriesFilter ? "selected" : ""
                    }`}
                    type="button"
                    onClick={() => setSelectedCategory(allCategoriesFilter)}
                  >
                    {allCategoriesFilter} ({totalProductCount})
                  </button>
                  {categories.map((category) => (
                    <button
                      className={`menu-category-tab ${
                        effectiveSelectedCategory === category.name ? "selected" : ""
                      }`}
                      key={category.id}
                      type="button"
                      onClick={() => setSelectedCategory(category.name)}
                    >
                      {category.name} ({category.products.length})
                    </button>
                  ))}
                </div>
              ) : null}
              {!hasAnyProducts ? (
                <div className="menu-empty-state">
                  <strong>Menü henüz hazır değil.</strong>
                  <p>Bu işletme ürünlerini eklediğinde burada görünecek.</p>
                </div>
              ) : visibleCategories.length === 0 ? (
                <div className="menu-empty-state">
                  <strong>Bu kategoride ürün yok.</strong>
                  <p>Başka bir kategori seçerek menüye göz atabilirsiniz.</p>
                </div>
              ) : null}
              {visibleCategories.map((category) => (
                <div className="category" key={category.id}>
                  <h3 className="category-title">{category.name}</h3>
                  <div className="products">
                    {category.products.map((product) => (
                      <article className="product-card menu-product-card" key={product.id}>
                        <div className="product-card-body">
                          {product.imageUrl ? (
                            <img
                              alt={product.name}
                              className="product-card-image"
                              src={product.imageUrl}
                            />
                          ) : (
                            <span className="product-image-placeholder">
                              {product.imageLabel || category.name}
                            </span>
                          )}
                          <div className="product-copy">
                            <p className="product-name">{product.name}</p>
                            {product.description ? (
                              <p className="product-description">{product.description}</p>
                            ) : null}
                            <span className="price">{formatPrice(product.price)}</span>
                          </div>
                        </div>
                        <button
                          className="add-button"
                          disabled={!isOrderingOpen || isRecordingOrder}
                          type="button"
                          onClick={() => addToCart(product)}
                        >
                          {isOrderingOpen ? "Sepete Ekle" : "Kapalı"}
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            <aside
              className={`order-panel ${
                cart.length > 0 && showCartOnMobile ? "" : "mobile-cart-hidden"
              }`}
              ref={cartSectionRef}
            >
              <div className="order-inner section order-card">
                <div className="section-title">
                  <h2>Sepetim</h2>
                  <span>{cartItemCount} adet</span>
                </div>
                <div className="cart">
                  {cart.length === 0 ? (
                    <p className="empty-cart">Sepetiniz boş.</p>
                  ) : (
                    cart.map((item) => (
                      <div className="cart-item" key={item.id}>
                        <div className="cart-line">
                          <strong>{item.name}</strong>
                          <span>{formatPrice(item.price * item.quantity)}</span>
                        </div>
                        <div className="cart-actions">
                          <div className="quantity">
                            <button
                              className="quantity-button"
                              disabled={!isOrderingOpen || isRecordingOrder}
                              type="button"
                              onClick={() => decrease(item.id)}
                            >
                              -
                            </button>
                            <strong>{item.quantity}</strong>
                            <button
                              className="quantity-button"
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
                <div className="cart-total">
                  <span>Genel Toplam</span>
                  <span>{formatPrice(total)}</span>
                </div>
                <form className="customer-form" onSubmit={submitOrder}>
                  {!isOrderingOpen ? (
                    <p className="order-rule-warning">
                      Bu işletme şu an sipariş almıyor.
                    </p>
                  ) : minimumOrderWarning ? (
                    <p className="order-rule-warning">{minimumOrderWarning}</p>
                  ) : null}
                  <div className="field">
                    <span className="order-type-label">Sipariş Türü</span>
                    <div className="order-type-toggle" role="group" aria-label="Sipariş türü">
                      <button
                        aria-pressed={orderType === "delivery"}
                        className={`order-type-button ${
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
                        className={`order-type-button ${
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
                  <div className="field">
                    <label htmlFor="fullName">Ad Soyad *</label>
                    <input disabled={isRecordingOrder} id="fullName" value={customer.fullName} onChange={(event) => updateCustomer("fullName", event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="phone">Telefon *</label>
                    <input disabled={isRecordingOrder} id="phone" inputMode="tel" value={customer.phone} onChange={(event) => updateCustomer("phone", event.target.value)} />
                  </div>
                  {orderType === "delivery" ? (
                    <div className="field">
                      <label htmlFor="address">Teslimat Adresi *</label>
                      <textarea disabled={isRecordingOrder} id="address" value={customer.address} onChange={(event) => updateCustomer("address", event.target.value)} />
                    </div>
                  ) : (
                    <p className="pickup-address-hint">
                      Gel-al siparişlerinde adres gerekmez.
                    </p>
                  )}
                  <div className="customer-remember-panel">
                    <label className="customer-remember-option">
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
                  <p className="order-data-note">
                    Siparişinizi hazırlamak ve takip etmek için adınız, telefonunuz,
                    teslimat adresiniz ve sipariş notunuz işletmenin sipariş panelinde
                    siparişin oluşturulmasından 180 gün sonra periyodik olarak silinir.
                    Gel-al siparişlerinde adres kaydedilmez.
                  </p>
                  <div className="field">
                    <label htmlFor="note">Sipariş Notu</label>
                    <textarea disabled={isRecordingOrder} id="note" value={customer.note} onChange={(event) => updateCustomer("note", event.target.value)} />
                  </div>
                  {warning ? <p className="alert">{warning}</p> : null}
                  {orderRecordWarning ? (
                    <div
                      className={`order-record-fallback${
                        orderRecoveryMode === "uncertain"
                          ? " order-record-uncertain"
                          : ""
                      }`}
                    >
                      <p>{orderRecordWarning}</p>
                      {orderRecoveryMode === "uncertain" ? (
                        <button
                          className="submit-button order-retry-button"
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
                          className="submit-button secondary-whatsapp-button"
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
                    className="submit-button"
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
                className="mobile-cart-shortcut"
                type="button"
                onClick={scrollToCart}
              >
                <span>
                  <strong>Sepette {cartItemCount} ürün</strong>
                  <small>Toplam: {formatPrice(total)}</small>
                </span>
                <b>Sepete Git</b>
              </button>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
