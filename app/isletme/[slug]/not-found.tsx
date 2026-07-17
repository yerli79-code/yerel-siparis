import Link from "next/link";

export default function BusinessNotFound() {
  return (
    <main className="page">
      <div className="shell section">
        <h1>İşletme bulunamadı</h1>
        <Link href="/">Ana sayfaya dön</Link>
      </div>
    </main>
  );
}
