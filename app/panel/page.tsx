"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  clearActiveBusinessSlug,
  createSlug,
  mergeBusinessIntoStorage,
  readBusinessesFromStorage,
  writeBusinessesToStorage,
} from "../../lib/business-storage";
import type { Business, Product } from "../../lib/businesses";
import {
  deleteProductFromSupabase,
  getCurrentBusinessFromSupabaseSession,
  saveBusinessDetailsToSupabase,
  signOutFromSupabase,
  upsertProductInSupabase,
} from "../../lib/supabase/business-service";

type BusinessForm = {
  name: string;
  whatsappOrderNumber: string;
  description: string;
  logoText: string;
  coverImage: string;
};

type ProductForm = {
  name: string;
  price: string;
  category: string;
  description: string;
  imageLabel: string;
  isActive: boolean;
};

type ProductWithCategory = Product & { category: string };

const emptyProductForm: ProductForm = {
  name: "",
  price: "",
  category: "",
  description: "",
  imageLabel: "",
  isActive: true,
};

function formatPrice(price: number) {
  return `${price.toLocaleString("tr-TR")} TL`;
}

function flattenProducts(business?: Business): ProductWithCategory[] {
  if (!business) return [];
  return business.productCategories.flatMap((category) =>
    category.products.map((product) => ({
      ...product,
      category: category.name,
      isActive: product.isActive !== false,
    })),
  );
}

function removeProduct(business: Business, productId: string): Business {
  return {
    ...business,
    productCategories: business.productCategories
      .map((category) => ({
        ...category,
        products: category.products.filter((product) => product.id !== productId),
      }))
      .filter((category) => category.products.length > 0),
  };
}

function upsertProduct(
  business: Business,
  product: Product,
  categoryName: string,
): Business {
  const cleanedBusiness = removeProduct(business, product.id);
  const existingCategory = cleanedBusiness.productCategories.find(
    (category) =>
      category.name.toLocaleLowerCase("tr-TR") ===
      categoryName.toLocaleLowerCase("tr-TR"),
  );

  if (existingCategory) {
    return {
      ...cleanedBusiness,
      productCategories: cleanedBusiness.productCategories.map((category) =>
        category.id === existingCategory.id
          ? { ...category, products: [product, ...category.products] }
          : category,
      ),
    };
  }

  return {
    ...cleanedBusiness,
    productCategories: [
      { id: createSlug(categoryName), name: categoryName, products: [product] },
      ...cleanedBusiness.productCategories,
    ],
  };
}

