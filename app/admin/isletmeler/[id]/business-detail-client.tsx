"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import LocationSelector from "../../../../components/LocationSelector";
import type { Business } from "../../../../lib/businesses";
import {
  clearLegacyAdminBrowserSession,
  clearLegacyAdminBusinessCache,
  loginAdmin,
  logoutAdmin,
  readAdminSession,
} from "../../../../lib/admin-client";
import type {
  AdminBusinessDetail,
  AdminBusinessSafePatchResult,
} from "../../../../lib/admin/business-detail-contract";
import {
  getAdminAuditActionLabel,
  type AdminBusinessAuditItem,
} from "../../../../lib/admin/business-audit-history-contract";
import {
  AdminBusinessRequestError,
  blockAdminBusiness,
  deactivateAdminBusiness,
  deleteBusinessInSupabase,
  extendAdminBusinessSubscription,
  fetchAdminBusinessAuditHistory,
  fetchAdminBusinessDetail,
  mergeAdminBusinessCriticalState,
  reactivateAdminBusiness,
  resetAdminBusinessSubscription,
  setAdminBusinessSubscriptionDate,
  updateAdminBusinessSafely,
  type AdminBusinessCriticalMutationResult,
} from "../../../../lib/supabase-admin";
import {
  canReactivateBusinessAccess,
  getAdminSubscriptionStatusLabel,
  getBadge,
  getRemainingDays,
} from "../../../../lib/subscription";
import AdminLogin, { AdminLoading } from "../../_components/admin-login";
import AdminShell from "../../_components/admin-shell";
import styles from "./business-detail.module.css";

const extensionDays = [30, 60, 90, 180, 365] as const;

type ConfirmAction = {
  title: string;
  description: string;
  critical?: boolean;
  run: () => Promise<void>;
};

type EditableBusinessProfile = Pick<
  AdminBusinessSafePatchResult,
  | "name"
  | "slug"
  | "description"
  | "category"
  | "whatsappOrderNumber"
  | "city"
  | "district"
  | "neighborhood"
  | "address"
>;

const emptyEditableProfile: EditableBusinessProfile = {
  name: "",
  slug: "",
  description: "",
  category: "",
  whatsappOrderNumber: "",
  city: "",
  district: "",
  neighborhood: "",
  address: "",
};

