"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  clearBrowserAuthSession,
  getValidAccessToken,
} from "../../lib/browser-auth-session";
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
  fetchBusinessOrders,
  updateBusinessOrderStatus,
  type BusinessOrder,
  type OrderStatus,
} from "../../lib/supabase-orders";

const sessionKey = "yerel-siparis-business-session";
const renewalIban = "TR41 0006 2000 4320 0006 2872 06";
const renewalRecipient = "Barış Yerlikaya";
const renewalDescription = "sipariş web sitesi üyelik yenileme ücreti";
const renewalSupportWhatsapp = "https://wa.me/905365857147";

const orderStatusLabels: Record<OrderStatus, string> = {
  new: "Yeni",
  preparing: "Hazırlanıyor",
  ready: "Hazır",
  delivered: "Teslim edildi",
  cancelled: "İptal edildi",
};

const orderStatusOptions = Object.entries(orderStatusLabels) as [
  OrderStatus,
  string,
][];

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
  category: "",
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
  return {
    name: product.name,
    price: String(product.price),
    description: product.description ?? "",
    category: product.category ?? "",
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
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [profileForm, setProfileForm] = useState<ProfileForm>(emptyProfileForm);
  const [editingProductId, setEditingProductId] = useState("");
  const [expandedProductId, setExpandedProductId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileUploadStatus, setProfileUploadStatus] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("Tüm ürünler");
  const [selectedOrderStatusFilter, setSelectedOrderStatusFilter] =
    useState<OrderStatus | "all">("all");
  const [expandedOrderId, setExpandedOrderId] = useState("");
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
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
    if (selectedCategoryFilter === "Tüm ürünler") return sortedProducts;
    return sortedProducts.filter(
      (product) => getProductCategory(product) === selectedCategoryFilter,
    );
  }, [sortedProducts, selectedCategoryFilter]);
  const activeProductCount = products.filter((product) => product.isActive).length;
  const passiveProductCount = products.length - activeProductCount;

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

  async function refreshProducts() {
    if (!business) return;
    const token = await getFreshAccessToken();
    if (!token) return;
    const freshProducts = await fetchProductsByBusinessId(business.id, token);
    setProducts(freshProducts);
  }

  async function refreshOrders(statusFilter = selectedOrderStatusFilter) {
    const token = await getFreshAccessToken();
    if (!token) return;

    setIsLoadingOrders(true);
    try {
      const freshOrders = await fetchBusinessOrders(
        token,
        statusFilter === "all" ? undefined : statusFilter,
      );
      setOrders(freshOrders);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Siparişler yüklenirken bir hata oluştu.",
      );
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
      await updateBusinessOrderStatus(orderId, status, token);
      setMessage("Sipariş durumu güncellendi.");
      await refreshOrders();
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
    setSelectedOrderStatusFilter(statusFilter);
    setExpandedOrderId("");
    if (activePanelSection === "orders") {
      void refreshOrders(statusFilter);
    }
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
    window.print();
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingProductId("");
    setSelectedImageFile(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function chooseCategory(category: string) {
    if (!canManageProducts || isSaving || isUploadingImage) return;
    updateForm("category", category);
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
      void refreshOrders();
    }
  }

  function validateForm() {
    const price = Number(form.price);
    const sortOrder = Number(form.sortOrder || 0);

    if (!form.name.trim()) return "Ürün adı boş olamaz.";
    if (!Number.isFinite(price) || price < 0) return "Fiyat geçerli bir sayı olmalıdır.";
    if (!Number.isFinite(sortOrder)) return "Sıralama geçerli bir sayı olmalıdır.";
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

    try {
      const profilePayload = toProfileInput(profileForm);
      if (selectedLogoFile) {
        setProfileUploadStatus("Logo yükleniyor...");
        const uploadedLogoUrl = await uploadBusinessImage(
          business.id,
          selectedLogoFile,
          "logo",
          token,
        );
        profilePayload.logoUrl = uploadedLogoUrl;
        setProfileForm((current) => ({ ...current, logoUrl: uploadedLogoUrl }));
      }
      if (selectedCoverFile) {
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
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "İşletme bilgileri kaydedilirken bir hata oluştu.",
      );
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

    try {
      const payload = toProductInput(
        form,
        editingProductId ? 0 : getNextSortOrder(products),
      );
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
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Ürün kaydedilirken bir hata oluştu.",
      );
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
      <main className="page">
        <div className="shell section">
          <p>Panel yükleniyor...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page panel-qr-print-root">
      <div className="shell">
        <header className="hero panel-hero">
          <div className="hero-content panel-hero-content">
            <div className="panel-hero-top">
              <span className="eyebrow">İşletme Paneli</span>
              <button className="panel-logout-button" type="button" onClick={logout}>
                Çıkış Yap
              </button>
            </div>
            <div className="panel-heading">
              <div>
                <h1>{business?.name ?? "İşletme bulunamadı"}</h1>
                <p>Ürünlerinizi, işletme bilgilerinizi ve sipariş sayfanızı buradan yönetin.</p>
              </div>
              {business ? (
                <span
                  className={`panel-subscription-badge ${
                    canManageProducts ? "active" : "inactive"
                  }`}
                >
                  {subscriptionLabel}
                </span>
              ) : null}
            </div>
            {business ? (
              <div className="panel-summary">
                <span>{business.email || "E-posta eklenmedi"}</span>
                <span>{business.whatsappOrderNumber || "WhatsApp numarasi yok"}</span>
                <span>{business.district || "İlçe yok"} / {business.neighborhood || "Mahalle yok"}</span>
              </div>
            ) : null}
          </div>
        </header>

        {error ? <p className="alert">{error}</p> : null}
        {message ? <p className="alert success">{message}</p> : null}

        {!business ? (
          <section className="section">
            <h2>İşletme bulunamadı</h2>
            <p>Bu kullanıcıya bağlı bir işletme kaydı bulunamadı.</p>
          </section>
        ) : (
          <>
            <nav className="panel-section-tabs" aria-label="Panel bolumleri">
              <button
                className={activePanelSection === "overview" ? "active" : ""}
                type="button"
                onClick={() => switchPanelSection("overview")}
              >
                Genel Bakış
              </button>
              <button
                className={activePanelSection === "products" ? "active" : ""}
                type="button"
                onClick={() => switchPanelSection("products")}
              >
                Ürünler
              </button>
              <button
                className={activePanelSection === "orders" ? "active" : ""}
                type="button"
                onClick={() => switchPanelSection("orders")}
              >
                Siparişler
              </button>
              <button
                className={activePanelSection === "create" ? "active" : ""}
                type="button"
                onClick={() => switchPanelSection("create")}
              >
                Yeni Ürün Ekle
              </button>
              <button
                className={activePanelSection === "profile" ? "active" : ""}
                type="button"
                onClick={() => switchPanelSection("profile")}
              >
                İşletme Bilgileri
              </button>
              <button
                className={activePanelSection === "renewal" ? "active" : ""}
                type="button"
                onClick={() => switchPanelSection("renewal")}
              >
                Üyelik / Ödeme
              </button>
            </nav>

            {activePanelSection === "overview" ? (
              <section className="section panel-section panel-overview-section">
                <div className="section-title">
                  <h2>Genel Bakış</h2>
                  <span>{subscriptionLabel}</span>
                </div>
                <div className="panel-overview-grid">
                  <div className="panel-overview-card">
                    <strong>{business.name}</strong>
                    <span>İşletme adı</span>
                  </div>
                  <div className="panel-overview-card">
                    <strong>{products.length}</strong>
                    <span>Toplam ürün</span>
                  </div>
                  <div className="panel-overview-card">
                    <strong>{activeProductCount}</strong>
                    <span>Aktif ürün</span>
                  </div>
                  <div className="panel-overview-card">
                    <strong>{passiveProductCount}</strong>
                    <span>Pasif ürün</span>
                  </div>
                  <div className="panel-overview-card">
                    <strong>{categorySummaries.length}</strong>
                    <span>Kategori</span>
                  </div>
                </div>

                <section
                  className="panel-qr-card panel-qr-print-target"
                  aria-labelledby="panel-qr-title"
                >
                  <div className="panel-qr-copy">
                    <span className="panel-qr-kicker">Müşteri sipariş sayfası</span>
                    <h3 id="panel-qr-title">Müşteri QR Kodu</h3>
                    <p>
                      Müşteriler bu kodu okutarak doğrudan sipariş sayfanıza ulaşır.
                    </p>
                    <strong className="panel-qr-print-business-name">
                      {business.name}
                    </strong>
                    <p className="panel-qr-print-instruction">
                      Sipariş için QR kodu okutun
                    </p>
                  </div>

                  {business.slug ? (
                    <>
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
                    </>
                  ) : (
                    <p className="panel-qr-error">
                      QR kod için işletme bağlantısı bulunamadı.
                    </p>
                  )}
                </section>

                <div className="panel-overview-actions">
                  <button type="button" onClick={() => switchPanelSection("products")}>
                    Ürünleri Yönet
                  </button>
                  <button type="button" onClick={() => switchPanelSection("orders")}>
                    Siparişleri Yönet
                  </button>
                  <button type="button" onClick={() => switchPanelSection("create")}>
                    Yeni Ürün Ekle
                  </button>
                  <button type="button" onClick={() => switchPanelSection("profile")}>
                    İşletme Bilgilerini Düzenle
                  </button>
                  <button type="button" onClick={() => switchPanelSection("renewal")}>
                    Üyelik Bilgileri
                  </button>
                </div>
              </section>
            ) : null}

            {activePanelSection === "orders" ? (
              <section className="section panel-section panel-orders-section">
                <div className="section-title">
                  <h2>Siparişler</h2>
                  <span>{orders.length} kayıt</span>
                </div>

                <div className="panel-order-toolbar">
                  <label className="field">
                    <span>Durum filtresi</span>
                    <select
                      value={selectedOrderStatusFilter}
                      onChange={(event) =>
                        changeOrderStatusFilter(
                          event.target.value as OrderStatus | "all",
                        )
                      }
                    >
                      <option value="all">Tüm siparişler</option>
                      {orderStatusOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="submit-button panel-secondary-action panel-order-refresh"
                    disabled={isLoadingOrders}
                    type="button"
                    onClick={() => refreshOrders()}
                  >
                    {isLoadingOrders ? "Yükleniyor..." : "Listeyi Yenile"}
                  </button>
                </div>

                {isLoadingOrders ? (
                  <p className="empty-cart">Siparişler yükleniyor...</p>
                ) : orders.length === 0 ? (
                  <p className="empty-cart">Henüz sipariş yok.</p>
                ) : (
                  <div className="panel-order-list">
                    {orders.map((order) => {
                      const isExpanded = expandedOrderId === order.id;
                      const orderTypeLabel =
                        order.orderType === "delivery" ? "Teslimat" : "Gel-al";

                      return (
                        <article className="panel-order-card" key={order.id}>
                          <button
                            aria-expanded={isExpanded}
                            className="panel-order-row"
                            type="button"
                            onClick={() =>
                              setExpandedOrderId(isExpanded ? "" : order.id)
                            }
                          >
                            <span className="panel-order-main">
                              <strong>#{order.orderNumber}</strong>
                              <span>{order.customerName}</span>
                            </span>
                            <span className="panel-order-meta">
                              <strong>{formatPrice(order.totalAmount)}</strong>
                              <span>{formatDateTime(order.createdAt)}</span>
                            </span>
                            <span
                              className={`order-status-badge order-status-${order.status}`}
                            >
                              {orderStatusLabels[order.status]}
                            </span>
                            <span className="panel-order-toggle">
                              {isExpanded ? "Kapat" : "Detay"}
                            </span>
                          </button>

                          {isExpanded ? (
                            <div className="panel-order-detail">
                              <div className="panel-order-detail-grid">
                                <p>
                                  <strong>Telefon</strong>
                                  <span>{order.customerPhone}</span>
                                </p>
                                <p>
                                  <strong>Sipariş türü</strong>
                                  <span>{orderTypeLabel}</span>
                                </p>
                                <p>
                                  <strong>Durum</strong>
                                  <select
                                    disabled={updatingOrderId === order.id}
                                    value={order.status}
                                    onChange={(event) =>
                                      changeOrderStatus(
                                        order.id,
                                        event.target.value as OrderStatus,
                                      )
                                    }
                                  >
                                    {orderStatusOptions.map(([value, label]) => (
                                      <option key={value} value={value}>
                                        {label}
                                      </option>
                                    ))}
                                  </select>
                                </p>
                              </div>

                              <div className="panel-order-address">
                                <strong>
                                  {order.orderType === "delivery"
                                    ? "Teslimat adresi"
                                    : "Gel-al siparişi"}
                                </strong>
                                <span>
                                  {order.orderType === "delivery"
                                    ? order.customerAddress || "Adres belirtilmedi."
                                    : "Müşteri siparişi işletmeden teslim alacak."}
                                </span>
                              </div>

                              {order.customerNote ? (
                                <div className="panel-order-note">
                                  <strong>Müşteri notu</strong>
                                  <span>{order.customerNote}</span>
                                </div>
                              ) : null}

                              <div className="panel-order-items">
                                {order.items.map((item) => (
                                  <div className="panel-order-item" key={item.id}>
                                    <span>
                                      <strong>{item.productName}</strong>
                                      <small>
                                        {item.quantity} x {formatPrice(item.unitPrice)}
                                      </small>
                                    </span>
                                    <b>{formatPrice(item.lineTotal)}</b>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}

            {activePanelSection === "renewal" ? (
            <section
              className={`section panel-section renewal-section ${
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
            <section className="section panel-section">
              <div className="section-title">
                <h2>İşletme Bilgileri</h2>
                <span>Profil ve adres</span>
              </div>

              <form className="customer-form panel-form" onSubmit={handleProfileSubmit}>
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

                <div className="field">
                  <label htmlFor="businessCity">İl</label>
                  <input
                    disabled={isSavingProfile}
                    id="businessCity"
                    value={profileForm.city}
                    onChange={(event) =>
                      updateProfileForm("city", event.target.value)
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="businessDistrict">İlçe</label>
                  <input
                    disabled={isSavingProfile}
                    id="businessDistrict"
                    value={profileForm.district}
                    onChange={(event) =>
                      updateProfileForm("district", event.target.value)
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="businessNeighborhood">Mahalle</label>
                  <input
                    disabled={isSavingProfile}
                    id="businessNeighborhood"
                    value={profileForm.neighborhood}
                    onChange={(event) =>
                      updateProfileForm("neighborhood", event.target.value)
                    }
                  />
                </div>

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

                <div className="section-title panel-form-subtitle">
                  <h3>Sipariş Bilgileri</h3>
                  <span>Müşteri sayfasında kullanılacak ayarlar</span>
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
                  <label htmlFor="businessCoverUrl">Kapak g?rseli URL</label>
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
              </form>
            </section>
            ) : null}

            {(activePanelSection === "create" ||
              activePanelSection === "products") ? (
            <div className="layout panel-layout">
            {(activePanelSection === "create" || editingProductId) ? (
            <section className="section panel-section">
              <div className="section-title">
                <h2>Ürün Formu</h2>
                <span>{editingProductId ? "Düzenleme" : "Yeni ürün"}</span>
              </div>

              {!canManageProducts ? (
                <p className="alert panel-warning">
                  Aboneli?iniz aktif de?il. ?r?n ekleme ve d?zenleme i?lemleri kapal?..
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
                  <input
                    disabled={!canManageProducts || isSaving || isUploadingImage}
                    id="category"
                    value={form.category}
                    onChange={(event) => updateForm("category", event.target.value)}
                  />
                  {categorySummaries.length > 0 ? (
                    <div className="panel-category-picker" aria-label="Mevcut kategoriler">
                      <span>Mevcut kategoriler</span>
                      <div className="panel-category-chips">
                        {categorySummaries.map((category) => (
                          <button
                            className="panel-category-chip"
                            disabled={!canManageProducts || isSaving || isUploadingImage}
                            key={category.name}
                            type="button"
                            onClick={() => chooseCategory(category.name)}
                          >
                            {category.name} ({category.count})
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <span className="field-help">
                      Yeni kategori yazabilir veya ürün ekledikçe buradan hızlı seçim yapabilirsiniz.
                    </span>
                  )}
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
            <section className="section panel-section">
              <div className="section-title">
                <h2>Ürünler</h2>
                <span>
                  {filteredProducts.length} / {products.length} kayit
                </span>
              </div>

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
                                disabled={!canManageProducts || isSaving || index === 0}
                                type="button"
                                onClick={() => moveProduct(product, "up")}
                              >
                                Yukarı Taşı
                              </button>
                              <button
                                disabled={
                                  !canManageProducts ||
                                  isSaving ||
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
          </>
        )}
      </div>
    </main>
  );
}
