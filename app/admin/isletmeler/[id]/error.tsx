"use client";

import Link from "next/link";
import styles from "./business-detail.module.css";

export default function BusinessDetailError({ reset }: { reset: () => void }) {
  return (
    <main className={styles.root}>
      <section className={styles.stateCard}>
        <h2>İşletme bilgileri yüklenemedi.</h2>
        <p>Beklenmeyen bir hata oluştu.</p>
        <button type="button" onClick={reset}>Tekrar Dene</button>
        <Link href="/admin?section=businesses">İşletmelere Dön</Link>
      </section>
    </main>
  );
}
