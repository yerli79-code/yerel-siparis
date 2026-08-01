import type { BusinessOrder, OrderStatus } from "../../lib/supabase-orders";

type OrderStatusOption = [OrderStatus, string];

type PanelOrdersProps = {
  orders: BusinessOrder[];
  isLoadingOrders: boolean;
  ordersError: string;
  selectedOrderStatusFilter: OrderStatus | "all";
  expandedOrderId: string;
  updatingOrderId: string;
  orderStatusLabels: Record<OrderStatus, string>;
  orderStatusOptions: OrderStatusOption[];
  formatPrice: (price: number) => string;
  formatDateTime: (value: string) => string;
  getPaymentMethodLabel: (
    paymentMethod: BusinessOrder["paymentMethod"],
  ) => string;
  onStatusFilterChange: (statusFilter: OrderStatus | "all") => void;
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
  selectedOrderStatusFilter,
  expandedOrderId,
  updatingOrderId,
  orderStatusLabels,
  orderStatusOptions,
  formatPrice,
  formatDateTime,
  getPaymentMethodLabel,
  onStatusFilterChange,
  onRefreshOrders,
  onToggleOrderDetails,
  onUpdateOrderStatus,
}: PanelOrdersProps) {
  return (
    <section className="section panel-section panel-orders-section business-panel-section">
      <div className="business-panel-section-heading">
        <div>
          <span className="business-panel-section-kicker">Günlük operasyon</span>
          <h2>Siparişler</h2>
        </div>
        <span>{orders.length} kayıt</span>
      </div>

      <div className="panel-order-toolbar">
        <div
          className="business-panel-order-filters"
          aria-label="Sipariş durum filtresi"
        >
          <button
            aria-pressed={selectedOrderStatusFilter === "all"}
            className={selectedOrderStatusFilter === "all" ? "active" : ""}
            type="button"
            onClick={() => onStatusFilterChange("all")}
          >
            Tümü
          </button>
          {orderStatusOptions.map(([value, label]) => (
            <button
              aria-pressed={selectedOrderStatusFilter === value}
              className={selectedOrderStatusFilter === value ? "active" : ""}
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

      {isLoadingOrders ? (
        <p className="empty-cart">Siparişler yükleniyor...</p>
      ) : orders.length === 0 ? (
        ordersError ? null : (
          <p className="empty-cart">Henüz sipariş yok.</p>
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
    </section>
  );
}
