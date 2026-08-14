import type { Business } from "../../../lib/businesses";
import { formatDate, getBadge, type AdminKpis } from "../../../lib/subscription";
import AdminKpiCard from "./admin-kpi-card";
import styles from "./admin.module.css";

type AdminOverviewProps = {
  attentionBusinesses: Business[];
  kpis: AdminKpis;
  onCreateBusiness: () => void;
  onManageBusinesses: () => void;
  onOpenBusiness: (business: Business) => void;
};

export default function AdminOverview({
  attentionBusinesses,
  kpis,
  onCreateBusiness,
  onManageBusinesses,
  onOpenBusiness,
}: AdminOverviewProps) {
  return (
    <section className={styles.overview} id="genel-bakis" aria-labelledby="overview-title">
      <div className={styles.overviewHeading}>
        <div>
          <span className={styles.sectionEyebrow}>Yönetim özeti</span>
          <h2 id="overview-title">Platform Durumu</h2>
          <p>İşletmelerin güncel durumunu ve yaklaşan abonelik ihtiyaçlarını izleyin.</p>
        </div>
        <button type="button" onClick={onManageBusinesses}>
          Tüm İşletmeler
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className={styles.kpiGrid} aria-label="İşletme durum göstergeleri">
        <AdminKpiCard icon="business" label="Toplam İşletme" value={kpis.total} description="Kayıtlı işletmeler" />
        <AdminKpiCard icon="active" label="Aktif İşletme" value={kpis.active} description="Erişime açık" />
        <AdminKpiCard icon="inactive" label="Pasif İşletme" value={kpis.inactive} description="Erişime kapalı" />
        <AdminKpiCard icon="recent" label="Son 7 Günde Eklenen" value={kpis.createdLastSevenDays} description="Yeni işletmeler" />
        <AdminKpiCard icon="subscription" label="Aktif Abonelik" value={kpis.activeSubscriptions} description="Süresi devam eden" />
        <AdminKpiCard icon="expiring" label="Yakında Sona Erecek" value={kpis.expiringSubscriptions} description="Önümüzdeki 30 gün" />
      </div>

      <div className={styles.overviewLowerGrid}>
        <section className={styles.attentionCard} aria-labelledby="attention-title">
          <div className={styles.attentionHeading}>
            <div>
              <h3 id="attention-title">Dikkat Gerektirenler</h3>
              <p>Abonelik veya erişim durumu gözden geçirilmeli.</p>
            </div>
            <span>{attentionBusinesses.length}</span>
          </div>
          {attentionBusinesses.length > 0 ? (
            <div className={styles.attentionList}>
              {attentionBusinesses.map((business) => {
                const badge = getBadge(business);
                return (
                  <button key={business.id || business.slug} type="button" onClick={() => onOpenBusiness(business)}>
                    <span className={styles.businessAvatar} aria-hidden="true">
                      {business.name.trim().slice(0, 1).toLocaleUpperCase("tr-TR") || "İ"}
                    </span>
                    <span className={styles.attentionBusiness}>
                      <strong>{business.name}</strong>
                      <small>{formatDate(business.subscriptionExpiresAt)}</small>
                    </span>
                    <span
                      className={`${styles.attentionBadge} ${
                        badge === "Aktif"
                          ? styles.attentionBadgeActive
                          : styles.attentionBadgeWarning
                      }`}
                    >
                      {badge}
                    </span>
                    <span className={styles.attentionArrow} aria-hidden="true">›</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className={styles.attentionEmpty}>Şu anda dikkat gerektiren işletme bulunmuyor.</p>
          )}
        </section>

        <aside className={styles.quickActionCard} aria-labelledby="quick-action-title">
          <span className={styles.quickActionIcon} aria-hidden="true">+</span>
          <div>
            <h3 id="quick-action-title">Yeni işletme ekleyin</h3>
            <p>İşletme profilini ve ilk abonelik durumunu tek adımda oluşturun.</p>
          </div>
          <button type="button" onClick={onCreateBusiness}>İşletme Oluştur</button>
        </aside>
      </div>
    </section>
  );
}
