"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getValidAccessToken,
  signInWithPassword,
} from "../../lib/browser-auth-session";

const sessionKey = "yerel-siparis-business-session";

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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    getValidAccessToken(getBusinessAuthConfig())
      .then((token) => {
        if (token) {
          router.replace("/panel");
          return;
        }
        setIsCheckingSession(false);
      })
      .catch(() => {
        setIsCheckingSession(false);
      });
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Lutfen e-posta ve sifre alanlarini doldurun.");
      return;
    }

    setIsLoading(true);

    try {
      const session = await signInWithPassword(
        getBusinessAuthConfig(),
        email.trim(),
        password,
      );

      if (!session) {
        setError("Giris basarisiz. E-posta veya sifreyi kontrol edin.");
        return;
      }

      router.replace("/panel");
    } catch {
      setError("Giris sirasinda bir hata olustu. Lutfen tekrar deneyin.");
    } finally {
      setIsLoading(false);
    }
  }

  if (isCheckingSession) {
    return (
      <main className="page">
        <div className="shell section">
          <p>Oturum kontrol ediliyor...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page auth-page">
      <div className="shell auth-shell">
        <header className="hero auth-hero">
          <div className="hero-content auth-hero-content">
            <Link className="eyebrow auth-back-link" href="/">
              Ana sayfa
            </Link>
            <h1>Isletme Girisi</h1>
            <p>Isletme panelinize erismek icin e-posta ve sifrenizle guvenli giris yapin.</p>
          </div>
        </header>

        <section className="section auth-card">
          <div className="section-title auth-card-title">
            <h2>Panel girisi</h2>
            <span>Supabase Auth</span>
          </div>

          <form className="customer-form auth-form" onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="email">E-posta</label>
              <input
                autoComplete="email"
                id="email"
                inputMode="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="password">Sifre</label>
              <input
                autoComplete="current-password"
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error ? <p className="alert">{error}</p> : null}

            <button className="submit-button auth-primary-action" disabled={isLoading} type="submit">
              {isLoading ? "Giris yapiliyor..." : "Giris Yap"}
            </button>
            <Link className="link-button auth-secondary-link" href="/sifre-yenile">
              Şifremi unuttum
            </Link>
          </form>
        </section>
      </div>
    </main>
  );
}
