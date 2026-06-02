"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import {
  clearActiveBusinessSlug,
  mergeBusinessIntoStorage,
  setActiveBusinessSlug,
} from "../../lib/business-storage";
import { loginBusinessWithSupabase } from "../../lib/supabase/business-service";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    try {
      setIsSubmitting(true);
      const supabaseBusiness = await loginBusinessWithSupabase(email, password);

      if (!supabaseBusiness) {
        clearActiveBusinessSlug();
        setMessage("Bu kullanıcıya ait Supabase işletme kaydı bulunamadı.");
        return;
      }

      mergeBusinessIntoStorage(supabaseBusiness);
      setActiveBusinessSlug(supabaseBusiness.slug);
      window.location.href = "/panel";
    } catch (error) {
      clearActiveBusinessSlug();
      setMessage(
        error instanceof Error
          ? `Supabase girişi başarısız: ${error.message}`
          : "Supabase girişi başarısız.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F5F7FA] px-3 py-10 text-[#333333]">
      <div className="mx-auto max-w-md rounded-[28px] bg-white p-5 shadow-[0_12px_30px_rgba(45,42,116,0.08)] sm:p-7">
        <p className="text-sm font-black uppercase tracking-wide text-[#0D7CC2]">
          İşletme Girişi
        </p>
        <h1 className="mt-2 text-4xl font-black text-[#2D2A74]">
          Panele giriş yap
        </h1>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="text-sm font-black" htmlFor="email">
              E-posta
            </label>
            <input
              className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4 outline-none focus:border-[#0D7CC2]"
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-black" htmlFor="password">
              Şifre
            </label>
            <input
              className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4 outline-none focus:border-[#0D7CC2]"
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {message ? (
            <p className="rounded-2xl bg-[#F5F7FA] p-3 font-bold text-[#2D2A74]">
              {message}
            </p>
          ) : null}
          <button
            className="min-h-14 w-full rounded-2xl bg-[#0D7CC2] px-5 text-lg font-black text-white disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>
        </form>

        <Link className="mt-5 block text-center font-bold text-[#2D2A74]" href="/kayit">
          Yeni işletme kaydı oluştur
        </Link>
      </div>
    </main>
  );
}
