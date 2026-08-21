import { useEffect, useRef } from "react";
import type {
  BusinessOrder,
  BusinessOrderPagination,
  OrderStatus,
} from "../../lib/supabase-orders";
import styles from "./panel.module.css";
import PanelIcon from "./PanelIcon";
import {
  getOrderTypeLabel,
  type OrderPrintPaperWidth,
} from "./order-print";

type OrderStatusOption = [OrderStatus, string];

type PanelOrdersProps = {
  orders: BusinessOrder[];
  isLoadingOrders: boolean;
  ordersError: string;
  pagination: BusinessOrderPagination;
  pageSize: number;
  selectedOrderStatusFilter: OrderStatus | "all";
  searchDraft: string;
  dateFromDraft: string;
  dateToDraft: string;
  appliedSearch: string;
  appliedDateFrom: string;
  appliedDateTo: string;
  expandedOrderId: string;
  updatingOrderId: string;
  orderPrintPaperWidth: OrderPrintPaperWidth;
  orderStatusLabels: Record<OrderStatus, string>;
  orderStatusOptions: OrderStatusOption[];
  formatPrice: (price: number) => string;
  formatDateTime: (value: string) => string;
  getPaymentMethodLabel: (
    paymentMethod: BusinessOrder["paymentMethod"],
  ) => string;
  onSearchDraftChange: (value: string) => void;
  onDateFromDraftChange: (value: string) => void;
  onDateToDraftChange: (value: string) => void;
  onApplyFilters: () => void;
  onClearFilters: () => void;
  onStatusFilterChange: (statusFilter: OrderStatus | "all") => void;
  onPageSizeChange: (pageSize: number) => void;
  onPageChange: (page: number) => void;
  onRefreshOrders: () => void | Promise<void>;
  onOrderPrintPaperWidthChange: (paperWidth: OrderPrintPaperWidth) => void;
  onPrintOrder: (orderId: string) => void;
  onToggleOrderDetails: (orderId: string) => void;
  onUpdateOrderStatus: (
    orderId: string,
    status: OrderStatus,
  ) => void | Promise<void>;
};