function editableProfileFromBusiness(
  business: AdminBusinessDetail["business"] | AdminBusinessSafePatchResult,
): EditableBusinessProfile {
  return {
    name: business.name,
    slug: business.slug,
    description: business.description,
    category: business.category,
    whatsappOrderNumber: business.whatsappOrderNumber,
    city: business.city,
    district: business.district,
    neighborhood: business.neighborhood,
    address: business.address,
  };
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toLocaleString("tr-TR")} ${currency}`;
  }
}

function dateInputValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function paymentLabel(value: string) {
  return { cash: "Nakit", card: "Kart", cash_or_card: "Nakit veya kart" }[value] ?? value;
}

function orderStatusLabel(value: string) {
  return {
    new: "Yeni",
    preparing: "Hazırlanıyor",
    ready: "Hazır",
    delivered: "Teslim edildi",
    cancelled: "İptal edildi",
  }[value] ?? value;
}

function orderTypeLabel(value: string) {
  return value === "delivery" ? "Teslimat" : value === "pickup" ? "Gel-al" : value;
}

function auditSubscriptionStatusLabel(value: AdminBusinessAuditItem["before"]["subscriptionStatus"]) {
  return {
    active: "Aktif",
    expired: "Süresi dolmuş",
    blocked: "Engelli",
  }[value];
}

function getAuditChangeSummaries(item: AdminBusinessAuditItem) {
  const changes: string[] = [];
  if (item.before.isActive !== item.after.isActive) {
    changes.push(
      `Aktif: ${item.before.isActive ? "Evet" : "Hayır"} → ${item.after.isActive ? "Evet" : "Hayır"}`,
    );
  }
  if (item.before.subscriptionStatus !== item.after.subscriptionStatus) {
    changes.push(
      `Abonelik: ${auditSubscriptionStatusLabel(item.before.subscriptionStatus)} → ${auditSubscriptionStatusLabel(item.after.subscriptionStatus)}`,
    );
  }
  if (item.before.subscriptionStartedAt !== item.after.subscriptionStartedAt) {
    changes.push(
      `Başlangıç: ${formatDate(item.before.subscriptionStartedAt)} → ${formatDate(item.after.subscriptionStartedAt)}`,
    );
  }
  if (item.before.subscriptionExpiresAt !== item.after.subscriptionExpiresAt) {
    changes.push(
      `Bitiş: ${formatDate(item.before.subscriptionExpiresAt)} → ${formatDate(item.after.subscriptionExpiresAt)}`,
    );
  }
  return changes;
}

function asLegacyBusiness(detail: AdminBusinessDetail): Business {
  const business = detail.business;
  return {
    id: business.id,
    slug: business.slug,
    name: business.name,
    description: business.description,
    whatsappOrderNumber: business.whatsappOrderNumber,
    email: detail.owner.email,
    createdAt: business.createdAt,
    category: business.category,
    city: business.city,
    district: business.district,
    neighborhood: business.neighborhood,
    address: business.address,
    deliveryStatus: business.deliveryStatus,
    paymentMethodMode: business.paymentMethodMode as Business["paymentMethodMode"],
    minimumOrderAmount: business.minimumOrderAmount,
    preparationTimeMinutes: business.preparationTimeMinutes,
    isOpen: business.isOpen,
    orderNote: business.orderNote,
    logoText: "",
    subscriptionStatus: business.subscriptionStatus,
    subscriptionStartedAt: business.subscriptionStartedAt,
    subscriptionExpiresAt: business.subscriptionExpiresAt,
    isActive: business.isActive,
    productCategories: [],
  };
}

export default function BusinessDetailClient({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [detail, setDetail] = useState<AdminBusinessDetail | null>(null);
  const [auditItems, setAuditItems] = useState<AdminBusinessAuditItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [message, setMessage] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editProfile, setEditProfile] = useState<EditableBusinessProfile>(
    emptyEditableProfile,
  );
  const [conflict, setConflict] = useState(false);
  const [manualDate, setManualDate] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const loadAuditHistory = useCallback(async () => {
    setAuditLoading(true);
    setAuditError("");
    try {
      const history = await fetchAdminBusinessAuditHistory(businessId);
      setAuditItems(history.items);
      return history.items;
    } catch (error) {
      if (
        error instanceof AdminBusinessRequestError &&
        (error.status === 401 ||
          error.code === "UNAUTHORIZED" ||
          error.code === "SESSION_EXPIRED")
      ) {
        setAuthorized(false);
        setDetail(null);
      } else if (
        error instanceof AdminBusinessRequestError &&
        error.code === "NOT_FOUND"
      ) {
        setNotFound(true);
        setDetail(null);
      } else {
        setAuditItems([]);
        setAuditError("İşlem geçmişi yüklenemedi.");
      }
      return null;
    } finally {
      setAuditLoading(false);
    }
  }, [businessId]);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setNotFound(false);
    try {
      const next = await fetchAdminBusinessDetail(businessId);
      setDetail(next);
      setManualDate(dateInputValue(next.business.subscriptionExpiresAt));
      await loadAuditHistory();
      return next;
    } catch (error) {
      if (error instanceof AdminBusinessRequestError && error.code === "NOT_FOUND") {
        setNotFound(true);
      } else if (error instanceof AdminBusinessRequestError && error.code === "UNAUTHORIZED") {
        setAuthorized(false);
        setDetail(null);
      } else {
        setLoadError("İşletme bilgileri yüklenemedi.");
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [businessId, loadAuditHistory]);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setAuditItems([]);
    setAuditError("");
    clearLegacyAdminBrowserSession();
    clearLegacyAdminBusinessCache();
    readAdminSession()
      .then(async (session) => {
        if (cancelled) return;
        if (!session) {
          setAuthorized(false);
          return;
        }
        setAuthorized(true);
        setCheckingSession(false);
        await loadDetail();
      })
      .catch(() => {
        if (!cancelled) setAuthorized(false);
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadDetail]);

  const legacyBusiness = useMemo(() => (detail ? asLegacyBusiness(detail) : null), [detail]);

  useEffect(() => {
    if (!confirmAction) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) setConfirmAction(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, confirmAction]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSigningIn(true);
    setLoginError("");
    try {
      if (!(await loginAdmin(email.trim(), password))) throw new Error();
      setAuthorized(true);
      setPassword("");
      await loadDetail();
    } catch {
      setLoginError("Admin girişi başarısız. E-posta veya şifreyi kontrol edin.");
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    await logoutAdmin();
    setAuthorized(false);
    setDetail(null);
    setAuditItems([]);
  }

  function beginEdit() {
    if (!detail || conflict) return;
    setEditProfile(editableProfileFromBusiness(detail.business));
    setEditing(true);
    setMessage("");
    setMutationError("");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || busy || conflict) return;
    setBusy(true);
    setMessage("");
    setMutationError("");
    setConflict(false);
    try {
      const updated = await updateAdminBusinessSafely(detail.business.id, {
        ...editProfile,
        expectedUpdatedAt: detail.business.updatedAt,
      });
      setDetail((current) =>
        current
          ? {
              ...current,
              business: {
                ...current.business,
                ...updated,
              },
            }
          : current,
      );
      setEditProfile(editableProfileFromBusiness(updated));
      setEditing(false);
      setMessage("İşletme profil bilgileri güncellendi.");
    } catch (error) {
      if (error instanceof AdminBusinessRequestError) {
        setMutationError(error.message);
        setConflict(error.code === "CONFLICT");
      } else {
        setMutationError("İşletme kaydedilemedi. Lütfen tekrar deneyin.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function loadLatestAfterConflict() {
    const latest = await loadDetail();
    if (!latest) return;
    setEditProfile(editableProfileFromBusiness(latest.business));
    setConflict(false);
    setMutationError("");
    setMessage("Güncel bilgiler yüklendi. Değişikliklerinizi yeniden kontrol edin.");
  }

  async function commitCriticalAction(
    mutate: (
      businessId: string,
      expectedUpdatedAt: string,
    ) => Promise<AdminBusinessCriticalMutationResult>,
    success: string,
  ) {
    if (!detail || busy || conflict) return;
    setBusy(true);
    setMessage("");
    setMutationError("");
    try {
      const result = await mutate(detail.business.id, detail.business.updatedAt);
      setDetail((current) =>
        current
          ? {
              ...current,
              business: mergeAdminBusinessCriticalState(
                current.business,
                result.business,
              ),
            }
          : current,
      );
      setManualDate(dateInputValue(result.business.subscriptionExpiresAt));
      setMessage(success);
      await loadAuditHistory();
    } catch (error) {
      if (error instanceof AdminBusinessRequestError) {
        if (error.code === "NOT_FOUND") {
          setNotFound(true);
          setDetail(null);
          setMutationError("");
        } else if (
          error.status === 401 ||
          error.code === "UNAUTHORIZED" ||
          error.code === "SESSION_EXPIRED"
        ) {
          setAuthorized(false);
          setDetail(null);
        } else {
          setMutationError(error.message);
          setConflict(error.code === "CONFLICT" || error.code === "INVALID_STATE");
        }
      } else {
        setMutationError("Kritik işlem tamamlanamadı. Lütfen tekrar deneyin.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function deleteBusiness() {
    if (!legacyBusiness?.id || busy) return;
    setBusy(true);
    try {
      await deleteBusinessInSupabase(legacyBusiness.id);
      router.push("/admin?section=businesses");
    } catch {
      setMutationError("İşletme silinemedi. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function runConfirmedAction() {
    if (!confirmAction || busy) return;
    const action = confirmAction;
    setConfirmAction(null);
    await action.run();
  }

  if (checkingSession) return <AdminLoading />;
  if (!authorized) {
    return (
      <AdminLogin
        email={email}
        error={loginError}
        isSubmitting={signingIn}
        password={password}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={submitLogin}
      />
    );
  }

  return (
    <AdminShell
      activeSection="businesses"
      isRefreshing={loading}
      onCreateBusiness={() => router.push("/admin")}
      onLogout={signOut}
      onNavigate={(section) =>
        router.push(section === "businesses" ? "/admin?section=businesses" : "/admin")
      }
      onRefresh={loadLatestAfterConflict}
      pageDescription="Kimlik, erişim, ayar ve operasyon bilgilerini güvenli biçimde yönetin."
      pageTitle="İşletme Detayı"
      refreshLabel="Bilgileri Yenile"
      showCreateAction={false}
    >
      <div className={styles.root}>
        <div className={styles.backRow}>
          <Link href="/admin?section=businesses">← İşletmelere Dön</Link>
        </div>

        {message ? <p className={styles.success} aria-live="polite">{message}</p> : null}
        {mutationError ? <p className={styles.error} role="alert">{mutationError}</p> : null}
        {conflict ? (
          <button className={styles.reloadButton} disabled={loading} type="button" onClick={loadLatestAfterConflict}>
            Güncel Bilgileri Yükle
          </button>
        ) : null}

        {loading && !detail ? (
          <div className={styles.skeleton} aria-label="İşletme bilgileri yükleniyor">
            <span /><span /><span />
          </div>
        ) : null}

        {notFound ? (
          <section className={styles.stateCard}>
            <h2>İşletme bulunamadı.</h2>
            <p>Bu UUID ile eşleşen bir işletme kaydı yok.</p>
            <Link href="/admin?section=businesses">İşletmelere Dön</Link>
          </section>
        ) : null}

        {loadError && !detail ? (
          <section className={styles.stateCard}>
            <h2>İşletme bilgileri yüklenemedi.</h2>
            <p>Lütfen bağlantınızı kontrol edip tekrar deneyin.</p>
            <button type="button" onClick={loadDetail}>Tekrar Dene</button>
          </section>
        ) : null}

        {detail && legacyBusiness ? (
          <>
            <section className={styles.identityCard}>
              <div>
                <span className={styles.eyebrow}>İşletme profili</span>
                <h2>{detail.business.name}</h2>
                <p>/{detail.business.slug}</p>
              </div>
              <div className={styles.badges}>
                <span className={detail.business.isActive ? styles.goodBadge : styles.dangerBadge}>
                  Platform: {detail.business.isActive ? "Aktif" : "Pasif"}
                </span>
                <span className={getBadge(legacyBusiness) === "Aktif" ? styles.goodBadge : styles.warningBadge}>
                  Abonelik: {getAdminSubscriptionStatusLabel(legacyBusiness)}
                </span>
              </div>
              <dl className={styles.identityDates}>
                <div><dt>Oluşturulma</dt><dd>{formatDateTime(detail.business.createdAt)}</dd></div>
                <div><dt>Son güncelleme</dt><dd>{formatDateTime(detail.business.updatedAt)}</dd></div>
              </dl>
            </section>

            <div className={styles.twoColumn}>
              <section className={styles.card}>
                <div className={styles.cardHeading}>
                  <div><span className={styles.eyebrow}>Temel bilgiler</span><h3>İşletme Kimliği</h3></div>
                  {!editing ? <button disabled={busy || conflict} type="button" onClick={beginEdit}>Düzenle</button> : null}
                </div>
                {editing ? (
                  <form className={styles.editForm} onSubmit={saveEdit}>
                    <div className={styles.editField}>
                      <label htmlFor="detail-business-name">İşletme adı</label>
                      <input
                        disabled={busy}
                        id="detail-business-name"
                        maxLength={160}
                        required
                        value={editProfile.name}
                        onChange={(event) =>
                          setEditProfile((current) => ({ ...current, name: event.target.value }))
                        }
                      />
                    </div>
                    <div className={styles.editField}>
                      <label htmlFor="detail-business-slug">Slug</label>
                      <input
                        disabled={busy}
                        id="detail-business-slug"
                        maxLength={100}
                        required
                        value={editProfile.slug}
                        onChange={(event) =>
                          setEditProfile((current) => ({ ...current, slug: event.target.value }))
                        }
                      />
                    </div>
                    <div className={styles.editField}>
                      <label htmlFor="detail-business-category">Kategori</label>
                      <input
                        disabled={busy}
                        id="detail-business-category"
                        value={editProfile.category}
                        onChange={(event) =>
                          setEditProfile((current) => ({ ...current, category: event.target.value }))
                        }
                      />
                    </div>
                    <div className={`${styles.editField} ${styles.fullWidth}`}>
                      <label htmlFor="detail-business-description">Açıklama</label>
                      <textarea
                        disabled={busy}
                        id="detail-business-description"
                        value={editProfile.description}
                        onChange={(event) =>
                          setEditProfile((current) => ({ ...current, description: event.target.value }))
                        }
                      />
                    </div>
                    <div className={`${styles.editField} ${styles.fullWidth}`}>
                      <label htmlFor="detail-business-whatsapp">WhatsApp sipariş numarası</label>
                      <input
                        disabled={busy}
                        id="detail-business-whatsapp"
                        inputMode="tel"
                        required
                        value={editProfile.whatsappOrderNumber}
                        onChange={(event) =>
                          setEditProfile((current) => ({
                            ...current,
                            whatsappOrderNumber: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <fieldset className={`${styles.editLocation} ${styles.fullWidth}`} disabled={busy}>
                      <legend>Konum</legend>
                      <LocationSelector
                        idPrefix="detailBusinessLocation"
                        required={false}
                        value={{
                          city: editProfile.city,
                          district: editProfile.district,
                          neighborhood: editProfile.neighborhood,
                        }}
                        onChange={(location) =>
                          setEditProfile((current) => ({ ...current, ...location }))
                        }
                      />
                    </fieldset>
                    <div className={`${styles.editField} ${styles.fullWidth}`}>
                      <label htmlFor="detail-business-address">Adres</label>
                      <textarea
                        disabled={busy}
                        id="detail-business-address"
                        value={editProfile.address}
                        onChange={(event) =>
                          setEditProfile((current) => ({ ...current, address: event.target.value }))
                        }
                      />
                    </div>
                    <p className={styles.fullWidth}>Profil alanları tek işlemde kaydedilir. Kayıt başka bir işlemde değişirse kaydetme durdurulur.</p>
                    <div className={styles.actions}>
                      <button className={styles.primaryButton} disabled={busy || conflict} type="submit">{busy ? "Kaydediliyor..." : "Değişiklikleri Kaydet"}</button>
                      <button disabled={busy} type="button" onClick={() => setEditing(false)}>Vazgeç</button>
                    </div>
                  </form>
                ) : (
                  <dl className={styles.infoList}>
                    <div><dt>İşletme adı</dt><dd>{detail.business.name}</dd></div>
                    <div><dt>Slug</dt><dd>/{detail.business.slug}</dd></div>
                    <div><dt>Kategori</dt><dd>{detail.business.category || "-"}</dd></div>
                    <div><dt>Açıklama</dt><dd>{detail.business.description || "-"}</dd></div>
                  </dl>
                )}
              </section>

              <section className={styles.card}>
                <span className={styles.eyebrow}>İşletme sahibi</span>
                <h3>Yetkili Hesap</h3>
                <dl className={styles.infoList}>
                  <div><dt>E-posta</dt><dd>{detail.owner.email || "-"}</dd></div>
                  <div><dt>Yetki</dt><dd>Salt okunur</dd></div>
                </dl>
                <p className={styles.help}>Sahip değişikliği ve e-posta düzenleme bu ekrandan yapılamaz.</p>
              </section>
            </div>

            <section className={styles.card}>
              <span className={styles.eyebrow}>Erişim ve abonelik</span>
              <h3>Platform Durumu</h3>
              <div className={styles.metricsGrid}>
                <div><span>Platform erişimi</span><strong>{detail.business.isActive ? "Aktif" : "Pasif"}</strong></div>
                <div><span>Abonelik</span><strong>{getAdminSubscriptionStatusLabel(legacyBusiness)}</strong></div>
                <div><span>Başlangıç</span><strong>{formatDate(detail.business.subscriptionStartedAt)}</strong></div>
                <div><span>Bitiş</span><strong>{formatDate(detail.business.subscriptionExpiresAt)}</strong></div>
                <div><span>Kalan gün</span><strong>{Math.max(0, getRemainingDays(detail.business.subscriptionExpiresAt))}</strong></div>
              </div>
              <div className={styles.extensionActions}>
                {extensionDays.map((days) => (
                  <button disabled={busy || conflict} key={days} type="button" onClick={() => setConfirmAction({
                    title: `+${days} gün abonelik`,
                    description: `Abonelik sunucu tarafından ${days} gün uzatılacak ve işletmenin güncel durumu uygulanacak.`,
                    run: () => commitCriticalAction(
                      (id, expectedUpdatedAt) => extendAdminBusinessSubscription(id, days, expectedUpdatedAt),
                      `${legacyBusiness.name} aboneliği ${days} gün uzatıldı.`,
                    ),
                  })}>+{days} Gün</button>
                ))}
              </div>
              <div className={styles.manualDate}>
                <label htmlFor="detail-subscription-date">Manuel abonelik bitiş tarihi</label>
                <div>
                  <input disabled={busy || conflict} id="detail-subscription-date" type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)} />
                  <button disabled={busy || conflict || !manualDate} type="button" onClick={() => setConfirmAction({
                    title: "Aboneliği düzelt",
                    description: "Seçilen takvim tarihi sunucuya aynen gönderilecek ve işletmenin güncel durumu sunucu tarafından uygulanacak.",
                    run: () => commitCriticalAction(
                      (id, expectedUpdatedAt) => setAdminBusinessSubscriptionDate(id, manualDate, expectedUpdatedAt),
                      `${legacyBusiness.name} abonelik bitiş tarihi güncellendi.`,
                    ),
                  })}>Kaydet</button>
                </div>
              </div>
            </section>

            <div className={styles.twoColumn}>
              <section className={styles.card}>
                <span className={styles.eyebrow}>İşletme ayarları</span>
                <h3>Salt Okunur Özet</h3>
                <dl className={styles.infoList}>
                  <div><dt>Açık/kapalı</dt><dd>{detail.business.isOpen ? "Açık" : "Kapalı"}</dd></div>
                  <div><dt>Ödeme</dt><dd>{paymentLabel(detail.business.paymentMethodMode)}</dd></div>
                  <div><dt>Minimum sipariş</dt><dd>{detail.business.minimumOrderAmount === null ? "-" : formatMoney(detail.business.minimumOrderAmount, "TRY")}</dd></div>
                  <div><dt>Hazırlık süresi</dt><dd>{detail.business.preparationTimeMinutes ? `${detail.business.preparationTimeMinutes} dk.` : "-"}</dd></div>
                  <div><dt>Teslimat</dt><dd>{detail.business.deliveryStatus || "-"}</dd></div>
                  <div><dt>Konum</dt><dd>{[detail.business.neighborhood, detail.business.district, detail.business.city].filter(Boolean).join(", ") || "-"}</dd></div>
                  <div><dt>Adres</dt><dd>{detail.business.address || "-"}</dd></div>
                  <div><dt>WhatsApp</dt><dd>{detail.business.whatsappOrderNumber || "-"}</dd></div>
                  <div><dt>Logo</dt><dd>{detail.business.logoUrl ? "Var" : "Yok"}</dd></div>
                  <div><dt>Kapak</dt><dd>{detail.business.coverImageUrl ? "Var" : "Yok"}</dd></div>
                  <div><dt>Sipariş notu</dt><dd>{detail.business.orderNote || "-"}</dd></div>
                </dl>
              </section>

              <section className={styles.card}>
                <span className={styles.eyebrow}>Operasyon özeti</span>
                <h3>Güncel Hareket</h3>
                <div className={styles.countGrid}>
                  <div><span>Ürün</span><strong>{detail.counts.products}</strong></div>
                  <div><span>Sipariş</span><strong>{detail.counts.orders}</strong></div>
                </div>
                {detail.lastOrder ? (
                  <dl className={styles.infoList}>
                    <div><dt>Son sipariş</dt><dd>#{detail.lastOrder.businessOrderNumber}</dd></div>
                    <div><dt>Durum</dt><dd>{orderStatusLabel(detail.lastOrder.status)}</dd></div>
                    <div><dt>Tutar</dt><dd>{formatMoney(detail.lastOrder.totalAmount, detail.lastOrder.currency)}</dd></div>
                    <div><dt>Tarih</dt><dd>{formatDateTime(detail.lastOrder.createdAt)}</dd></div>
                  </dl>
                ) : <p className={styles.help}>Henüz sipariş bulunmuyor.</p>}
              </section>
            </div>

            <section className={styles.card}>
              <span className={styles.eyebrow}>Son siparişler</span>
              <h3>Son {detail.recentOrders.length} Sipariş</h3>
              {detail.recentOrders.length ? (
                <div className={styles.orderList}>
                  {detail.recentOrders.map((order) => (
                    <article key={order.id}>
                      <div><span>Sipariş</span><strong>#{order.businessOrderNumber}</strong></div>
                      <div><span>Durum</span><strong>{orderStatusLabel(order.status)}</strong></div>
                      <div><span>Tür</span><strong>{orderTypeLabel(order.orderType)}</strong></div>
                      <div><span>Tutar</span><strong>{formatMoney(order.totalAmount, order.currency)}</strong></div>
                      <div><span>Tarih</span><strong>{formatDateTime(order.createdAt)}</strong></div>
                    </article>
                  ))}
                </div>
              ) : <p className={styles.help}>Henüz sipariş bulunmuyor.</p>}
            </section>

            <section className={styles.card}>
              <span className={styles.eyebrow}>Denetim kaydı</span>
              <h3>İşlem Geçmişi</h3>
              <p className={styles.help}>En yeni 20 kritik erişim ve abonelik işlemi gösterilir.</p>
              {auditLoading && !auditItems.length ? (
                <p className={styles.auditState} aria-live="polite">İşlem geçmişi yükleniyor...</p>
              ) : null}
              {auditError ? (
                <div className={styles.auditError} role="alert">
                  <p>{auditError}</p>
                  <button disabled={auditLoading} type="button" onClick={loadAuditHistory}>
                    Tekrar Dene
                  </button>
                </div>
              ) : null}
              {!auditLoading && !auditError && !auditItems.length ? (
                <p className={styles.auditState}>Henüz kayıtlı kritik işlem bulunmuyor.</p>
              ) : null}
              {auditItems.length ? (
                <div className={styles.auditList}>
                  {auditItems.map((item) => {
                    const changes = getAuditChangeSummaries(item);
                    return (
                      <article key={item.id}>
                        <div className={styles.auditHeading}>
                          <div>
                            <strong>{getAdminAuditActionLabel(item.action)}</strong>
                            <span>{item.actorEmail}</span>
                          </div>
                          <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                        </div>
                        {changes.length ? (
                          <ul>
                            {changes.map((change) => <li key={change}>{change}</li>)}
                          </ul>
                        ) : (
                          <p>Kritik erişim veya abonelik durumu kaydedildi.</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <section className={`${styles.card} ${styles.criticalCard}`}>
              <span className={styles.eyebrow}>Kritik işlemler</span>
              <h3>Erişim ve Kayıt İşlemleri</h3>
              <p className={styles.help}>İşlemler yalnız sunucu yanıtı başarıyla tamamlandıktan sonra ekrana yansır.</p>
              <div className={styles.criticalActions}>
                {legacyBusiness.isActive ? (
                  <button disabled={busy || conflict} type="button" onClick={() => setConfirmAction({
                    title: "Pasife al",
                    description: "İşletmenin platform erişimi kapatılacak; abonelik durumu ve tarihleri korunacak.",
                    critical: true,
                    run: () => commitCriticalAction(
                      deactivateAdminBusiness,
                      `${legacyBusiness.name} pasife alındı.`,
                    ),
                  })}>Pasife Al</button>
                ) : canReactivateBusinessAccess(legacyBusiness) ? (
                  <button disabled={busy || conflict} type="button" onClick={() => setConfirmAction({
                    title: "Aktife al",
                    description: "Geçerli abonelik korunarak platform erişimi tekrar açılacak.",
                    run: () => commitCriticalAction(
                      reactivateAdminBusiness,
                      `${legacyBusiness.name} aktif edildi.`,
                    ),
                  })}>Aktife Al</button>
                ) : null}
                <button disabled={busy || conflict} type="button" onClick={() => setConfirmAction({ title: "Engelle", description: "İşletme engellenecek ve erişimi kapatılacak.", critical: true, run: () => commitCriticalAction(blockAdminBusiness, `${legacyBusiness.name} engellendi.`) })}>Engelle</button>
                <button disabled={busy || conflict} type="button" onClick={() => setConfirmAction({ title: "Aboneliği sıfırla", description: "Abonelik tarihleri temizlenecek ve işletme pasife alınacak.", critical: true, run: () => commitCriticalAction(resetAdminBusinessSubscription, `${legacyBusiness.name} aboneliği sıfırlandı.`) })}>Aboneliği Sıfırla</button>
                <button disabled={busy} type="button" onClick={() => setConfirmAction({ title: "Kalıcı sil", description: "Bu işlem işletme ve ürün kayıtlarını geri alınamaz şekilde kaldıracak.", critical: true, run: deleteBusiness })}>Kalıcı Sil</button>
              </div>
            </section>
          </>
        ) : null}
      </div>

      {confirmAction ? (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setConfirmAction(null);
        }}>
          <section aria-describedby="detail-confirm-description" aria-labelledby="detail-confirm-title" aria-modal="true" className={styles.dialog} role="dialog">
            <span className={styles.eyebrow}>{confirmAction.critical ? "Kritik işlem" : "İşlem onayı"}</span>
            <h2 id="detail-confirm-title">{confirmAction.title}</h2>
            <p id="detail-confirm-description">{confirmAction.description}</p>
            <div className={styles.actions}>
              <button className={confirmAction.critical ? styles.dangerButton : styles.primaryButton} disabled={busy} type="button" onClick={runConfirmedAction}>Onayla</button>
              <button autoFocus disabled={busy} type="button" onClick={() => setConfirmAction(null)}>Vazgeç</button>
            </div>
          </section>
        </div>
      ) : null}
    </AdminShell>
  );
}
