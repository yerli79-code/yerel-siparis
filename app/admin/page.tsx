"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  createSlug,
  readBusinessesFromStorage,
  writeBusinessesToStorage,
} from "../../lib/business-storage";
import type { Business } from "../../lib/businesses";

type AdminForm = {
  name: string;
  whatsappOrderNumber: string;
  description: string;
  logoText: string;
  coverImage: string;
};

const emptyForm: AdminForm = {
  name: "",
  whatsappOrderNumber: "",
  description: "",
  logoText: "",
  coverImage: "",
};

export default function AdminPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [form, setForm] = useState<AdminForm>(emptyForm);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setBusinesses(readBusinessesFromStorage());
  }, []);

  function save(nextBusinesses: Business[]) {
    setBusinesses(nextBusinesses);
    writeBusinessesToStorage(nextBusinesses);
  }

  function startEdit(business: Business) {
    setEditingSlug(business.slug);
    setForm({
      name: business.name,
      whatsappOrderNumber: business.whatsappOrderNumber,
      description: business.description,
      logoText: business.logoText,
      coverImage: business.coverImage ?? "",
    });
    setMessage("");
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingSlug(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim() || !form.whatsappOrderNumber.trim()) {
      setMessage("İşletme adı ve WhatsApp numarası zorunludur.");
      return;
    }

    if (editingSlug) {
      save(
        businesses.map((business) =>
          business.slug === editingSlug ? { ...business, ...form } : business,
        ),
      );
      setMessage("İşletme güncellendi.");
      resetForm();
      return;
    }

    const newBusiness: Business = {
      slug: createSlug(form.name),
      name: form.name.trim(),
      description: form.description.trim(),
      whatsappOrderNumber: form.whatsappOrderNumber.trim(),
      category: "Genel",
      city: "",
      district: "",
      neighborhood: "",
      address: "",
      deliveryStatus: "Teslimat bilgisi eklenmedi",
      logoText: form.logoText.trim() || "LOGO",
      coverImage: form.coverImage.trim(),
      productCategories: [],
    };

    save([newBusiness, ...businesses]);
    setMessage("İşletme oluşturuldu.");
    resetForm();
  }

  function deleteBusiness(slug: string) {
    save(businesses.filter((business) => business.slug !== slug));
    setMessage("İşletme silindi.");
    if (editingSlug === slug) resetForm();
  }

  return (
    <main className="min-h-screen bg-[#F5F7FA] px-3 py-6 text-[#333333]">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[28px] bg-white p-5 shadow-[0_12px_30px_rgba(45,42,116,0.08)] sm:p-8">
          <p className="text-sm font-black uppercase tracking-wide text-[#0D7CC2]">
            Sistem Admin
          </p>
          <h1 className="mt-2 text-4xl font-black text-[#2D2A74]">
            Tüm işletmeler
          </h1>
        </header>

        {message ? (
          <p className="mt-5 rounded-2xl bg-white p-4 font-bold text-[#2D2A74]">
            {message}
          </p>
        ) : null}

        <div className="mt-5 grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <section className="rounded-[28px] bg-white p-5 shadow-[0_12px_30px_rgba(45,42,116,0.08)]">
            <h2 className="text-2xl font-black text-[#2D2A74]">
              {editingSlug ? "İşletme Düzenle" : "İşletme Ekle"}
            </h2>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {[
                ["name", "İşletme adı"],
                ["whatsappOrderNumber", "WhatsApp numarası"],
                ["logoText", "Logo"],
                ["coverImage", "Kapak görseli"],
              ].map(([field, label]) => (
                <input
                  className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 outline-none focus:border-[#0D7CC2]"
                  key={field}
                  placeholder={label}
                  value={form[field as keyof AdminForm]}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                />
              ))}
              <textarea
                className="min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-[#0D7CC2]"
                placeholder="Açıklama"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
              <button
                className="min-h-14 w-full rounded-2xl bg-[#0D7CC2] px-5 text-lg font-black text-white"
                type="submit"
              >
                {editingSlug ? "Güncelle" : "Oluştur"}
              </button>
              {editingSlug ? (
                <button
                  className="min-h-12 w-full rounded-2xl bg-[#F5F7FA] px-5 font-black text-[#2D2A74]"
                  type="button"
                  onClick={resetForm}
                >
                  Vazgeç
                </button>
              ) : null}
            </form>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            {businesses.map((business) => (
              <article
                className="rounded-[28px] bg-white p-5 shadow-[0_12px_30px_rgba(45,42,116,0.08)]"
                key={business.slug}
              >
                <p className="text-sm font-bold text-[#0D7CC2]">
                  /isletme/{business.slug}
                </p>
                <h2 className="mt-1 text-2xl font-black text-[#2D2A74]">
                  {business.name}
                </h2>
                <p className="mt-2 text-sm leading-6">{business.description}</p>
                <p className="mt-3 font-bold">{business.whatsappOrderNumber}</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    className="min-h-11 rounded-2xl bg-[#0D7CC2] px-4 font-black text-white"
                    type="button"
                    onClick={() => startEdit(business)}
                  >
                    Düzenle
                  </button>
                  <button
                    className="min-h-11 rounded-2xl bg-[#F5F7FA] px-4 font-black text-[#2D2A74]"
                    type="button"
                    onClick={() => deleteBusiness(business.slug)}
                  >
                    Sil
                  </button>
                </div>
              </article>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
