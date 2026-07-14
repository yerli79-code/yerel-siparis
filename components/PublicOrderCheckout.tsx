import type { FormEventHandler, RefObject } from "react";
import type { Product } from "../lib/businesses";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
} from "../lib/payment-methods";

export type PublicOrderCartItem = Product & { quantity: number };

export type PublicOrderCustomer = {
  fullName: string;
  phone: string;
  address: string;
  note: string;
};

export type PublicOrderType = "delivery" | "pickup";

export type PublicOrderRecoveryMode =
  | "none"
  | "saved"
  | "definitive"
  | "uncertain"
  | "conflict";

type FixedPaymentOption = (typeof PAYMENT_METHODS)[number];

type PublicOrderCheckoutProps = {
  cart: PublicOrderCartItem[];
  cartItemCount: number;
  total: number;
  customer: PublicOrderCustomer;
  orderType: PublicOrderType;
  paymentMethod: PaymentMethod | "";
  fixedPaymentOption: FixedPaymentOption | null;
  paymentMethodError: string;
  rememberCustomerDetails: boolean;
  hasSavedCustomerDetails: boolean;
  warning: string;
  orderRecordWarning: string;
  orderRecoveryMode: PublicOrderRecoveryMode;
  fallbackWhatsAppMessage: string;
  minimumOrderWarning: string;
  isOrderingOpen: boolean;
  isRecordingOrder: boolean;
  isOrderSubmitDisabled: boolean;
  isMobileViewport: boolean;
  cartSectionRef: RefObject<HTMLElement | null>;
  cartCloseButtonRef: RefObject<HTMLButtonElement | null>;
  formatPrice: (price: number) => string;
  onCloseCheckout: () => void;
  onIncreaseItem: (productId: string) => void;
  onDecreaseItem: (productId: string) => void;
  onUpdateOrderType: (orderType: PublicOrderType) => void;
  onUpdatePaymentMethod: (paymentMethod: PaymentMethod) => void;
  onUpdateCustomer: (field: keyof PublicOrderCustomer, value: string) => void;
  onToggleRememberCustomerDetails: (shouldRemember: boolean) => void;
  onClearSavedCustomerDetails: () => void;
  onRetryPendingOrder: () => void;
  onSendFallbackWhatsApp: () => void;
  onSubmitOrder: FormEventHandler<HTMLFormElement>;
};

