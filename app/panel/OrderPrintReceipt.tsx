import styles from "./panel.module.css";
import type { OrderPrintReceiptModel } from "./order-print";

type OrderPrintReceiptProps = {
  receipt: OrderPrintReceiptModel;
};

export default function OrderPrintReceipt({
  receipt,
}: OrderPrintReceiptProps) {
  const paperWidthClass =
    receipt.paperWidth === "58mm"
      ? styles.orderPrintReceipt58
      : styles.orderPrintReceipt80;

  return (
    <article
      aria-hidden="true"
      className={`${styles.orderPrintReceipt} ${paperWidthClass}`}
    >
      <header className={styles.orderPrintHeader}>
        <h2>{receipt.businessName}</h2>
        {receipt.businessAddress ? <p>{receipt.businessAddress}</p> : null}
        {receipt.businessWhatsapp ? (
          <p>
            <strong>İşletme WhatsApp:</strong> {receipt.businessWhatsapp}
          </p>
        ) : null}
        <h3>SİPARİŞ FİŞİ</h3>
        <strong className={styles.orderPrintNumber}>
          #{receipt.orderNumber}
        </strong>
      </header>

      <dl className={styles.orderPrintDetails}>
        <div>
          <dt>Tarih ve saat</dt>
          <dd>{receipt.formattedCreatedAt}</dd>
        </div>
        <div>
          <dt>Sipariş türü</dt>
          <dd>{receipt.orderTypeLabel}</dd>
        </div>
        <div>
          <dt>Müşteri</dt>
          <dd>{receipt.customerName}</dd>
        </div>
        <div>
          <dt>Telefon</dt>
          <dd>{receipt.customerPhone}</dd>
        </div>
        <div>
          <dt>
            {receipt.orderTypeLabel === "Teslimat"
              ? "Teslimat adresi"
              : "Teslim alma"}
          </dt>
          <dd>{receipt.customerAddressOrPickupMessage}</dd>
        </div>
        <div>
          <dt>Ödeme yöntemi</dt>
          <dd>{receipt.paymentMethodLabel}</dd>
        </div>
      </dl>

      <section className={styles.orderPrintItems} aria-label="Ürün kalemleri">
        <h4>Ürünler</h4>
        {receipt.items.map((item, index) => (
          <div className={styles.orderPrintItem} key={`${index}-${item.productName}`}>
            <strong>{item.productName}</strong>
            <div>
              <span>
                {item.quantity} × {item.formattedUnitPrice}
              </span>
              <b>{item.formattedLineTotal}</b>
            </div>
          </div>
        ))}
      </section>

      <div className={styles.orderPrintTotal}>
        <span>Genel toplam</span>
        <strong>{receipt.formattedTotal}</strong>
      </div>

      {receipt.customerNote ? (
        <section className={styles.orderPrintNote}>
          <h4>Müşteri notu</h4>
          <p>{receipt.customerNote}</p>
        </section>
      ) : null}

      <div className={styles.orderPrintStatus}>
        <span>Sipariş durumu</span>
        <strong>{receipt.statusLabel}</strong>
      </div>

      <footer className={styles.orderPrintFooter}>
        Yerel Sipariş üzerinden oluşturuldu.
      </footer>
    </article>
  );
}
