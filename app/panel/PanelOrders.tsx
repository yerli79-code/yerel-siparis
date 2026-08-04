import type {
  BusinessOrder,
  BusinessOrderPagination,
  OrderStatus,
} from "../../lib/supabase-orders";

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
            const isExpanded = expandedOrderId === order.id;
            const orderTypeLabel =
              order.orderType === "delivery" ? "Teslimat" : "Gel-al";

            return (
              <article
                className={`panel-order-card ${
                  order.status === "new" ? "business-panel-order-new" : ""
                }`}
                key={order.id}
              >
                <button
                  aria-expanded={isExpanded}
                  className="panel-order-row"
                  type="button"
                  onClick={() => onToggleOrderDetails(order.id)}
                >
                  <span className="panel-order-main">
                    <strong>#{order.orderNumber}</strong>
                    <span>
                      {orderTypeLabel} · {order.customerName}
                    </span>
                  </span>
                  <span className="panel-order-meta">
                    <strong>{formatPrice(order.totalAmount)}</strong>
                    <span>{formatDateTime(order.createdAt)}</span>
                  </span>
                  <span
                    className={`order-status-badge order-status-${order.status}`}
                  >
                    {orderStatusLabels[order.status]}
                  </span>
                  <span className="panel-order-toggle">
                    {isExpanded ? "Kapat" : "Detay"}
                  </span>
                </button>

                {isExpanded ? (
                  <div className="panel-order-detail">
                    <div className="panel-order-detail-grid">
                      <p>
                        <strong>Telefon</strong>
                        <span>{order.customerPhone}</span>
                      </p>
                      <p>
                        <strong>Sipariş türü</strong>
                        <span>{orderTypeLabel}</span>
                      </p>
                      <p>
                        <strong>Ödeme yöntemi</strong>
                        <span>{getPaymentMethodLabel(order.paymentMethod)}</span>
                      </p>
                      <p>
                        <strong>Durum</strong>
                        <select
                          disabled={updatingOrderId === order.id}
                          value={order.status}
                          onChange={(event) =>
                            onUpdateOrderStatus(
                              order.id,
                              event.target.value as OrderStatus,
                            )
                          }
                        >
                          {orderStatusOptions.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </p>
                    </div>

                    <div className="panel-order-address">
                      <strong>
                        {order.orderType === "delivery"
                          ? "Teslimat adresi"
                          : "Gel-al siparişi"}
                      </strong>
                      <span>
                        {order.orderType === "delivery"
                          ? order.customerAddress || "Adres belirtilmedi."
                          : "Müşteri siparişi işletmeden teslim alacak."}
                      </span>
                    </div>

                    {order.customerNote ? (
                      <div className="panel-order-note">
                        <strong>Müşteri notu</strong>
                        <span>{order.customerNote}</span>
                      </div>
                    ) : null}

                    <div className="panel-order-items">
                      {order.items.map((item) => (
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
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

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
