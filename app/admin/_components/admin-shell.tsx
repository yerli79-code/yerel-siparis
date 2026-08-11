"use client";

import { useEffect, useState, type ReactNode } from "react";
import PlatformBrand from "../../../components/PlatformBrand";
import styles from "./admin.module.css";

export type AdminSection = "overview" | "businesses" | "create";
type AdminNavigationSection = Exclude<AdminSection, "create">;

type AdminShellProps = {
  activeSection: AdminSection;
  children: ReactNode;
  isRefreshing: boolean;
  onCreateBusiness: () => void;
  onLogout: () => void;
  onNavigate: (section: AdminNavigationSection) => void;
  onRefresh: () => void;
};

const sectionCopy: Record<AdminSection, { title: string; description: string }> = {
  overview: {
    title: "Genel Bakış",
    description: "İşletmelerin genel durumunu tek bakışta takip edin.",
  },
  businesses: {
    title: "İşletmeler",
    description: "Mevcut işletme kayıtlarını ve aboneliklerini yönetin.",
  },
  create: {
    title: "Yeni İşletme",
    description: "Yeni bir işletme ve yetkili hesabı oluşturun.",
  },
};

function OverviewIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
    </svg>
  );
}

function BusinessIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 20V7l8-4 8 4v13M8 10h.01M12 10h.01M16 10h.01M8 14h.01M16 14h.01M10 20v-4h4v4" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" />
    </svg>
  );
}

export default function AdminShell({
  activeSection,
  children,
  isRefreshing,
  onCreateBusiness,
  onLogout,
  onNavigate,
  onRefresh,
}: AdminShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const activeNavigation = activeSection === "overview" ? "overview" : "businesses";
  const copy = sectionCopy[activeSection];

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsMobileMenuOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isMobileMenuOpen]);

  function navigate(section: AdminNavigationSection) {
    onNavigate(section);
    setIsMobileMenuOpen(false);
  }

  const navigation = (
    <nav className={styles.navigation} aria-label="Yönetim paneli bölümleri">
      <span className={styles.navigationLabel}>Yönetim</span>
      <button
        aria-current={activeNavigation === "overview" ? "page" : undefined}
        className={activeNavigation === "overview" ? styles.navigationActive : ""}
        type="button"
        onClick={() => navigate("overview")}
      >
        <OverviewIcon />
        <span>Genel Bakış</span>
      </button>
      <button
        aria-current={activeNavigation === "businesses" ? "page" : undefined}
        className={activeNavigation === "businesses" ? styles.navigationActive : ""}
        type="button"
        onClick={() => navigate("businesses")}
      >
        <BusinessIcon />
        <span>İşletmeler</span>
      </button>
    </nav>
  );

  return (
    <div className={styles.shellRoot}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <PlatformBrand className={styles.sidebarLogo} onDark />
          <span>Yönetim Paneli</span>
        </div>
        {navigation}
        <button className={styles.sidebarLogout} type="button" onClick={onLogout}>
          <LogoutIcon />
          <span>Çıkış Yap</span>
        </button>
      </aside>

      <div className={styles.mainColumn}>
        <header className={styles.mobileHeader}>
          <div className={styles.mobileIdentity}>
            <PlatformBrand className={styles.mobileLogo} />
            <div className={styles.mobileTitle}>
              <span>Yönetim Paneli</span>
              <h1>{copy.title}</h1>
            </div>
          </div>
          <button
            aria-controls="admin-mobile-navigation"
            aria-expanded={isMobileMenuOpen}
            aria-label={isMobileMenuOpen ? "Menüyü kapat" : "Menüyü aç"}
            className={styles.menuButton}
            type="button"
            onClick={() => setIsMobileMenuOpen((current) => !current)}
          >
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              {isMobileMenuOpen ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </header>

        <button
          aria-label="Menüyü kapat"
          className={`${styles.mobileBackdrop} ${isMobileMenuOpen ? styles.mobileBackdropVisible : ""}`}
          tabIndex={isMobileMenuOpen ? 0 : -1}
          type="button"
          onClick={() => setIsMobileMenuOpen(false)}
        />
        <div
          className={`${styles.mobileNavigationPanel} ${isMobileMenuOpen ? styles.mobileNavigationPanelOpen : ""}`}
          id="admin-mobile-navigation"
          aria-hidden={!isMobileMenuOpen}
          inert={!isMobileMenuOpen ? true : undefined}
        >
          <div className={styles.mobileNavigationHead}>
            <strong>Yönetim Paneli</strong>
            <span>Menü</span>
          </div>
          {navigation}
          <button
            className={styles.mobileCreateButton}
            type="button"
            onClick={() => {
              onCreateBusiness();
              setIsMobileMenuOpen(false);
            }}
          >
            Yeni İşletme Ekle
          </button>
          <button className={styles.mobileLogout} type="button" onClick={onLogout}>
            <LogoutIcon />
            <span>Çıkış Yap</span>
          </button>
        </div>

        <header className={styles.pageHeader}>
          <div>
            <span className={styles.pageEyebrow}>Yönetim Paneli</span>
            <h1>{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
          <div className={styles.pageActions}>
            <button disabled={isRefreshing} type="button" onClick={onRefresh}>
              <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path d="M20 6v5h-5M4 18v-5h5M6.1 8a7 7 0 0 1 11.8-2L20 8M4 16l2.1 2a7 7 0 0 0 11.8-2" />
              </svg>
              {isRefreshing ? "Yenileniyor..." : "Listeyi Yenile"}
            </button>
            <button className={styles.primaryAction} type="button" onClick={onCreateBusiness}>
              <span aria-hidden="true">+</span>
              Yeni İşletme
            </button>
          </div>
        </header>

        <main className={styles.mainContent}>{children}</main>
      </div>
    </div>
  );
}
