"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase-client";

type PageMode = "request" | "update";

function validatePassword(password: string) {
  if (password.length < 10) return "Şifre en az 10 karakter olmalıdır.";
  if (!/[A-ZÇĞİÖŞÜ]/.test(password)) {
    return "Şifre en az 1 büyük harf içermelidir.";
  }
  if (!/[a-zçğıöşü]/.test(password)) {
    return "Şifre en az 1 küçük harf içermelidir.";
  }
  if (!/[0-9]/.test(password)) return "Şifre en az 1 rakam içermelidir.";
  if (!/[^A-Za-zÇĞİÖŞÜçğıöşü0-9]/.test(password)) {
    return "Şifre en az 1 özel karakter içermelidir.";
  }
  return "";
}

function hasRecoveryParams() {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash;
  const search = window.location.search;
  return (
    hash.includes("type=recovery") ||
    hash.includes("access_token=") ||
    search.includes("type=recovery") ||
    search.includes("code=")
  );
}

function getRecoveryCode() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("code") || "";
}

export default function PasswordResetPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("update");
        setMessage("");
        setError("");
      }
    });

    const checkRecoverySession = async () => {
      const recoveryCode = getRecoveryCode();
      if (recoveryCode) {
        await supabase.auth.exchangeCodeForSession(recoveryCode);
      }

      const { data } = await supabase.auth.getSession();
      return data;
    };

    checkRecoverySession()
      .then((data) => {
        if (!isMounted) return;
        if (data.session && hasRecoveryParams()) {
          setMode("update");
        } else if (hasRecoveryParams()) {
          setMode("update");
        }
      })
      .catch(() => {
        if (isMounted && hasRecoveryParams()) {
          setMode("update");
          setError("Şifre yenileme bağlantısı doğrulanamadı. Yeni bağlantı isteyebilirsiniz.");
        }
      })
      .finally(() => {
        if (isMounted) setIsCheckingRecovery(false);
      });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

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

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setIsLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError("Şifre güncellenemedi. Bağlantı süresi dolmuş olabilir.");
        return;
      }

      setPassword("");
      setPasswordAgain("");
      setIsPasswordUpdated(true);
      setMessage("Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.");
      await supabase.auth.signOut();
    } catch {
      setError("Şifre güncelleme sırasında bir hata oluştu.");
    } finally {
      setIsLoading(false);
    }
  }

  if (isCheckingRecovery) {
    return (
      <main className="page">
        <div className="shell section">
          <p>Şifre yenileme bağlantısı kontrol ediliyor...</p>
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
            <h1>Şifre Yenile</h1>
            <p>Admin veya işletme hesabınız için güvenli şekilde yeni şifre belirleyin.</p>
          </div>
        </header>

        <section className="section auth-card">
          {mode === "update" ? (
            <form className="customer-form auth-form" onSubmit={updatePassword}>
              <div className="section-title auth-card-title">
                <h2>Yeni şifre belirle</h2>
                <span>Güçlü şifre gerekli</span>
              </div>

              <div className="field">
                <label htmlFor="newPassword">Yeni şifre</label>
                <input
                  autoComplete="new-password"
                  id="newPassword"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="newPasswordAgain">Yeni şifre tekrar</label>
                <input
                  autoComplete="new-password"
                  id="newPasswordAgain"
                  type="password"
                  value={passwordAgain}
                  onChange={(event) => setPasswordAgain(event.target.value)}
                />
              </div>

              <div className="password-rules">
                <strong>Şifre kuralları</strong>
                <ul>
                  <li>En az 10 karakter</li>
                  <li>En az 1 büyük harf</li>
                  <li>En az 1 küçük harf</li>
                  <li>En az 1 rakam</li>
                  <li>En az 1 özel karakter</li>
                </ul>
              </div>

              {error ? <p className="alert">{error}</p> : null}
              {message ? <p className="alert success">{message}</p> : null}

              {!isPasswordUpdated ? (
                <button className="submit-button auth-primary-action" disabled={isLoading} type="submit">
                  {isLoading ? "Şifre güncelleniyor..." : "Şifreyi güncelle"}
                </button>
              ) : null}

              {isPasswordUpdated ? (
                <div className="auth-link-row">
                  <Link className="admin-link" href="/admin">
                    Admin girişi
                  </Link>
                  <Link className="admin-link" href="/giris">
                    İşletme girişi
                  </Link>
                </div>
              ) : null}
            </form>
          ) : (
            <form className="customer-form auth-form" onSubmit={requestPasswordReset}>
              <div className="section-title auth-card-title">
                <h2>Şifre yenileme bağlantısı iste</h2>
                <span>E-posta ile gönderilir</span>
              </div>

              <div className="field">
                <label htmlFor="resetEmail">E-posta</label>
                <input
                  autoComplete="email"
                  id="resetEmail"
                  inputMode="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              {error ? <p className="alert">{error}</p> : null}
              {message ? <p className="alert success">{message}</p> : null}

              <button className="submit-button auth-primary-action" disabled={isLoading} type="submit">
                {isLoading
                  ? "Gönderiliyor..."
                  : "Şifre yenileme bağlantısı gönder"}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
