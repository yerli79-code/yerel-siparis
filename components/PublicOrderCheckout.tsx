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
  verifiedWhatsAppMessage: string;
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
  onSendVerifiedWhatsApp: () => void;
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
  verifiedWhatsAppMessage,
  minimumOrderWarning,
  isOrderingOpen,
  isRecordingOrder,
  isOrderSubmitDisabled,
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
  onSendVerifiedWhatsApp,
  onSubmitOrder,
}: PublicOrderCheckoutProps) {
  return (
    <div className="public-order-checkout-page">
      <section
        aria-labelledby="public-order-cart-title"
        className="order-panel public-order-cart-panel public-order-cart-panel-open"
        id="public-order-cart-panel"
        ref={cartSectionRef}
      >
        <div className="order-inner section order-card public-order-cart-sheet">
          <header className="public-order-checkout-header">
            <button
              aria-label="Menüye dön"
              className="public-order-checkout-back"
              ref={cartCloseButtonRef}
              type="button"
              onClick={onCloseCheckout}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <h1 id="public-order-cart-title">Siparişi Tamamla</h1>
            <span aria-hidden="true" />
          </header>

          <form className="customer-form public-order-checkout-form" onSubmit={onSubmitOrder}>
            <section className="public-order-checkout-section public-order-cart-section">
              <div className="public-order-checkout-section-heading">
                <h2>Sepetiniz ({cartItemCount})</h2>
              </div>
              <div className="cart public-order-cart-items">
                {cart.length === 0 ? (
                  <p className="empty-cart">Sepetiniz boş.</p>
                ) : (
                  cart.map((item) => (
                    <div className="cart-item public-order-cart-item" key={item.id}>
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={item.name}
                          className="public-order-cart-item-image"
                          src={item.imageUrl}
                        />
                      ) : (
                        <div
                          aria-hidden="true"
                          className="public-order-cart-item-image public-order-cart-item-fallback"
                        >
                          {item.name.slice(0, 1).toLocaleUpperCase("tr-TR")}
                        </div>
                      )}
                      <div className="public-order-cart-item-main">
                        <div className="cart-line public-order-cart-line">
                          <strong>{item.name}</strong>
                          <span>{formatPrice(item.price * item.quantity)}</span>
                        </div>
                        <div className="cart-actions public-order-cart-actions">
                          <div
                            aria-label={`${item.name} adet kontrolü`}
                            className="quantity public-order-quantity"
                          >
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
                    </div>
                  ))
                )}
              </div>
              <div className="public-order-totals">
                <div className="public-order-total-row">
                  <span>Ara Toplam</span>
                  <strong>{formatPrice(total)}</strong>
                </div>
                <div className="cart-total public-order-cart-total">
                  <span>Genel Toplam</span>
                  <strong>{formatPrice(total)}</strong>
                </div>
              </div>
            </section>

            <section className="public-order-checkout-section public-order-type-field">
              <h2 className="order-type-label">Sipariş Türü</h2>
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
                  <span className="public-order-type-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" />
                      <circle cx="7" cy="18" r="2" />
                      <circle cx="18" cy="18" r="2" />
                    </svg>
                  </span>
                  <span className="public-order-type-copy">
                    <strong>Teslimat</strong>
                    <small>Adresime gelsin</small>
                  </span>
                  <span className="public-order-type-check" aria-hidden="true">
                    ✓
                  </span>
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
                  <span className="public-order-type-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M5 4h14l-1 7H6zM7 11v9M17 11v9M4 20h16" />
                    </svg>
                  </span>
                  <span className="public-order-type-copy">
                    <strong>Gel-al</strong>
                    <small>Hazır olduğunda alacağım</small>
                  </span>
                  <span className="public-order-type-check" aria-hidden="true">
                    ✓
                  </span>
                </button>
              </div>
            </section>

            <fieldset className="public-order-checkout-section public-order-payment-field">
              <legend>Ödeme Yöntemi</legend>
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

            <section className="public-order-checkout-section public-order-contact-section">
              <div className="public-order-form-heading">
              <span>İletişim Bilgileri</span>
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
              <div className="field public-order-field public-order-note-field">
                <label htmlFor="note">Sipariş Notu</label>
                <textarea
                  disabled={isRecordingOrder}
                  id="note"
                  value={customer.note}
                  onChange={(event) => onUpdateCustomer("note", event.target.value)}
                />
              </div>
            </section>

            <section className="public-order-checkout-section public-order-preferences-section">
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
                <p>Bilgiler yalnızca bu cihazda saklanır.</p>
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
            </section>

            {!isOrderingOpen ? (
              <p className="order-rule-warning public-order-rule-warning">
                Bu işletme şu an sipariş almıyor.
              </p>
            ) : minimumOrderWarning ? (
              <p className="order-rule-warning public-order-rule-warning">
                {minimumOrderWarning}
              </p>
            ) : null}
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
                {orderRecoveryMode === "saved" && verifiedWhatsAppMessage ? (
                  <button
                    className="submit-button secondary-whatsapp-button public-order-secondary-button"
                    disabled={isRecordingOrder}
                    type="button"
                    onClick={onSendVerifiedWhatsApp}
                  >
                    WhatsApp ile devam et
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
      </section>
    </div>
  );
}
