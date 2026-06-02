"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import {
  createSlug,
  mergeBusinessIntoStorage,
  readBusinessesFromStorage,
  setActiveBusinessSlug,
  writeBusinessesToStorage,
} from "../../lib/business-storage";
import type { Business } from "../../lib/businesses";
import { registerBusinessWithSupabase } from "../../lib/supabase/business-service";

type RegisterForm = {
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  whatsappOrderNumber: string;
  password: string;
};

const emptyForm: RegisterForm = {
  businessName: "",
  ownerName: "",
  email: "",
  phone: "",
  whatsappOrderNumber: "",
  password: "",
};

export default function RegisterPage() {
  const [form, setForm] = useState<RegisterForm>(emptyForm);
  const [message, setMessage] = useState("");

  const slug = useMemo(() => createSlug(form.businessName), [form.businessName]);

  function updateForm(field: keyof RegisterForm, value: string) {
    setMessage("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !form.businessName.trim() ||
      !form.ownerName.trim() ||
      !form.email.trim() ||
      !form.phone.trim() ||
      !form.whatsappOrderNumber.trim() ||
      !form.password.trim()
    ) {
      setMessage("Lütfen tüm zorunlu alanları doldurun.");
      return;
    }

    const businesses = readBusinessesFromStorage();

    if (businesses.some((business) => business.slug === slug)) {
      setMessage("Bu işletme adıyla kayıt zaten var.");
      return;
    }

    if (
      businesses.some(
        (business) =>
          business.email?.toLocaleLowerCase("tr-TR") ===
          form.email.toLocaleLowerCase("tr-TR"),
      )
    ) {
      setMessage("Bu e-posta ile kayıt zaten var.");
      return;
    }

    try {
      const supabaseBusiness = await registerBusinessWithSupabase({
        ...form,
        slug,
      });

      if (supabaseBusiness) {
        mergeBusinessIntoStorage(supabaseBusiness);
        setActiveBusinessSlug(supabaseBusiness.slug);
        window.location.href = "/panel";
        return;
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Supabase kaydi tamamlanamadi, yerel kayit kullaniliyor: ${error.message}`
          : "Supabase kaydi tamamlanamadi, yerel kayit kullaniliyor.",
      );
    }

    const newBusiness: Business = {
      slug,
      name: form.businessName.trim(),
      description: "Yeni kayıt olan işletme.",
      whatsappOrderNumber: form.whatsappOrderNumber.trim(),
      ownerName: form.ownerName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      password: form.password,
      category: "Genel",
      city: "",
      district: "",
      neighborhood: "",
      address: "",
      deliveryStatus: "Teslimat bilgisi eklenmedi",
      logoText: form.businessName.trim().slice(0, 2).toLocaleUpperCase("tr-TR"),
      coverImage: "",
      productCategories: [],
    };

    writeBusinessesToStorage([newBusiness, ...businesses]);
    setActiveBusinessSlug(newBusiness.slug);
    window.location.href = "/panel";
  }

  return (
    <main className="min-h-screen bg-[#F5F7FA] px-3 py-6 text-[#333333]">
      <div className="mx-auto max-w-xl rounded-[28px] bg-white p-5 shadow-[0_12px_30px_rgba(45,42,116,0.08)] sm:p-7">
        <p className="text-sm font-black uppercase tracking-wide text-[#0D7CC2]">
          İşletme Kaydı
        </p>
        <h1 className="mt-2 text-4xl font-black text-[#2D2A74]">
          Yeni işletme oluştur
        </h1>
        <p className="mt-3 rounded-2xl bg-[#F5F7FA] p-3 text-sm font-bold text-[#2D2A74]">
          Slug: {slug || "isletme-adi"}
        </p>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          {[
            ["businessName", "İşletme adı"],
            ["ownerName", "Yetkili adı"],
            ["email", "E-posta"],
            ["phone", "Telefon"],
            ["whatsappOrderNumber", "WhatsApp sipariş numarası"],
            ["password", "Şifre"],
          ].map(([field, label]) => (
            <div key={field}>
              <label className="text-sm font-black" htmlFor={field}>
                {label} *
              </label>
              <input
                className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4 outline-none focus:border-[#0D7CC2]"
                id={field}
                type={field === "password" ? "password" : "text"}
                value={form[field as keyof RegisterForm]}
                onChange={(event) =>
                  updateForm(field as keyof RegisterForm, event.target.value)
                }
              />
            </div>
          ))}

          {message ? (
            <p className="rounded-2xl bg-[#F5F7FA] p-3 font-bold text-[#2D2A74]">
              {message}
            </p>
          ) : null}

          <button
            className="min-h-14 w-full rounded-2xl bg-[#0D7CC2] px-5 text-lg font-black text-white"
            type="submit"
          >
            Kayıt Ol ve Panele Git
          </button>
        </form>

        <Link className="mt-5 block text-center font-bold text-[#2D2A74]" href="/giris">
          Zaten hesabım var
        </Link>
      </div>
    </main>
  );
}
