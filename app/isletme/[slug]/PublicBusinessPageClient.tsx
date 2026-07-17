"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PublicOrderCheckout, {
  type PublicOrderCartItem as CartItem,
  type PublicOrderCustomer as Customer,
  type PublicOrderRecoveryMode as OrderRecoveryMode,
  type PublicOrderType as OrderType,
} from "../../../components/PublicOrderCheckout";
import PublicOrderMenu from "../../../components/PublicOrderMenu";
import type { Business, Product, ProductCategory } from "../../../lib/businesses";
import { getAccessMessage } from "../../../lib/subscription";
import {
  getProductCategories,
  normalizeProductCategory,
  type StandardProductCategory,
} from "../../../lib/product-categories";
import {
  getPaymentMethodDisplayLabel,
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
  fetchPublicProductsByBusinessSlug,
  type BusinessProduct,
} from "../../../lib/supabase-business";

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

type PublicOrderView = "menu" | "checkout";

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
const checkoutHistoryStateKey = "yerelSiparisCheckout";

function formatPrice(price: number) {
  return `${price.toLocaleString("tr-TR")} TL`;
}

function normalizeProductSearchValue(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

export default function PublicBusinessPageClient({
  slug,
  initialBusiness,
}: {
  slug: string;
  initialBusiness: Business;
}) {
  const business = initialBusiness;
  const [supabaseCatalog, setSupabaseCatalog] = useState<ProductCatalog | null>(
    null,
  );
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
  const [verifiedWhatsAppMessage, setVerifiedWhatsAppMessage] = useState("");
  const [isRecordingOrder, setIsRecordingOrder] = useState(false);
  const [view, setView] = useState<PublicOrderView>("menu");
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORY_KEY);
  const [searchQuery, setSearchQuery] = useState("");
  const cartSectionRef = useRef<HTMLElement | null>(null);
  const cartCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const cartTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pendingOrderAttemptRef = useRef<PendingOrderAttempt | null>(null);
  const activeOrderRequestRef = useRef<PendingOrderAttempt | null>(null);
  const isRecordingOrderRef = useRef(false);
  const checkoutHistoryEntryRef = useRef(false);

  const returnToMenu = useCallback(() => {
    checkoutHistoryEntryRef.current = false;
    setView("menu");
    window.setTimeout(() => {
      cartTriggerRef.current?.focus();
    }, 0);
  }, []);

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

    setSupabaseCatalog(null);
    setPaymentMethod("");
    setPaymentMethodError("");

    async function loadBusinessPage() {
      setPaymentMethod(
        getInitialPaymentMethod(
          getPaymentMethodModeOrDefault(initialBusiness.paymentMethodMode),
        ),
      );

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
  }, [initialBusiness.paymentMethodMode, slug]);

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 759px)");
    const updateViewport = () => setIsMobileViewport(mobileViewport.matches);
    updateViewport();
    mobileViewport.addEventListener("change", updateViewport);
    return () => mobileViewport.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      if (!checkoutHistoryEntryRef.current) return;
      returnToMenu();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [returnToMenu]);

  useEffect(() => {
    if (view !== "checkout" || cart.length > 0) return;
    if (checkoutHistoryEntryRef.current) {
      window.history.back();
      return;
    }
    returnToMenu();
  }, [cart.length, returnToMenu, view]);

  useEffect(() => {
    if (view !== "checkout") return;
    cartCloseButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeCheckout();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [view]);

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
      selectedCategory === ALL_CATEGORY_KEY
    ) {
      return;
    }

    const selectedCategoryExists = categories.some(
      (category) => category.filterKey === selectedCategory,
    );
    if (!selectedCategoryExists) setSelectedCategory(ALL_CATEGORY_KEY);
  }, [categories, selectedCategory]);

  function openCheckout() {
    if (view === "checkout" || cart.length === 0) return;
    if (!checkoutHistoryEntryRef.current) {
      const currentHistoryState =
        typeof window.history.state === "object" && window.history.state !== null
          ? (window.history.state as Record<string, unknown>)
          : {};
      window.history.pushState(
        { ...currentHistoryState, [checkoutHistoryStateKey]: true },
        "",
        window.location.href,
      );
      checkoutHistoryEntryRef.current = true;
    }
    setView("checkout");
  }

  function closeCheckout() {
    if (view !== "checkout") return;
    if (checkoutHistoryEntryRef.current) {
      window.history.back();
      return;
    }
    returnToMenu();
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
  const categoryFilteredCategories: ProductCategory[] =
    selectedCategory === ALL_CATEGORY_KEY
      ? allProducts.length > 0
        ? [{ id: ALL_CATEGORY_KEY, name: "", products: allProducts }]
        : []
      : categories.filter(
          (category) => category.filterKey === selectedCategory,
        );
  const normalizedSearchQuery = normalizeProductSearchValue(searchQuery);
  const standardCategoryNamesByProductId = new Map(
    categories.flatMap((category) =>
      category.products.map(
        (product) => [product.id, category.name] as const,
      ),
    ),
  );
  const visibleCategories: ProductCategory[] = normalizedSearchQuery
    ? categoryFilteredCategories.flatMap((category) => {
        const products = category.products.filter((product) =>
          normalizeProductSearchValue(
            [
              product.name,
              product.description,
              standardCategoryNamesByProductId.get(product.id),
            ]
              .filter(Boolean)
              .join(" "),
          ).includes(normalizedSearchQuery),
        );

        return products.length > 0 ? [{ ...category, products }] : [];
      })
    : categoryFilteredCategories;
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
        backgroundImage: `linear-gradient(135deg, rgba(23, 33, 27, 0.68), rgba(var(--primary-hover-rgb), 0.78)), url("${coverImageUrl.replaceAll('"', "%22")}")`,
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
    setVerifiedWhatsAppMessage("");
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

  function createMessage(attempt: PendingOrderAttempt, orderNumber: number) {
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
      `Ödeme Yöntemi: ${getPaymentMethodDisplayLabel(
        attempt.payload.paymentMethod,
      )}`,
      ...(attempt.message.orderType === "delivery"
        ? [`Adres: ${attempt.message.customer.address}`]
        : []),
      `Not: ${attempt.message.customer.note || "-"}`,
    ];

    return [
      "Yeni Sipariş",
      `Sipariş No: #${orderNumber}`,
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

    window.location.assign(webLink);
    return true;
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRecordingOrderRef.current) return;
    setOrderRecordWarning("");
    setOrderRecoveryMode("none");
    setVerifiedWhatsAppMessage("");
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
      if (!Number.isSafeInteger(result.orderNumber) || result.orderNumber <= 0) {
        throw new PublicOrderRequestError(
          "uncertain",
          "INVALID_ORDER_RESPONSE",
          200,
        );
      }
      pendingOrderAttemptRef.current = null;
      setWarning("");
      const whatsappOpened = sendWhatsAppMessage(
        createMessage(attempt, result.orderNumber),
        preparedWhatsAppWindow,
      );
      if (!whatsappOpened) {
        setOrderRecoveryMode("saved");
        setVerifiedWhatsAppMessage(createMessage(attempt, result.orderNumber));
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
        setVerifiedWhatsAppMessage("");
        setOrderRecordWarning(
          "Sipariş bilgileri bu deneme sırasında değişti. Lütfen sayfayı yenileyip tekrar deneyin.",
        );
      } else {
        setOrderRecoveryMode("definitive");
        setOrderRecordWarning(
          "Sipariş panel kaydı oluşturulamadı. Lütfen tekrar deneyin.",
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
      if (!Number.isSafeInteger(result.orderNumber) || result.orderNumber <= 0) {
        throw new PublicOrderRequestError(
          "uncertain",
          "INVALID_ORDER_RESPONSE",
          200,
        );
      }
      pendingOrderAttemptRef.current = null;
      setOrderRecoveryMode("saved");
      setVerifiedWhatsAppMessage(createMessage(attempt, result.orderNumber));
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
          "Sipariş sonucu hâlâ doğrulanamadı. Aynı siparişi yeniden kontrol edin.",
        );
      } else if (
        error instanceof PublicOrderRequestError &&
        error.code === "IDEMPOTENCY_CONFLICT"
      ) {
        setOrderRecoveryMode("conflict");
        setVerifiedWhatsAppMessage("");
        setOrderRecordWarning(
          "Sipariş bilgileri bu deneme sırasında değişti. Lütfen sayfayı yenileyip tekrar deneyin.",
        );
      } else {
        setOrderRecoveryMode("definitive");
        setOrderRecordWarning(
          "Sipariş kaydı oluşturulamadı. Lütfen tekrar deneyin.",
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
        {view === "menu" ? (
          <PublicOrderMenu
            accessMessage={accessMessage}
            addressText={addressText}
            allCategoriesLabel={allCategoriesLabel}
            allCategoryKey={ALL_CATEGORY_KEY}
            business={displayBusiness}
            cart={cart}
            cartItemCount={cartItemCount}
            cartLength={cart.length}
            cartTriggerRef={cartTriggerRef}
            categories={categories}
            formatPrice={formatPrice}
            hasAnyProducts={hasAnyProducts}
            heroStyle={heroStyle}
            isOrderingOpen={isOrderingOpen}
            isRecordingOrder={isRecordingOrder}
            logoText={getLogoText(currentBusiness)}
            orderInfoItems={orderInfoItems}
            orderNote={orderNote}
            searchQuery={searchQuery}
            selectedCategory={selectedCategory}
            total={total}
            totalProductCount={totalProductCount}
            visibleCategories={visibleCategories}
            onAddItem={addToCart}
            onDecreaseItem={decrease}
            onIncreaseItem={increase}
            onOpenCheckout={openCheckout}
            onSearchQueryChange={setSearchQuery}
            onSelectCategory={setSelectedCategory}
          />
        ) : (
          <PublicOrderCheckout
            cart={cart}
            cartCloseButtonRef={cartCloseButtonRef}
            cartItemCount={cartItemCount}
            cartSectionRef={cartSectionRef}
            customer={customer}
            verifiedWhatsAppMessage={verifiedWhatsAppMessage}
            fixedPaymentOption={fixedPaymentOption}
            formatPrice={formatPrice}
            hasSavedCustomerDetails={hasSavedCustomerDetails}
            isMobileViewport={isMobileViewport}
            isOrderSubmitDisabled={isOrderSubmitDisabled}
            isOrderingOpen={isOrderingOpen}
            isRecordingOrder={isRecordingOrder}
            minimumOrderWarning={minimumOrderWarning}
            orderRecordWarning={orderRecordWarning}
            orderRecoveryMode={orderRecoveryMode}
            orderType={orderType}
            paymentMethod={paymentMethod}
            paymentMethodError={paymentMethodError}
            rememberCustomerDetails={rememberCustomerDetails}
            total={total}
            warning={warning}
            onClearSavedCustomerDetails={clearSavedCustomerDetails}
            onCloseCheckout={closeCheckout}
            onDecreaseItem={decrease}
            onIncreaseItem={increase}
            onRetryPendingOrder={retryPendingOrder}
            onSendVerifiedWhatsApp={() => {
              if (
                orderRecoveryMode !== "saved" ||
                !verifiedWhatsAppMessage
              ) {
                return;
              }
              setOrderRecordWarning("");
              sendWhatsAppMessage(verifiedWhatsAppMessage);
            }}
            onSubmitOrder={submitOrder}
            onToggleRememberCustomerDetails={toggleRememberCustomerDetails}
            onUpdateCustomer={updateCustomer}
            onUpdateOrderType={(nextOrderType) => {
              setWarning("");
              clearPendingOrderAttempt();
              setOrderType(nextOrderType);
            }}
            onUpdatePaymentMethod={updatePaymentMethod}
          />
        )}
      </div>
    </main>
  );
}
