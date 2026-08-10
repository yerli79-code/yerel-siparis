import type { BusinessOrder } from "../../lib/supabase-orders";
import {
  formatOrderPrintCurrency,
  getOrderTypeLabel,
  type OrderPrintPaperWidth,
} from "./order-print";

type NewOrderAlertProps = {
  order: BusinessOrder;
  pendingCount: number;
  paperWidth: OrderPrintPaperWidth;
  connectionWarning: boolean;
  onPaperWidthChange: (paperWidth: OrderPrintPaperWidth) => void;
  onViewOrder: (order: BusinessOrder) => void;
  onPrintOrder: (order: BusinessOrder) => void;
  onDismiss: (orderId: string) => void;
};

export default function NewOrderAlert({
  order,
  pendingCount,
  paperWidth,
  connectionWarning,
  onPaperWidthChange,
  onViewOrder,
  onPrintOrder,
  onDismiss,
}: NewOrderAlertProps) {
  return (
    <section className="new-order-alert" role="alert" aria-atomic="true">
      <div className="new-order-alert-copy">
        <div className="new-order-alert-heading">
          <span className="new-order-alert-kicker">
            {pendingCount === 1
              ? "Yeni sipariş geldi"
              : `${pendingCount} yeni sipariş geldi`}
          </span>
          <strong>#{order.orderNumber}</strong>
        </div>
        <div className="new-order-alert-details">
          <span>{order.customerName}</span>
          <span>{formatOrderPrintCurrency(order.totalAmount, order.currency)}</span>
          <span>{getOrderTypeLabel(order.orderType)}</span>
          <span>{paperWidth === "58mm" ? "58 mm fiş" : "80 mm fiş"}</span>
        </div>
        {pendingCount > 1 ? (
          <small>Diğer {pendingCount - 1} sipariş sırada.</small>
        ) : null}
        {connectionWarning ? (
          <small className="new-order-alert-connection" role="status">
            Yeni sipariş kontrolü bağlantı gelince otomatik sürecek.
          </small>
        ) : null}
      </div>
      <div className="new-order-alert-actions">
        <label>
          <span>Kağıt</span>
          <select
            aria-label="Yeni sipariş fiş genişliği"
            value={paperWidth}
            onChange={(event) =>
              onPaperWidthChange(event.target.value as OrderPrintPaperWidth)
            }
          >
            <option value="80mm">80 mm</option>
            <option value="58mm">58 mm</option>
          </select>
        </label>
        <button type="button" onClick={() => onViewOrder(order)}>
          Siparişi Gör
        </button>
        <button className="new-order-alert-print" type="button" onClick={() => onPrintOrder(order)}>
          Yazdır
        </button>
        <button className="new-order-alert-dismiss" type="button" onClick={() => onDismiss(order.id)}>
          Kapat
        </button>
      </div>
    </section>
  );
}