export default function OwnerPanelPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeSlug, setActiveSlug] = useState("");
  const [businessForm, setBusinessForm] = useState<BusinessForm>({
    name: "",
    whatsappOrderNumber: "",
    description: "",
    logoText: "",
    coverImage: "",
  });
  const [productForm, setProductForm] = useState<ProductForm>(emptyProductForm);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadPanelBusiness() {
      try {
        const supabaseBusiness = await getCurrentBusinessFromSupabaseSession();

        if (!isMounted) return;

        if (!supabaseBusiness) {
          clearActiveBusinessSlug();
          setBusinesses([]);
          setActiveSlug("");
          setMessage("Supabase oturumu var ancak bu kullanıcıya bağlı işletme bulunamadı.");
          return;
        }

        const nextBusinesses = mergeBusinessIntoStorage(supabaseBusiness);
        setBusinesses(nextBusinesses);
        setActiveSlug(supabaseBusiness.slug);
        setBusinessForm({
          name: supabaseBusiness.name,
          whatsappOrderNumber: supabaseBusiness.whatsappOrderNumber,
          description: supabaseBusiness.description,
          logoText: supabaseBusiness.logoText,
          coverImage: supabaseBusiness.coverImage ?? "",
        });
      } catch (error) {
        if (!isMounted) return;

        clearActiveBusinessSlug();
        setBusinesses(readBusinessesFromStorage());
        setActiveSlug("");
        setMessage(
          error instanceof Error
            ? `Supabase oturumu okunamadı: ${error.message}`
            : "Supabase oturumu okunamadı.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadPanelBusiness();

    return () => {
      isMounted = false;
    };
  }, []);

  const business = useMemo(
    () => businesses.find((item) => item.slug === activeSlug),
    [businesses, activeSlug],
  );

  const products = useMemo(() => flattenProducts(business), [business]);
  const categories = useMemo(
    () => Array.from(new Set(products.map((product) => product.category))),
    [products],
  );

  const qrLink = business ? `http://localhost:3000/isletme/${business.slug}` : "";
  const qrImageUrl = qrLink
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrLink)}`
    : "";

  function saveToLocalCache(nextBusinesses: Business[]) {
    setBusinesses(nextBusinesses);
    writeBusinessesToStorage(nextBusinesses);
  }

  function updateBusinessForm(field: keyof BusinessForm, value: string) {
    setMessage("");
    setBusinessForm((current) => ({ ...current, [field]: value }));
  }

  function updateProductForm(field: keyof ProductForm, value: string | boolean) {
    setMessage("");
    setProductForm((current) => ({ ...current, [field]: value }));
  }

  async function handleLogout() {
    try {
      await signOutFromSupabase();
    } finally {
      clearActiveBusinessSlug();
      window.location.href = "/giris";
    }
  }

  async function handleBusinessSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!business) return;

    if (!businessForm.name.trim() || !businessForm.whatsappOrderNumber.trim()) {
      setMessage("İşletme adı ve WhatsApp sipariş numarası zorunludur.");
      return;
    }

    const nextBusiness: Business = { ...business, ...businessForm };
    const nextBusinesses = businesses.map((item) =>
      item.slug === business.slug ? nextBusiness : item,
    );

    try {
      setIsSaving(true);
      const supabaseBusiness = await saveBusinessDetailsToSupabase(nextBusiness);
      saveToLocalCache(
        supabaseBusiness
          ? businesses.map((item) =>
              item.slug === business.slug ? supabaseBusiness : item,
            )
          : nextBusinesses,
      );
      setMessage("İşletme bilgileri Supabase'e kaydedildi.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Supabase kaydı başarısız: ${error.message}`
          : "Supabase kaydı başarısız.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function startProductEdit(product: ProductWithCategory) {
    setEditingProductId(product.id);
    setProductForm({
      name: product.name,
      price: String(product.price),
      category: product.category,
      description: product.description,
      imageLabel: product.imageLabel,
      isActive: product.isActive !== false,
    });
    setMessage("");
  }

  function resetProductForm() {
    setEditingProductId(null);
    setProductForm(emptyProductForm);
  }

  async function handleProductSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!business) return;

    const price = Number(productForm.price);
    if (
      !productForm.name.trim() ||
      !productForm.category.trim() ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      setMessage("Ürün adı, geçerli fiyat ve kategori zorunludur.");
      return;
    }

    const product: Product = {
      id: editingProductId ?? createSlug(productForm.name),
      name: productForm.name.trim(),
      price,
      description: productForm.description.trim(),
      imageLabel: productForm.imageLabel.trim() || productForm.name.trim(),
      isActive: productForm.isActive,
    };

    const nextBusiness = upsertProduct(
      business,
      product,
      productForm.category.trim(),
    );

    try {
      setIsSaving(true);
      const supabaseBusiness = await upsertProductInSupabase(
        nextBusiness,
        product,
        productForm.category.trim(),
      );
      const cachedBusiness = supabaseBusiness ?? nextBusiness;
      saveToLocalCache(
        businesses.map((item) =>
          item.slug === business.slug ? cachedBusiness : item,
        ),
      );
      setMessage(
        editingProductId
          ? "Ürün Supabase products tablosunda güncellendi."
          : "Ürün Supabase products tablosuna eklendi.",
      );
      resetProductForm();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Supabase ürün kaydı başarısız: ${error.message}`
          : "Supabase ürün kaydı başarısız.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteProduct(productId: string) {
    if (!business) return;

    const nextBusiness = removeProduct(business, productId);

    try {
      setIsSaving(true);
      const supabaseBusiness = await deleteProductFromSupabase(business, productId);
      saveToLocalCache(
        businesses.map((item) =>
          item.slug === business.slug ? supabaseBusiness ?? nextBusiness : item,
        ),
      );
      setMessage("Ürün Supabase products tablosundan silindi.");
      if (editingProductId === productId) resetProductForm();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Supabase ürün silme başarısız: ${error.message}`
          : "Supabase ürün silme başarısız.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleProduct(product: ProductWithCategory) {
    if (!business) return;
    const nextProduct: Product = {
      id: product.id,
      name: product.name,
      price: product.price,
      description: product.description,
      imageLabel: product.imageLabel,
      isActive: product.isActive === false,
    };

    const nextBusiness = upsertProduct(business, nextProduct, product.category);

    try {
      setIsSaving(true);
      const supabaseBusiness = await upsertProductInSupabase(
        nextBusiness,
        nextProduct,
        product.category,
      );
      saveToLocalCache(
        businesses.map((item) =>
          item.slug === business.slug ? supabaseBusiness ?? nextBusiness : item,
        ),
      );
      setMessage(
        nextProduct.isActive
          ? "Ürün Supabase'de aktif edildi."
          : "Ürün Supabase'de pasif edildi.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Supabase aktif/pasif kaydı başarısız: ${error.message}`
          : "Supabase aktif/pasif kaydı başarısız.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function copyQrLink() {
    if (!qrLink) return;
    await navigator.clipboard.writeText(qrLink);
    setMessage("İşletme linki kopyalandı.");
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[#F5F7FA] px-4 py-10 text-[#333333]">
        <div className="mx-auto max-w-md rounded-[28px] bg-white p-6 text-center shadow-[0_12px_30px_rgba(45,42,116,0.08)]">
          <h1 className="text-3xl font-black text-[#2D2A74]">
            Panel yükleniyor
          </h1>
          <p className="mt-3 leading-7">
            Supabase oturumu kontrol ediliyor.
          </p>
        </div>
      </main>
    );
  }

  if (!business) {
    return (
      <main className="min-h-screen bg-[#F5F7FA] px-4 py-10 text-[#333333]">
        <div className="mx-auto max-w-md rounded-[28px] bg-white p-6 text-center shadow-[0_12px_30px_rgba(45,42,116,0.08)]">
          <h1 className="text-3xl font-black text-[#2D2A74]">
            Giriş gerekli
          </h1>
          <p className="mt-3 leading-7">
            İşletme panelini kullanmak için önce işletme hesabıyla giriş yapın.
          </p>
          {message ? (
            <p className="mt-4 rounded-2xl bg-[#F5F7FA] p-3 text-sm font-bold text-[#2D2A74]">
              {message}
            </p>
          ) : null}
          <Link
            className="mt-5 flex min-h-12 items-center justify-center rounded-2xl bg-[#0D7CC2] px-4 font-black text-white"
            href="/giris"
          >
            Giriş Yap
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#F5F7FA] px-3 py-4 text-[#333333] sm:px-5 sm:py-8">
      <div className="mx-auto w-full max-w-7xl">
        <header className="rounded-[28px] bg-white p-5 shadow-[0_12px_30px_rgba(45,42,116,0.08)] sm:p-8">
          <p className="text-sm font-black uppercase tracking-wide text-[#0D7CC2]">
            İşletme Paneli
          </p>
          <h1 className="mt-2 text-4xl font-black text-[#2D2A74]">
            {business.name}
          </h1>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <button
              className="min-h-12 rounded-2xl bg-[#0D7CC2] px-4 font-black text-white"
              type="button"
              onClick={() => setQrOpen(true)}
            >
              QR Kod Oluştur
            </button>
            <Link
              className="flex min-h-12 items-center justify-center rounded-2xl bg-[#F5F7FA] px-4 font-black text-[#2D2A74]"
              href={`/isletme/${business.slug}`}
            >
              Sayfayı Aç
            </Link>
            <button
              className="min-h-12 rounded-2xl bg-[#F5F7FA] px-4 font-black text-[#2D2A74]"
              type="button"
              onClick={handleLogout}
            >
              Çıkış Yap
            </button>
          </div>
        </header>

        {message ? (
          <p className="mt-5 rounded-2xl bg-white p-4 font-bold text-[#2D2A74] shadow-sm">
            {message}
          </p>
        ) : null}

        {isSaving ? (
          <p className="mt-3 rounded-2xl bg-white p-4 font-bold text-[#0D7CC2] shadow-sm">
            Supabase kaydı yapılıyor...
          </p>
        ) : null}

        <div className="mt-5 grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)] xl:items-start">
          <section className="rounded-[28px] bg-white p-4 shadow-[0_12px_30px_rgba(45,42,116,0.08)] sm:p-5 xl:sticky xl:top-5">
            <h2 className="text-2xl font-black text-[#2D2A74]">
              İşletme Bilgileri
            </h2>
            <form className="mt-5 space-y-4" onSubmit={handleBusinessSubmit}>
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 outline-none focus:border-[#0D7CC2]"
                value={businessForm.name}
                onChange={(event) => updateBusinessForm("name", event.target.value)}
                placeholder="İşletme adı"
              />
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 outline-none focus:border-[#0D7CC2]"
                value={businessForm.whatsappOrderNumber}
                onChange={(event) =>
                  updateBusinessForm("whatsappOrderNumber", event.target.value)
                }
                placeholder="WhatsApp sipariş numarası"
              />
              <textarea
                className="min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-[#0D7CC2]"
                value={businessForm.description}
                onChange={(event) =>
                  updateBusinessForm("description", event.target.value)
                }
                placeholder="Açıklama"
              />
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 outline-none focus:border-[#0D7CC2]"
                value={businessForm.logoText}
                onChange={(event) =>
                  updateBusinessForm("logoText", event.target.value)
                }
                placeholder="Logo"
              />
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 outline-none focus:border-[#0D7CC2]"
                value={businessForm.coverImage}
                onChange={(event) =>
                  updateBusinessForm("coverImage", event.target.value)
                }
                placeholder="Kapak görseli"
              />
              <button
                className="min-h-14 w-full rounded-2xl bg-[#0D7CC2] px-5 text-lg font-black text-white"
                disabled={isSaving}
                type="submit"
              >
                Bilgileri Güncelle
              </button>
            </form>
          </section>

          <section className="rounded-[28px] bg-white p-4 shadow-[0_12px_30px_rgba(45,42,116,0.08)] sm:p-5">
            <h2 className="text-2xl font-black text-[#2D2A74]">
              Ürün Yönetimi
            </h2>
            <form
              className="mt-5 grid gap-4 lg:grid-cols-2"
              onSubmit={handleProductSubmit}
            >
              <input
                className="min-h-12 rounded-2xl border border-slate-200 px-4 outline-none focus:border-[#0D7CC2]"
                value={productForm.name}
                onChange={(event) => updateProductForm("name", event.target.value)}
                placeholder="Ürün adı"
              />
              <input
                className="min-h-12 rounded-2xl border border-slate-200 px-4 outline-none focus:border-[#0D7CC2]"
                inputMode="decimal"
                value={productForm.price}
                onChange={(event) => updateProductForm("price", event.target.value)}
                placeholder="Fiyat"
              />
              <input
                className="min-h-12 rounded-2xl border border-slate-200 px-4 outline-none focus:border-[#0D7CC2]"
                list="owner-product-categories"
                value={productForm.category}
                onChange={(event) =>
                  updateProductForm("category", event.target.value)
                }
                placeholder="Kategori"
              />
              <datalist id="owner-product-categories">
                {categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
              <input
                className="min-h-12 rounded-2xl border border-slate-200 px-4 outline-none focus:border-[#0D7CC2]"
                value={productForm.imageLabel}
                onChange={(event) =>
                  updateProductForm("imageLabel", event.target.value)
                }
                placeholder="Ürün görseli"
              />
              <textarea
                className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-[#0D7CC2] lg:col-span-2"
                value={productForm.description}
                onChange={(event) =>
                  updateProductForm("description", event.target.value)
                }
                placeholder="Açıklama"
              />
              <label className="flex min-h-12 items-center gap-3 rounded-2xl bg-[#F5F7FA] px-4 font-bold text-[#2D2A74] lg:col-span-2">
                <input
                  checked={productForm.isActive}
                  className="h-5 w-5 accent-[#0D7CC2]"
                  type="checkbox"
                  onChange={(event) =>
                    updateProductForm("isActive", event.target.checked)
                  }
                />
                Aktif ürün olarak göster
              </label>
              <button
                className="min-h-14 rounded-2xl bg-[#0D7CC2] px-5 text-lg font-black text-white lg:col-span-2"
                disabled={isSaving}
                type="submit"
              >
                {editingProductId ? "Ürünü Güncelle" : "Ürün Ekle"}
              </button>
            </form>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {products.map((product) => (
                <article
                  className="rounded-3xl border border-slate-100 p-4 shadow-[0_8px_24px_rgba(45,42,116,0.08)]"
                  key={product.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-[#0D7CC2]">
                        {product.category}
                      </p>
                      <h3 className="text-xl font-black text-[#2D2A74]">
                        {product.name}
                      </h3>
                      <p className="mt-1 font-black">{formatPrice(product.price)}</p>
                    </div>
                    <span className="rounded-full bg-[#F5F7FA] px-3 py-1 text-xs font-black text-[#2D2A74]">
                      {product.isActive !== false ? "Aktif" : "Pasif"}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6">{product.description}</p>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <button
                      className="min-h-11 rounded-2xl bg-[#0D7CC2] px-3 text-sm font-black text-white"
                      disabled={isSaving}
                      type="button"
                      onClick={() => startProductEdit(product)}
                    >
                      Düzenle
                    </button>
                    <button
                      className="min-h-11 rounded-2xl bg-[#F5F7FA] px-3 text-sm font-black text-[#2D2A74]"
                      disabled={isSaving}
                      type="button"
                      onClick={() => toggleProduct(product)}
                    >
                      {product.isActive !== false ? "Pasif Yap" : "Aktif Yap"}
                    </button>
                    <button
                      className="min-h-11 rounded-2xl bg-[#F5F7FA] px-3 text-sm font-black text-[#2D2A74]"
                      disabled={isSaving}
                      type="button"
                      onClick={() => deleteProduct(product.id)}
                    >
                      Sil
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>

      {qrOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-3 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-[28px] bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-2xl font-black text-[#2D2A74]">
                {business.name} QR kodu
              </h2>
              <button
                className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F5F7FA] text-xl font-black text-[#2D2A74]"
                type="button"
                onClick={() => setQrOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="mt-5 flex justify-center rounded-3xl bg-[#F5F7FA] p-4">
              <img
                alt={`${business.name} sipariş sayfası QR kodu`}
                className="h-64 w-64 max-w-full rounded-2xl bg-white p-3"
                src={qrImageUrl}
              />
            </div>
            <p className="mt-4 break-all rounded-2xl bg-[#F5F7FA] p-3 text-sm font-bold text-[#2D2A74]">
              {qrLink}
            </p>
            <button
              className="mt-4 min-h-14 w-full rounded-2xl bg-[#0D7CC2] px-5 text-lg font-black text-white"
              type="button"
              onClick={copyQrLink}
            >
              Linki Kopyala
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
