import Link from "next/link";
import type { FormEvent } from "react";
import PlatformBrand from "../../../components/PlatformBrand";
import styles from "./admin.module.css";

type AdminLoginProps = {
  email: string;
  password: string;
  error: string;
  isSubmitting: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function AdminLoading() {
  return (
    <main className={styles.loadingPage}>
      <section className={styles.loadingCard} aria-live="polite" aria-busy="true">
        <PlatformBrand className={styles.loadingBrand} />
        <span className={styles.spinner} aria-hidden="true" />
        <div>
          <h1>Yönetim Paneli</h1>
          <p>Oturumunuz kontrol ediliyor...</p>
        </div>
      </section>
    </main>
  );
}

export default function AdminLogin({
  email,
  password,
  error,
  isSubmitting,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: AdminLoginProps) {
  return (
    <main className={styles.loginPage}>
      <div className={styles.loginShell}>
        <section className={styles.loginBrandPanel} aria-labelledby="admin-login-brand-title">
          <PlatformBrand className={styles.loginBrand} onDark />
          <div className={styles.loginBrandCopy}>
            <span className={styles.loginEyebrow}>Yerel işletmeler için</span>
            <h1 id="admin-login-brand-title">Yönetim Paneli</h1>
            <p>
              İşletmeleri ve abonelik durumlarını sade, güvenilir bir çalışma
              alanından yönetin.
            </p>
          </div>
          <p className={styles.loginBrandNote}>Yerel Sipariş yönetim merkezi</p>
        </section>

        <section className={styles.loginFormPanel} aria-labelledby="admin-login-title">
          <div className={styles.loginMobileBrand}>
            <PlatformBrand className={styles.loginMobileLogo} />
            <h1>Yönetim Paneli</h1>
          </div>
          <div className={styles.loginFormHeading}>
            <span>Tekrar hoş geldiniz</span>
            <h2 id="admin-login-title">Yönetici Girişi</h2>
            <p>Devam etmek için yetkili hesabınızla giriş yapın.</p>
          </div>

          <form className={styles.loginForm} onSubmit={onSubmit}>
            <div className={styles.loginField}>
              <label htmlFor="adminEmail">E-posta</label>
              <input
                autoComplete="username"
                id="adminEmail"
                inputMode="email"
                placeholder="ornek@yerelsiparis.com"
                required
                type="email"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
              />
            </div>
            <div className={styles.loginField}>
              <div className={styles.passwordLabelRow}>
                <label htmlFor="adminPassword">Şifre</label>
                <Link href="/sifre-yenile">Şifremi unuttum</Link>
              </div>
              <input
                autoComplete="current-password"
                id="adminPassword"
                required
                type="password"
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
              />
            </div>
            {error ? (
              <p className={styles.loginError} aria-live="polite" role="alert">
                {error}
              </p>
            ) : (
              <span className={styles.loginErrorSpacer} aria-hidden="true" />
            )}
            <button className={styles.loginSubmit} disabled={isSubmitting} type="submit">
              {isSubmitting ? "Giriş yapılıyor..." : "Giriş Yap"}
            </button>
          </form>

          <p className={styles.sessionNote}>
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6zM12 14v2" />
            </svg>
            Oturumunuz güvenli biçimde başlatılır ve korunur.
          </p>
        </section>
      </div>
    </main>
  );
}