export default function PanelOrders({
  orders,
  isLoadingOrders,
  ordersError,
  pagination,
  pageSize,
  selectedOrderStatusFilter,
  searchDraft,
  dateFromDraft,
  dateToDraft,
  appliedSearch,
  appliedDateFrom,
  appliedDateTo,
  expandedOrderId,
  updatingOrderId,
  orderPrintPaperWidth,
  orderStatusLabels,
  orderStatusOptions,
  formatPrice,
  formatDateTime,
  getPaymentMethodLabel,
  onSearchDraftChange,
  onDateFromDraftChange,
  onDateToDraftChange,
  onApplyFilters,
  onClearFilters,
  onStatusFilterChange,
  onPageSizeChange,
  onPageChange,
  onRefreshOrders,
  onOrderPrintPaperWidthChange,
  onPrintOrder,
  onToggleOrderDetails,
  onUpdateOrderStatus,
}: PanelOrdersProps) {
  const hasActiveFilters =
    selectedOrderStatusFilter !== "all" ||
    Boolean(appliedSearch || appliedDateFrom || appliedDateTo);
  const firstRecord =
    pagination.total > 0
      ? (pagination.page - 1) * pagination.pageSize + 1
      : 0;
  const lastRecord =
    pagination.total > 0
      ? Math.min(firstRecord + orders.length - 1, pagination.total)
      : 0;
  const recordSummary =
    pagination.total > 0 && orders.length > 0
      ? `${firstRecord}–${lastRecord} / ${pagination.total} kayıt`
      : `${pagination.total} kayıt`;
  const selectedOrder = orders.find((order) => order.id === expandedOrderId);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!selectedOrder) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToggleOrderDetails(selectedOrder.id);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      previouslyFocusedRef.current?.focus();
    };
  }, [selectedOrder?.id]);

  return (
    <section
      aria-busy={isLoadingOrders}
      className="section panel-section panel-orders-section business-panel-section"
    >
      <div className="business-panel-section-heading">
        <div>
          <span className="business-panel-section-kicker">Günlük operasyon</span>
          <h2>Siparişler</h2>
        </div>
        <span>{recordSummary}</span>
      </div>

      <form
        className="panel-order-filter-form"
        onSubmit={(event) => {
          event.preventDefault();
          onApplyFilters();
        }}
      >
        <label className="panel-order-filter-field panel-order-search-field">
          <span>Sipariş ara</span>
          <input
            disabled={isLoadingOrders}
            maxLength={80}
            placeholder="Sipariş no, müşteri adı veya telefon"
            type="search"
            value={searchDraft}
            onChange={(event) => onSearchDraftChange(event.target.value)}
          />
        </label>
        <div className="panel-order-date-fields">
          <label className="panel-order-filter-field">
            <span>Başlangıç</span>
            <input
              disabled={isLoadingOrders}
              max={dateToDraft || undefined}
              type="date"
              value={dateFromDraft}
              onChange={(event) => onDateFromDraftChange(event.target.value)}
            />
          </label>
          <label className="panel-order-filter-field">
            <span>Bitiş</span>
            <input
              disabled={isLoadingOrders}
              min={dateFromDraft || undefined}
              type="date"
              value={dateToDraft}
              onChange={(event) => onDateToDraftChange(event.target.value)}
            />
          </label>
        </div>
        <div className="panel-order-filter-actions">
          <button
            className="submit-button panel-primary-action"
            disabled={isLoadingOrders}
            type="submit"
          >
            Filtreleri Uygula
          </button>
          <button
            className="submit-button panel-secondary-action"
            disabled={isLoadingOrders}
            type="button"
            onClick={() => onClearFilters()}
          >
            Filtreleri Temizle
          </button>
        </div>
      </form>

      <div className="panel-order-toolbar">
        <div
          className="business-panel-order-filters"
          aria-label="Sipariş durum filtresi"
        >
          <button
            aria-pressed={selectedOrderStatusFilter === "all"}
            className={selectedOrderStatusFilter === "all" ? "active" : ""}
            disabled={isLoadingOrders}
            type="button"
            onClick={() => onStatusFilterChange("all")}
          >
            Tümü
          </button>
          {orderStatusOptions.map(([value, label]) => (
            <button
              aria-pressed={selectedOrderStatusFilter === value}
              className={selectedOrderStatusFilter === value ? "active" : ""}
              disabled={isLoadingOrders}
              key={value}
              type="button"
              onClick={() => onStatusFilterChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="submit-button panel-secondary-action panel-order-refresh"
          disabled={isLoadingOrders}
          type="button"
          onClick={() => onRefreshOrders()}
        >
          {isLoadingOrders ? "Yükleniyor..." : "Listeyi Yenile"}
        </button>
      </div>

      {!isLoadingOrders && ordersError ? (
        <div
          className="business-panel-inline-state error panel-orders-error"
          role="alert"
        >
          <p>{ordersError}</p>
          <button
            className="submit-button panel-secondary-action"
            type="button"
            onClick={() => onRefreshOrders()}
          >
            Tekrar dene
          </button>
        </div>
      ) : null}

      {isLoadingOrders && orders.length === 0 ? (
        <p className="empty-cart">Siparişler yükleniyor...</p>
      ) : orders.length === 0 ? (
        ordersError ? null : (
          <p className="empty-cart">
            {hasActiveFilters
              ? "Filtrelere uygun sipariş bulunamadı."
              : "Henüz sipariş yok."}
          </p>
        )
      ) : (
        <div className="panel-order-list">
          {orders.map((order) => {
            const orderTypeLabel = getOrderTypeLabel(order.orderType);
            const itemCount = order.items.reduce(
              (total, item) => total + item.quantity,
              0,
            );

            return (
              <article
                className={`panel-order-card ${
                  order.status === "new" ? "business-panel-order-new" : ""
                }`}
                key={order.id}
              >
                <button
                  aria-haspopup="dialog"
                  className="panel-order-row"
                  type="button"
                  onClick={() => onToggleOrderDetails(order.id)}
                >
                  <span className="panel-order-number">
                    <strong>#{order.orderNumber}</strong>
                    <small>{formatDateTime(order.createdAt)}</small>
                  </span>
                  <span className="panel-order-main">
                    <strong>{order.customerName}</strong>
                    <small>{itemCount} ürün</small>
                  </span>
                  <span className="panel-order-type">
                    <small>Teslimat</small>
                    <strong>{orderTypeLabel}</strong>
                  </span>
                  <span className="panel-order-payment">
                    <small>Ödeme</small>
                    <strong>{getPaymentMethodLabel(order.paymentMethod)}</strong>
                  </span>
                  <span className="panel-order-meta">
                    <strong>{formatPrice(order.totalAmount)}</strong>
                    <span>
                      {new Date(order.createdAt).toLocaleTimeString("tr-TR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                  <span
                    className={`order-status-badge order-status-${order.status}`}
                  >
                    {orderStatusLabels[order.status]}
                  </span>
                  <span className="panel-order-toggle" aria-hidden="true">
                    <PanelIcon name="arrow" size={17} />
                  </span>
                </button>
              </article>
            );
          })}
        </div>
      )}

      {selectedOrder ? (
        <div
          className="panel-order-detail-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onToggleOrderDetails(selectedOrder.id);
            }
          }}
        >
          <aside
            aria-labelledby="panel-order-detail-title"
            aria-modal="true"
            className="panel-order-detail"
            role="dialog"
          >
            <header className="panel-order-detail-header">
              <div>
                <span>Sipariş detayı</span>
                <h3 id="panel-order-detail-title">
                  Sipariş #{selectedOrder.orderNumber}
                </h3>
              </div>
              <button
                aria-label="Sipariş detayını kapat"
                ref={closeButtonRef}
                type="button"
                onClick={() => onToggleOrderDetails(selectedOrder.id)}
              >
                <PanelIcon name="close" size={21} />
              </button>
            </header>

            <div className="panel-order-detail-scroll">
              <span
                className={`order-status-badge order-status-${selectedOrder.status}`}
              >
                {orderStatusLabels[selectedOrder.status]}
              </span>

              <section className="panel-order-detail-block">
                <span>Müşteri</span>
                <strong>{selectedOrder.customerName}</strong>
                <a href={`tel:${selectedOrder.customerPhone}`}>
                  {selectedOrder.customerPhone}
                </a>
              </section>

              <section className="panel-order-detail-block">
                <span>Teslimat Şekli</span>
                <strong>{getOrderTypeLabel(selectedOrder.orderType)}</strong>
                {selectedOrder.orderType === "delivery" ? (
                  <p className="panel-order-address">
                    {selectedOrder.customerAddress || "Adres belirtilmedi."}
                  </p>
                ) : null}
              </section>

              <section className="panel-order-detail-block">
                <span>Ödeme</span>
                <strong>{getPaymentMethodLabel(selectedOrder.paymentMethod)}</strong>
                <p>
                  {selectedOrder.orderType === "delivery"
                    ? "Ödeme teslimat sırasında işletmeye yapılır."
                    : "Ödeme sipariş teslim alınırken işletmeye yapılır."}
                </p>
              </section>

              <section className="panel-order-detail-block">
                <span>Ürünler</span>
                <div className="panel-order-items">
                  {selectedOrder.items.map((item) => (
                    <div className="panel-order-item" key={item.id}>
                      <span>
                        <strong>{item.productName}</strong>
                        <small>
                          {item.quantity} x {formatPrice(item.unitPrice)}
                        </small>
                      </span>
                      <b>{formatPrice(item.lineTotal)}</b>
                    </div>
                  ))}
                  <div className="panel-order-detail-total">
                    <span>Toplam</span>
                    <strong>{formatPrice(selectedOrder.totalAmount)}</strong>
                  </div>
                </div>
              </section>

              {selectedOrder.customerNote ? (
                <section className="panel-order-detail-block panel-order-note">
                  <span>Sipariş Notu</span>
                  <p>{selectedOrder.customerNote}</p>
                </section>
              ) : null}

              <label className="panel-order-detail-status">
                <span>Durum</span>
                <select
                  disabled={updatingOrderId === selectedOrder.id}
                  value={selectedOrder.status}
                  onChange={(event) =>
                    onUpdateOrderStatus(
                      selectedOrder.id,
                      event.target.value as OrderStatus,
                    )
                  }
                >
                  {orderStatusOptions.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>

            <footer className="panel-order-detail-actions">
              <div className={styles.orderPrintControls}>
                <label className={styles.orderPrintWidthField}>
                  <span>Fiş genişliği</span>
                  <select
                    value={orderPrintPaperWidth}
                    onChange={(event) => {
                      const { value } = event.target;
                      if (value !== "58mm" && value !== "80mm") return;
                      onOrderPrintPaperWidthChange(value);
                    }}
                  >
                    <option value="58mm">58 mm</option>
                    <option value="80mm">80 mm</option>
                  </select>
                </label>
                <button
                  aria-label={`#${selectedOrder.orderNumber} numaralı siparişi yazdır`}
                  className={`submit-button panel-primary-action ${styles.orderPrintButton}`}
                  disabled={updatingOrderId === selectedOrder.id}
                  type="button"
                  onClick={() => onPrintOrder(selectedOrder.id)}
                >
                  <PanelIcon name="printer" size={17} />
                  Yazdır
                </button>
                <p className={styles.orderPrintHint}>
                  Yazıcınıza uygun kâğıt boyutunu seçin.
                </p>
              </div>
            </footer>
          </aside>
        </div>
      ) : null}

      <div className="panel-order-pagination-footer">
        <label className="panel-order-page-size">
          <span>Sayfa başına</span>
          <select
            disabled={isLoadingOrders}
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </label>
        <div className="panel-order-pagination" aria-label="Sipariş sayfalama">
          <button
            className="submit-button panel-secondary-action"
            disabled={isLoadingOrders || !pagination.hasPreviousPage}
            type="button"
            onClick={() => onPageChange(pagination.page - 1)}
          >
            Önceki
          </button>
          <span>
            Sayfa {pagination.page} / {pagination.totalPages}
          </span>
          <button
            className="submit-button panel-secondary-action"
            disabled={isLoadingOrders || !pagination.hasNextPage}
            type="button"
            onClick={() => onPageChange(pagination.page + 1)}
          >
            Sonraki
          </button>
        </div>
      </div>
    </section>
  );
}
