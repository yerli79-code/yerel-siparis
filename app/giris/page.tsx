"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PlatformBrand from "../../components/PlatformBrand";
import {
  getValidAccessToken,
  signInWithPassword,
} from "../../lib/browser-auth-session";
import styles from "./giris.module.css";

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
      setError("Lütfen e-posta ve şifre alanlarını doldurun.");
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
        setError("Giriş başarısız. E-posta veya şifreyi kontrol edin.");
        return;
      }

      router.replace("/panel");
    } catch {
      setError("Giriş sırasında bir hata oluştu. Lütfen tekrar deneyin.");
    } finally {
      setIsLoading(false);
    }
  }

  if (isCheckingSession) {
    return (
      <main className={styles.loginPage}>
        <div className={styles.loadingCard}>
          <p>Oturum kontrol ediliyor...</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.loginPage}>
      <div className={styles.loginShell}>
        <header className={styles.brandPanel}>
          <Link className={styles.backLink} href="/">
            <span aria-hidden="true">←</span>
            Ana sayfaya dön
          </Link>

          <div className={styles.brandContent}>
            <PlatformBrand className={styles.brand} publicVariant />
            <span className={styles.eyebrow}>İşletme yönetim merkezi</span>
            <h1>İşletme Girişi</h1>
            <p>
              İşletme panelinize erişmek için e-posta ve şifrenizle güvenli
              giriş yapın.
            </p>
          </div>
        </header>

        <section className={styles.formPanel}>
          <div className={styles.formHeading}>
            <div>
              <span className={styles.formKicker}>Hesabınıza erişin</span>
              <h2>Panel girişi</h2>
            </div>
            <span className={styles.securityBadge}>Güvenli giriş</span>
          </div>

          <form className={styles.loginForm} onSubmit={handleSubmit}>
            <div className={styles.field}>
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

            <div className={styles.field}>
              <label htmlFor="password">Şifre</label>
              <input
                autoComplete="current-password"
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error ? <p className={styles.alert}>{error}</p> : null}

            <button
              className={styles.primaryAction}
              disabled={isLoading}
              type="submit"
            >
              {isLoading ? "Giriş yapılıyor..." : "Giriş Yap"}
            </button>
            <Link className={styles.secondaryLink} href="/sifre-yenile">
              Şifremi unuttum
            </Link>
          </form>
        </section>
      </div>
    </main>
  );
}
