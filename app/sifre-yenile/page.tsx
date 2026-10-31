"use client";

import Link from "next/link";
import PlatformBrand from "../../components/PlatformBrand";
import styles from "./sifre-yenile.module.css";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase-client";
import { businessSessionKey, clearBrowserAuthSession, clearLegacySupabaseSession } from "../../lib/browser-auth-session";
import { createPasswordRecovery, invalidRecoveryMessage, validateRecoveryPassword } from "../../lib/password-recovery";

type PageMode = "request" | "update";

async function clearOtherSessions() {
  clearBrowserAuthSession(businessSessionKey);
  clearLegacySupabaseSession();
  const response = await fetch("/api/admin/auth/logout?scope=browser", {
    method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Eski oturum temizlenemedi. Lütfen tekrar deneyin.");
}

export default function PasswordResetPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const recovery = useMemo(() => createPasswordRecovery(
    supabase.auth, clearOtherSessions, () => supabase.discardRecoverySession(),
  ), [supabase]);
  const recoveryHref = useRef<string | null>(null);
  const mounted = useRef(false);
  const [mode, setMode] = useState<PageMode>("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingRecovery, setIsCheckingRecovery] = useState(true);
  const [isPasswordUpdated, setIsPasswordUpdated] = useState(false);

  useEffect(() => {
    let isMounted = true;
    mounted.current = true;

    if (recoveryHref.current === null) {
      recoveryHref.current = window.location.href;
      // Remove credentials/codes before rendering links or making requests.
      window.history.replaceState(null, "", window.location.pathname);
    }
    recovery.open(recoveryHref.current)
      .then((authorized) => {
        if (isMounted) setMode(authorized ? "update" : "request");
      })
      .catch(() => {
        if (isMounted) {
          setMode("request");
          setError(invalidRecoveryMessage);
        }
      })
      .finally(() => { if (isMounted) setIsCheckingRecovery(false); });
    return () => {
      isMounted = false;
      mounted.current = false;
      // Strict Mode immediately mounts the same effect again. A real
      // navigation discards the in-memory recovery capability.
      queueMicrotask(() => { if (!mounted.current) recovery.cancel(); });
    };
  }, [recovery]);

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!email.trim()) {
      setError("Lütfen e-posta adresinizi yazın.");
      return;
    }

    setIsLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${window.location.origin}/sifre-yenile`,
        },
      );

      if (resetError) {
        setError("Şifre yenileme bağlantısı gönderilemedi. E-posta adresini kontrol edin.");
        return;
      }

      setMessage("Şifre yenileme bağlantısı e-posta adresinize gönderildi.");
    } catch {
      setError("Şifre yenileme isteği sırasında bir hata oluştu.");
    } finally {
      setIsLoading(false);
    }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (password !== passwordAgain) {
      setError("Şifreler eşleşmiyor.");
      return;
    }

    const passwordError = validateRecoveryPassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setIsLoading(true);

    try {
      await recovery.update(password);

      setPassword("");
      setPasswordAgain("");
      setIsPasswordUpdated(true);
      setMessage("Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.");
    } catch {
      setMode("request");
      setPassword("");
      setPasswordAgain("");
      setError("Şifre yenileme tamamlanamadı. Güvenliğiniz için yeni bağlantı isteyin.");
    } finally {
      setIsLoading(false);
    }
  }

  const title = isCheckingRecovery
    ? "Bağlantı kontrol ediliyor"
    : isPasswordUpdated
      ? "Şifreniz yenilendi"
      : mode === "update"
        ? "Yeni şifrenizi belirleyin"
        : "Şifrenizi mi unuttunuz?";

  return (
    <main className={styles.recoveryPage}>
      <div className={styles.recoveryShell}>
        <header className={styles.brandPanel}>
          <Link className={styles.backLink} href="/giris">
            <span aria-hidden="true">←</span>
            İşletme Girişine Dön
          </Link>

          <div className={styles.brandContent}>
            <PlatformBrand className={styles.brand} publicVariant />
            <span className={styles.eyebrow}>Hesabınıza güvenli erişim</span>
            <h1>Şifre Yenile</h1>
            <p>
              Hesabınıza yeniden erişin, işinize kaldığınız yerden devam edin.
              İşletme veya admin hesabınız için yeni bir şifre belirleyin.
            </p>
          </div>

          <div className={styles.browserNote} id="browser-note">
            <span className={styles.noteIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <rect x="5" y="10" width="14" height="11" rx="3" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
              </svg>
            </span>
            <div>
              <strong>Aynı cihaz, aynı tarayıcı</strong>
              <p>
                E-postadaki bağlantıyı, isteği başlattığınız cihaz ve tarayıcıda
                açın. Farklı bir tarayıcı kullanıyorsanız oradan yeni bağlantı isteyin.
              </p>
            </div>
          </div>
        </header>

        <section className={styles.formPanel} aria-labelledby="recovery-title" aria-busy={isCheckingRecovery || isLoading}>
          <div className={styles.formHeading}>
            <span className={styles.securityBadge}>Güvenli şifre yenileme</span>
            <h2 id="recovery-title">{title}</h2>
            <p>
              {isCheckingRecovery
                ? "Yeni şifrenizi belirlemeden önce bağlantınız doğrulanıyor."
                : isPasswordUpdated
                  ? "Hesabınıza yeni şifrenizle giriş yapabilirsiniz."
                  : mode === "update"
                    ? "Hesabınızı korumak için güçlü ve benzersiz bir şifre seçin."
                    : "Hesabınıza kayıtlı e-posta adresini yazın. Size şifre yenileme bağlantısı gönderelim."}
            </p>
          </div>

          {isCheckingRecovery ? (
            <div className={styles.loadingState} role="status">
              <span className={styles.spinner} aria-hidden="true" />
              <p>Şifre yenileme bağlantısı kontrol ediliyor...</p>
            </div>
          ) : isPasswordUpdated ? (
            <div className={styles.successState}>
              <span className={styles.successIcon} aria-hidden="true">✓</span>
              <p className={styles.successMessage} role="status">{message}</p>
              <Link className={styles.primaryAction} href="/giris">İşletme Girişine Dön</Link>
              <Link className={styles.secondaryLink} href="/admin">Admin girişi</Link>
            </div>
          ) : mode === "update" ? (
            <form className={styles.recoveryForm} onSubmit={updatePassword} aria-busy={isLoading}>
              <div className={styles.field}>
                <label htmlFor="newPassword">Yeni şifre</label>
                <input
                  autoComplete="new-password"
                  aria-describedby="password-rules"
                  id="newPassword"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="newPasswordAgain">Yeni şifre tekrar</label>
                <input
                  autoComplete="new-password"
                  aria-describedby="password-rules"
                  id="newPasswordAgain"
                  type="password"
                  value={passwordAgain}
                  onChange={(event) => setPasswordAgain(event.target.value)}
                />
              </div>

              <div className={styles.passwordRules} id="password-rules">
                <strong>Güçlü bir şifre için</strong>
                <ul>
                  <li>En az 10 karakter</li>
                  <li>En az 1 büyük harf</li>
                  <li>En az 1 küçük harf</li>
                  <li>En az 1 rakam</li>
                  <li>En az 1 özel karakter</li>
                </ul>
              </div>

              {error ? <p className={styles.alert} role="alert">{error}</p> : null}

              <button className={styles.primaryAction} disabled={isLoading} type="submit">
                {isLoading ? "Şifre güncelleniyor..." : "Şifreyi güncelle"}
              </button>
            </form>
          ) : (
            <form className={styles.recoveryForm} onSubmit={requestPasswordReset} aria-busy={isLoading}>
              {error ? <p className={styles.alert} role="alert">{error}</p> : null}

              <div className={styles.field}>
                <label htmlFor="resetEmail">E-posta adresi</label>
                <input
                  autoComplete="email"
                  aria-describedby="browser-note"
                  id="resetEmail"
                  inputMode="email"
                  placeholder="ornek@isletmeniz.com"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              {message ? <p className={styles.successMessage} role="status">{message}</p> : null}

              <button className={styles.primaryAction} disabled={isLoading} type="submit">
                {isLoading ? "Gönderiliyor..." : "Şifre yenileme bağlantısı gönder"}
              </button>
              <p className={styles.formHint}>
                E-posta ulaşmadıysa spam veya gereksiz klasörünü de kontrol edin.
              </p>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
