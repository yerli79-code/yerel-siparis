"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  readBusinessesFromStorage,
  writeBusinessesToStorage,
} from "../lib/business-storage";
import type { Business } from "../lib/businesses";
import { fetchBusinessesFromSupabase } from "../lib/supabase/business-service";

export default function Home() {
  const [businesses, setBusinesses] = useState<Business[]>([]);

  useEffect(() => {
    setBusinesses(readBusinessesFromStorage());

    fetchBusinessesFromSupabase()
      .then((supabaseBusinesses) => {
        if (!supabaseBusinesses) return;
        setBusinesses(supabaseBusinesses);
        writeBusinessesToStorage(supabaseBusinesses);
      })
      .catch(() => {
        setBusinesses(readBusinessesFromStorage());
      });
  }, []);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#F5F7FA] px-3 py-4 text-[#333333] sm:px-5 sm:py-8">
      <div className="mx-auto w-full max-w-full min-w-0 sm:max-w-6xl">
        <header className="max-w-full overflow-hidden rounded-[28px] bg-white p-5 shadow-[0_12px_30px_rgba(45,42,116,0.08)] sm:p-8">
          <p className="text-sm font-black uppercase tracking-wide text-[#0D7CC2]">
            Çok işletmeli QR sipariş demosu
          </p>
          <h1 className="mt-2 break-words text-4xl font-black leading-tight text-[#2D2A74] sm:text-5xl">
            Yerel işletmelerden hızlı sipariş
          </h1>
          <p className="mt-4 max-w-2xl break-words text-base leading-7 text-[#333333]">
            QR kodu okutan müşteri işletmenin ürün sayfasına gider, sepetini
            oluşturur ve sipariş detaylarını işletmenin WhatsApp hattına
            gönderir.
          </p>
        </header>

        <section className="mt-5">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[#0D7CC2]">
                Demo işletmeler
              </p>
              <h2 className="text-2xl font-black text-[#2D2A74]">
                İşletme Listesi
              </h2>
            </div>
            <span className="shrink-0 rounded-full bg-white px-3 py-2 text-sm font-black text-[#2D2A74] shadow-sm">
              {businesses.length} işletme
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {businesses.map((business) => (
              <article
                className="flex min-w-0 max-w-full flex-col overflow-hidden rounded-[28px] bg-white p-4 shadow-[0_12px_30px_rgba(45,42,116,0.08)]"
                key={business.slug}
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#2D2A74] text-xl font-black text-white">
                    {business.logoText}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0D7CC2]">
                      {business.category}
                    </p>
                    <h3 className="mt-1 text-2xl font-black leading-tight text-[#2D2A74]">
                      {business.name}
                    </h3>
                    <p className="mt-1 text-sm text-[#333333]">
                      {business.district} / {business.neighborhood}
                    </p>
                  </div>
                </div>

                <p className="mt-4 flex-1 text-sm leading-6 text-[#333333]">
                  {business.description}
                </p>

                <div className="mt-4 rounded-2xl bg-[#F5F7FA] p-3 text-sm leading-6">
                  <p className="font-black text-[#2D2A74]">Teslimat</p>
                  <p>{business.deliveryStatus}</p>
                </div>

                <Link
                  className="mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#0D7CC2] px-4 text-base font-black text-white shadow-sm transition hover:bg-[#2D2A74]"
                  href={`/isletme/${business.slug}`}
                >
                  Sipariş Ver
                </Link>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
