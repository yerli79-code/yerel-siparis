"use client";

import Link from "next/link";
import { FormEvent, use, useEffect, useMemo, useState } from "react";
import {
  mergeBusinessIntoStorage,
  readBusinessesFromStorage,
} from "../../../lib/business-storage";
import {
  getBusinessBySlug,
  type Business,
  type Product,
} from "../../../lib/businesses";
import { fetchBusinessBySlugFromSupabase } from "../../../lib/supabase/business-service";

type CartItem = Product & {
  quantity: number;
};

type Customer = {
  fullName: string;
  phone: string;
  address: string;
  note: string;
};

const initialCustomer: Customer = {
  fullName: "",
  phone: "",
  address: "",
  note: "",
};

function formatPrice(price: number) {
  return `${price.toLocaleString("tr-TR")} TL`;
}

function NotFoundView() {
  return (
    <main className="min-h-screen bg-[#F5F7FA] px-4 py-10 text-[#333333]">
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-2xl font-black text-[#2D2A74] shadow-sm">
          ?
        </div>
        <h1 className="text-3xl font-black text-[#2D2A74]">
          İşletme bulunamadı
        </h1>
        <p className="mt-3 text-base leading-7 text-[#333333]">
          Aradığınız işletme yayında olmayabilir veya bağlantı hatalı olabilir.
        </p>
        <Link
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#0D7CC2] px-5 font-bold text-white shadow-sm transition hover:bg-[#2D2A74]"
          href="/"
        >
          İşletme listesine dön
        </Link>
      </div>
    </main>
  );
}

function BusinessHero({ business }: { business: Business }) {
  return (
    <header className="max-w-full overflow-hidden rounded-[28px] bg-[#2D2A74] p-5 text-white shadow-[0_16px_35px_rgba(45,42,116,0.18)] sm:p-7">
      <Link
        className="mb-5 inline-flex min-h-10 items-center rounded-full bg-white/10 px-4 text-sm font-bold text-white"
        href="/"
      >
        İşletmeler
      </Link>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-white text-2xl font-black text-[#2D2A74]">
          {business.logoText}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white/75">{business.category}</p>
          <h1 className="mt-1 break-words text-4xl font-black leading-tight tracking-normal sm:text-5xl">
            {business.name}
          </h1>
          <p className="mt-3 break-words text-base leading-7 text-white/85">
            {business.description}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-2xl bg-white/10 p-4">
          <p className="font-bold">Adres</p>
          <p className="mt-1 text-white/80">
            {business.neighborhood}, {business.district} / {business.city}
          </p>
          <p className="mt-1 text-white/80">{business.address}</p>
        </div>
        <div className="rounded-2xl bg-white/10 p-4">
          <p className="font-bold">Teslimat</p>
          <p className="mt-1 text-white/80">{business.deliveryStatus}</p>
        </div>
      </div>
    </header>
  );
}

export default function BusinessOrderPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const fallbackBusiness = getBusinessBySlug(slug);
  const [business, setBusiness] = useState<Business | undefined>(
    fallbackBusiness,
  );
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<Customer>(initialCustomer);
  const [warning, setWarning] = useState("");

  useEffect(() => {
    const storedBusiness = readBusinessesFromStorage().find(
      (item) => item.slug === slug,
    );
    setBusiness(storedBusiness);
    setCart((items) =>
      items.filter((item) =>
        storedBusiness?.productCategories.some((category) =>
          category.products.some(
            (product) => product.id === item.id && product.isActive !== false,
          ),
        ),
      ),
    );

    fetchBusinessBySlugFromSupabase(slug)
      .then((supabaseBusiness) => {
        if (!supabaseBusiness) return;
        setBusiness(supabaseBusiness);
        mergeBusinessIntoStorage(supabaseBusiness);
        setCart((items) =>
          items.filter((item) =>
            supabaseBusiness.productCategories.some((category) =>
              category.products.some(
                (product) => product.id === item.id && product.isActive !== false,
              ),
            ),
          ),
        );
      })
      .catch(() => undefined);
  }, [slug]);

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart],
  );

  const itemCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart],
  );

  if (!business) {
    return <NotFoundView />;
  }

  const currentBusiness = business;
  const activeProductCategories = currentBusiness.productCategories
    .map((category) => ({
      ...category,
      products: category.products.filter((product) => product.isActive !== false),
    }))
    .filter((category) => category.products.length > 0);

  function addToCart(product: Product) {
    setWarning("");
    setCart((items) => {
      const current = items.find((item) => item.id === product.id);

      if (current) {
        return items.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }

      return [...items, { ...product, quantity: 1 }];
    });
  }

  function decreaseItem(productId: string) {
    setWarning("");
    setCart((items) =>
      items
        .map((item) =>
          item.id === productId
            ? { ...item, quantity: item.quantity - 1 }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  function increaseItem(productId: string) {
    setWarning("");
    setCart((items) =>
      items.map((item) =>
        item.id === productId
          ? { ...item, quantity: item.quantity + 1 }
          : item,
      ),
    );
  }

  function removeItem(productId: string) {
    setWarning("");
    setCart((items) => items.filter((item) => item.id !== productId));
  }

  function updateCustomer(field: keyof Customer, value: string) {
    setWarning("");
    setCustomer((current) => ({ ...current, [field]: value }));
  }

  function createWhatsAppMessage() {
    const orderLines = cart
      .map(
        (item) =>
          `* ${item.name} x ${item.quantity} = ${formatPrice(
            item.price * item.quantity,
          )}`,
      )
      .join("\n");

    return [
      "Yeni Sipariş",
      "",
      "İşletme:",
      currentBusiness.name,
      "",
      "Müşteri:",
      "",
      `Ad Soyad: ${customer.fullName.trim()}`,
      `Telefon: ${customer.phone.trim()}`,
      `Adres: ${customer.address.trim()}`,
      `Not: ${customer.note.trim() || "-"}`,
      "",
      "Sipariş:",
      "",
      orderLines,
      "",
      "Genel Toplam:",
      formatPrice(total),
    ].join("\n");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (cart.length === 0) {
      setWarning("Sipariş oluşturmak için sepete en az bir ürün ekleyin.");
      return;
    }

    if (
      !customer.fullName.trim() ||
      !customer.phone.trim() ||
      !customer.address.trim()
    ) {
      setWarning("Lütfen Ad Soyad, Telefon ve Adres alanlarını doldurun.");
      return;
    }

    const message = encodeURIComponent(createWhatsAppMessage());
    window.open(
      `https://wa.me/${currentBusiness.whatsappOrderNumber}?text=${message}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#F5F7FA] px-3 py-4 text-[#333333] sm:px-5 sm:py-6">
      <div className="mx-auto w-full max-w-full min-w-0 sm:max-w-6xl">
        <BusinessHero business={currentBusiness} />

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          <section className="min-w-0 max-w-full overflow-hidden rounded-[28px] bg-white p-4 shadow-[0_12px_30px_rgba(45,42,116,0.08)] sm:p-6">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-[#0D7CC2]">
                  QR menü
                </p>
                <h2 className="mt-1 text-3xl font-black text-[#2D2A74]">
                  Ürünler
                </h2>
              </div>
              <span className="shrink-0 rounded-full bg-[#F5F7FA] px-3 py-2 text-sm font-bold text-[#2D2A74]">
                {activeProductCategories.length} kategori
              </span>
            </div>

            <div className="mt-5 space-y-7">
              {activeProductCategories.map((category) => (
                <div key={category.id}>
                  <h3 className="text-xl font-black text-[#2D2A74]">
                    {category.name}
                  </h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {category.products.map((product) => (
                      <article
                        className="flex min-w-0 max-w-full flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white p-3 shadow-[0_8px_24px_rgba(45,42,116,0.08)]"
                        key={product.id}
                      >
                        <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-[#F5F7FA] text-lg font-black text-[#2D2A74]">
                          {product.imageLabel}
                        </div>
                        <div className="flex flex-1 flex-col pt-4">
                          <h4 className="text-lg font-black leading-snug text-[#2D2A74]">
                            {product.name}
                          </h4>
                          <p className="mt-2 flex-1 text-sm leading-6 text-[#333333]">
                            {product.description}
                          </p>
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <span className="text-xl font-black text-[#2D2A74]">
                              {formatPrice(product.price)}
                            </span>
                          </div>
                          <button
                            className="mt-4 min-h-12 w-full rounded-2xl bg-[#0D7CC2] px-4 font-black text-white shadow-sm transition hover:bg-[#2D2A74]"
                            type="button"
                            onClick={() => addToCart(product)}
                          >
                            Sepete Ekle
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside className="lg:sticky lg:top-5">
            <div className="max-w-full overflow-hidden rounded-[28px] bg-white p-4 shadow-[0_12px_30px_rgba(45,42,116,0.1)] sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-black text-[#2D2A74]">
                  Sepetim
                </h2>
                <span className="rounded-full bg-[#F5F7FA] px-3 py-2 text-sm font-black text-[#2D2A74]">
                  {itemCount} adet
                </span>
              </div>

              {cart.length === 0 ? (
                <p className="mt-4 rounded-2xl bg-[#F5F7FA] p-4 text-sm leading-6 text-[#333333]">
                  Sepetiniz boş. Ürünlerden seçim yaparak siparişe başlayın.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {cart.map((item) => (
                    <div
                      className="rounded-2xl border border-slate-100 bg-[#F5F7FA] p-3"
                      key={item.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-black leading-snug text-[#2D2A74]">
                            {item.name}
                          </h3>
                          <p className="mt-1 text-sm text-[#333333]">
                            {formatPrice(item.price)} x {item.quantity}
                          </p>
                        </div>
                        <p className="shrink-0 font-black text-[#2D2A74]">
                          {formatPrice(item.price * item.quantity)}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button
                            aria-label={`${item.name} adet azalt`}
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-xl font-black text-[#2D2A74] shadow-sm"
                            type="button"
                            onClick={() => decreaseItem(item.id)}
                          >
                            -
                          </button>
                          <strong className="min-w-7 text-center text-lg">
                            {item.quantity}
                          </strong>
                          <button
                            aria-label={`${item.name} adet artır`}
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-xl font-black text-[#2D2A74] shadow-sm"
                            type="button"
                            onClick={() => increaseItem(item.id)}
                          >
                            +
                          </button>
                        </div>
                        <button
                          className="min-h-10 rounded-full bg-white px-4 text-sm font-black text-[#2D2A74] shadow-sm"
                          type="button"
                          onClick={() => removeItem(item.id)}
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4 text-xl font-black">
                <span>Toplam</span>
                <span className="text-[#2D2A74]">{formatPrice(total)}</span>
              </div>

              <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
                <div>
                  <label className="text-sm font-black" htmlFor="fullName">
                    Ad Soyad *
                  </label>
                  <input
                    className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none focus:border-[#0D7CC2]"
                    id="fullName"
                    autoComplete="name"
                    value={customer.fullName}
                    onChange={(event) =>
                      updateCustomer("fullName", event.target.value)
                    }
                    placeholder="Örn. Ahmet Yılmaz"
                  />
                </div>

                <div>
                  <label className="text-sm font-black" htmlFor="phone">
                    Telefon *
                  </label>
                  <input
                    className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none focus:border-[#0D7CC2]"
                    id="phone"
                    autoComplete="tel"
                    inputMode="tel"
                    value={customer.phone}
                    onChange={(event) =>
                      updateCustomer("phone", event.target.value)
                    }
                    placeholder="Örn. 05xx xxx xx xx"
                  />
                </div>

                <div>
                  <label className="text-sm font-black" htmlFor="address">
                    Adres *
                  </label>
                  <textarea
                    className="mt-2 min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 text-base outline-none focus:border-[#0D7CC2]"
                    id="address"
                    autoComplete="street-address"
                    value={customer.address}
                    onChange={(event) =>
                      updateCustomer("address", event.target.value)
                    }
                    placeholder="Mahalle, sokak, bina, daire"
                  />
                </div>

                <div>
                  <label className="text-sm font-black" htmlFor="note">
                    Sipariş Notu
                  </label>
                  <textarea
                    className="mt-2 min-h-20 w-full rounded-2xl border border-slate-200 px-4 py-3 text-base outline-none focus:border-[#0D7CC2]"
                    id="note"
                    value={customer.note}
                    onChange={(event) =>
                      updateCustomer("note", event.target.value)
                    }
                    placeholder="Teslimat notu veya ürün tercihi"
                  />
                </div>

                {warning ? (
                  <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold leading-6 text-red-700">
                    {warning}
                  </p>
                ) : null}

                <button
                  className="min-h-14 w-full rounded-2xl bg-[#25D366] px-5 text-lg font-black text-white shadow-[0_12px_26px_rgba(37,211,102,0.24)] transition hover:bg-[#128C7E]"
                  type="submit"
                >
                  WhatsApp Siparişi Gönder
                </button>
              </form>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
