import type { Metadata } from "next";
import Link from "next/link";

const privacyUrl = "https://yerelsiparis.com/gizlilik";
const driveFileScope = "https://www.googleapis.com/auth/drive.file";

export const metadata: Metadata = {
  title: "Gizlilik Politikası",
  description:
    "Yerel Sipariş Google Drive yedekleme özelliğinin veri erişimi ve kullanımı hakkında gizlilik politikası.",
  alternates: {
    canonical: privacyUrl,
  },
};

export default function PrivacyPage() {
  return (
    <main className="page privacy-page">
      <div className="shell privacy-shell">
        <header className="privacy-header">
          <Link className="privacy-home-link" href="/">
            Ana sayfaya dön
          </Link>
          <h1>Gizlilik Politikası</h1>
          <p>
            Bu politika, Yerel Sipariş’in Google Drive tabanlı sistem yedekleme
            özelliği kapsamında Google Drive erişimini nasıl kullandığını açıklar.
          </p>
        </header>

        <article className="privacy-content">
          <section aria-labelledby="google-drive-yedekleme">
            <h2 id="google-drive-yedekleme">Google Drive Yedekleme</h2>
            <p>
              Google Drive erişimi yalnızca Yerel Sipariş sistem yedeklerini
              oluşturmak, yüklemek, yönetmek ve gerektiğinde geri yüklemek amacıyla
              kullanılır.
            </p>
          </section>

          <section aria-labelledby="google-drive-erisim-kapsami">
            <h2 id="google-drive-erisim-kapsami">Erişim kapsamı</h2>
            <p>
              Yerel Sipariş yalnızca{" "}
              <a href={driveFileScope}>{driveFileScope}</a> (<code>drive.file</code>)
              OAuth kapsamını ister.
            </p>
            <p>
              Kullanıcının diğer Google Drive dosyalarına genel veya sınırsız erişim
              istenmez.
            </p>
          </section>

          <section aria-labelledby="oauth-bilgilerinin-guvenligi">
            <h2 id="oauth-bilgilerinin-guvenligi">OAuth bilgilerinin güvenliği</h2>
            <p>
              OAuth client secret, authorization code, access token ve refresh token
              herkese açık hale getirilmez ve istemci tarafı koda yerleştirilmez.
            </p>
          </section>

          <section aria-labelledby="google-kullanici-verileri">
            <h2 id="google-kullanici-verileri">Google kullanıcı verileri</h2>
            <p>
              Google Drive yetkilendirmesi aracılığıyla erişilen Google kullanıcı
              verileri yalnızca yedek dosyalarını oluşturmak, yüklemek, yönetmek ve
              gerektiğinde geri yüklemek için kullanılır.
            </p>
            <p>Google kullanıcı verileri reklam amacıyla kullanılmaz ve satılmaz.</p>
          </section>

          <section aria-labelledby="erisimi-kaldirma">
            <h2 id="erisimi-kaldirma">Erişimi kaldırma</h2>
            <p>
              Kullanıcı, Yerel Sipariş’e verdiği erişimi{" "}
              <a href="https://myaccount.google.com/permissions">
                Google Account izinleri
              </a>{" "}
              üzerinden kaldırabilir.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