export default function PublicOrderCheckout({
  cart,
  cartItemCount,
  total,
  customer,
  orderType,
  paymentMethod,
  fixedPaymentOption,
  paymentMethodError,
  rememberCustomerDetails,
  hasSavedCustomerDetails,
  warning,
  orderRecordWarning,
  orderRecoveryMode,
  fallbackWhatsAppMessage,
  minimumOrderWarning,
  isOrderingOpen,
  isRecordingOrder,
  isOrderSubmitDisabled,
  isMobileViewport,
  cartSectionRef,
  cartCloseButtonRef,
  formatPrice,
  onCloseCheckout,
  onIncreaseItem,
  onDecreaseItem,
  onUpdateOrderType,
  onUpdatePaymentMethod,
  onUpdateCustomer,
  onToggleRememberCustomerDetails,
  onClearSavedCustomerDetails,
  onRetryPendingOrder,
  onSendFallbackWhatsApp,
  onSubmitOrder,
}: PublicOrderCheckoutProps) {
  return (
    <div className="layout public-order-layout">
      {isMobileViewport ? (
        <button
          aria-hidden="true"
          className="public-order-cart-backdrop"
          tabIndex={-1}
          type="button"
          onClick={onCloseCheckout}
        />
      ) : null}
      <aside
        aria-labelledby="public-order-cart-title"
        aria-modal={isMobileViewport ? true : undefined}
        className="order-panel public-order-cart-panel public-order-cart-panel-open"
        id="public-order-cart-panel"
        ref={cartSectionRef}
        role={isMobileViewport ? "dialog" : undefined}
      >
        <div className="order-inner section order-card public-order-cart-sheet">
          <div className="section-title public-order-cart-header">
            <div>
              <span className="public-order-cart-grip" aria-hidden="true" />
              <h2 id="public-order-cart-title">Sepetim</h2>
              <span>{cartItemCount} adet ürün</span>
            </div>
            <button
              aria-label="Sepeti kapat"
              className={
                isMobileViewport
                  ? "public-order-cart-close"
                  : "clear-saved-customer-button"
              }
              ref={cartCloseButtonRef}
              type="button"
              onClick={onCloseCheckout}
            >
              {isMobileViewport ? "×" : "Menüye dön"}
            </button>
          </div>

          <form className="customer-form public-order-checkout-form" onSubmit={onSubmitOrder}>
            {!isOrderingOpen ? (
              <p className="order-rule-warning public-order-rule-warning">
                Bu işletme şu an sipariş almıyor.
              </p>
            ) : minimumOrderWarning ? (
              <p className="order-rule-warning public-order-rule-warning">
                {minimumOrderWarning}
              </p>
            ) : null}

            <div className="field public-order-type-field">
              <span className="order-type-label">Sipariş Türü</span>
              <div
                className="order-type-toggle public-order-type-toggle"
                role="group"
                aria-label="Sipariş türü"
              >
                <button
                  aria-pressed={orderType === "delivery"}
                  className={`order-type-button public-order-type-button ${
                    orderType === "delivery" ? "selected" : ""
                  }`}
                  disabled={isRecordingOrder}
                  type="button"
                  onClick={() => onUpdateOrderType("delivery")}
                >
                  Teslimat
                </button>
                <button
                  aria-pressed={orderType === "pickup"}
                  className={`order-type-button public-order-type-button ${
                    orderType === "pickup" ? "selected" : ""
                  }`}
                  disabled={isRecordingOrder}
                  type="button"
                  onClick={() => onUpdateOrderType("pickup")}
                >
                  Gel-al
                </button>
              </div>
            </div>

            <fieldset className="public-order-payment-field">
              <legend>Ödeme yöntemi</legend>
              {fixedPaymentOption ? (
                <div className="public-order-payment-fixed">
                  <strong>{fixedPaymentOption.displayLabel}</strong>
                  <span>
                    {fixedPaymentOption.value === "card"
                      ? "Ödeme teslimat veya gel-al sırasında fiziksel POS ile yapılır. Online ödeme alınmaz."
                      : "Bu işletme yalnız nakit ödeme kabul ediyor."}
                  </span>
                </div>
              ) : (
                <>
                  <div className="public-order-payment-options">
                    {PAYMENT_METHODS.map((option) => (
                      <label
                        className={`public-order-payment-option${
                          paymentMethod === option.value ? " selected" : ""
                        }`}
                        key={option.value}
                      >
                        <input
                          checked={paymentMethod === option.value}
                          disabled={isRecordingOrder}
                          name="paymentMethod"
                          type="radio"
                          value={option.value}
                          onChange={() => onUpdatePaymentMethod(option.value)}
                        />
                        <span>{option.displayLabel}</span>
                      </label>
                    ))}
                  </div>
                  <p className="public-order-payment-help">
                    Kart ödemesi teslimat veya gel-al sırasında fiziksel POS ile yapılır.
                    Online ödeme alınmaz.
                  </p>
                </>
              )}
              {paymentMethodError ? (
                <p className="public-order-payment-error" role="alert">
                  {paymentMethodError}
                </p>
              ) : null}
            </fieldset>

            <div className="cart public-order-cart-items">
              {cart.length === 0 ? (
                <p className="empty-cart">Sepetiniz boş.</p>
              ) : (
                cart.map((item) => (
                  <div className="cart-item public-order-cart-item" key={item.id}>
                    <div className="cart-line public-order-cart-line">
                      <strong>{item.name}</strong>
                      <span>{formatPrice(item.price * item.quantity)}</span>
                    </div>
                    <div className="cart-actions">
                      <div className="quantity public-order-quantity">
                        <button
                          aria-label={`${item.name} adedini azalt`}
                          className="quantity-button public-order-quantity-button"
                          disabled={!isOrderingOpen || isRecordingOrder}
                          type="button"
                          onClick={() => onDecreaseItem(item.id)}
                        >
                          −
                        </button>
                        <strong aria-label={`${item.quantity} adet`}>{item.quantity}</strong>
                        <button
                          aria-label={`${item.name} adedini artır`}
                          className="quantity-button public-order-quantity-button"
                          disabled={!isOrderingOpen || isRecordingOrder}
                          type="button"
                          onClick={() => onIncreaseItem(item.id)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="cart-total public-order-cart-total">
              <span>Genel Toplam</span>
              <strong>{formatPrice(total)}</strong>
            </div>

            <div className="public-order-form-heading">
              <span>Siparişi tamamla</span>
              <p>Bilgilerinizi girin, siparişinizi güvenle oluşturalım.</p>
            </div>
            <div className="field public-order-field">
              <label htmlFor="fullName">Ad Soyad *</label>
              <input
                autoComplete="name"
                disabled={isRecordingOrder}
                id="fullName"
                value={customer.fullName}
                onChange={(event) => onUpdateCustomer("fullName", event.target.value)}
              />
            </div>
            <div className="field public-order-field">
              <label htmlFor="phone">Telefon *</label>
              <input
                autoComplete="tel"
                disabled={isRecordingOrder}
                id="phone"
                inputMode="tel"
                value={customer.phone}
                onChange={(event) => onUpdateCustomer("phone", event.target.value)}
              />
            </div>
            {orderType === "delivery" ? (
              <div className="field public-order-field">
                <label htmlFor="address">Teslimat Adresi *</label>
                <textarea
                  autoComplete="street-address"
                  disabled={isRecordingOrder}
                  id="address"
                  value={customer.address}
                  onChange={(event) => onUpdateCustomer("address", event.target.value)}
                />
              </div>
            ) : (
              <p className="pickup-address-hint public-order-pickup-hint">
                Gel-al siparişlerinde adres gerekmez.
              </p>
            )}
            <div className="customer-remember-panel public-order-remember-panel">
              <label className="customer-remember-option public-order-remember-option">
                <input
                  checked={rememberCustomerDetails}
                  className="customer-remember-checkbox"
                  disabled={isRecordingOrder}
                  type="checkbox"
                  onChange={(event) =>
                    onToggleRememberCustomerDetails(event.target.checked)
                  }
                />
                <span>Bilgilerimi bu cihazda hatırla</span>
              </label>
              <p>Ortak cihazlarda bilgilerinizi kaydetmeyin.</p>
              {hasSavedCustomerDetails ? (
                <button
                  className="clear-saved-customer-button"
                  disabled={isRecordingOrder}
                  type="button"
                  onClick={onClearSavedCustomerDetails}
                >
                  Kaydedilen bilgileri sil
                </button>
              ) : null}
            </div>
            <p className="order-data-note public-order-data-note">
              Siparişinizi hazırlamak ve takip etmek için adınız, telefonunuz, teslimat
              adresiniz ve sipariş notunuz işletmenin sipariş panelinde siparişin
              oluşturulmasından 180 gün sonra periyodik olarak silinir. Gel-al
              siparişlerinde adres kaydedilmez.
            </p>
            <div className="field public-order-field">
              <label htmlFor="note">Sipariş Notu</label>
              <textarea
                disabled={isRecordingOrder}
                id="note"
                value={customer.note}
                onChange={(event) => onUpdateCustomer("note", event.target.value)}
              />
            </div>
            {warning ? (
              <p className="alert public-order-alert" role="alert">
                {warning}
              </p>
            ) : null}
            {orderRecordWarning ? (
              <div
                className={`order-record-fallback public-order-recovery${
                  orderRecoveryMode === "uncertain" ? " order-record-uncertain" : ""
                }`}
              >
                <p>{orderRecordWarning}</p>
                {orderRecoveryMode === "uncertain" ? (
                  <button
                    className="submit-button order-retry-button public-order-retry-button"
                    disabled={isRecordingOrder}
                    type="button"
                    onClick={onRetryPendingOrder}
                  >
                    {isRecordingOrder
                      ? "Sipariş kontrol ediliyor..."
                      : "Siparişi tekrar dene"}
                  </button>
                ) : null}
                {orderRecoveryMode !== "conflict" && fallbackWhatsAppMessage ? (
                  <button
                    className="submit-button secondary-whatsapp-button public-order-secondary-button"
                    disabled={isRecordingOrder}
                    type="button"
                    onClick={onSendFallbackWhatsApp}
                  >
                    {orderRecoveryMode === "uncertain"
                      ? "Yine de numarasız WhatsApp ile gönder"
                      : orderRecoveryMode === "saved"
                        ? "WhatsApp ile devam et"
                        : "WhatsApp ile yine de gönder"}
                  </button>
                ) : null}
              </div>
            ) : null}
            <button
              className="submit-button public-order-submit-button"
              disabled={isOrderSubmitDisabled}
              type="submit"
            >
              {isRecordingOrder
                ? "Sipariş kaydediliyor..."
                : "WhatsApp ile Sipariş Oluştur"}
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}
