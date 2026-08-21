import type { FormEventHandler, RefObject } from "react";
import type { Product } from "../lib/businesses";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
} from "../lib/payment-methods";
import type { PublicOrderDeliveryAddress } from "../lib/public-order-address";

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
  deliveryAddress: PublicOrderDeliveryAddress;
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
  onClearCart: () => void;
  onIncreaseItem: (productId: string) => void;
  onDecreaseItem: (productId: string) => void;
  onUpdateOrderType: (orderType: PublicOrderType) => void;
  onUpdatePaymentMethod: (paymentMethod: PaymentMethod) => void;
  onUpdateCustomer: (field: keyof PublicOrderCustomer, value: string) => void;
  onUpdateDeliveryAddress: (
    field: keyof PublicOrderDeliveryAddress,
    value: string,
  ) => void;
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
  deliveryAddress,
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
  isMobileViewport,
  cartSectionRef,
  cartCloseButtonRef,
  formatPrice,
  onCloseCheckout,
  onClearCart,
  onIncreaseItem,
  onDecreaseItem,
  onUpdateOrderType,
  onUpdatePaymentMethod,
  onUpdateCustomer,
  onUpdateDeliveryAddress,
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
        aria-modal={isMobileViewport ? true : undefined}
        className="order-panel public-order-cart-panel public-order-cart-panel-open"
        id="public-order-cart-panel"
        ref={cartSectionRef}
        role={isMobileViewport ? "dialog" : undefined}
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
            <div className="public-order-checkout-title">
              <h1 id="public-order-cart-title">Sipariş detayları</h1>
              <p>Bilgilerinizi tamamlayın, siparişinizi güvenle iletelim.</p>
            </div>
            <span aria-hidden="true" />
          </header>

          <form className="customer-form public-order-checkout-form" onSubmit={onSubmitOrder}>
            <div className="public-order-checkout-grid">
              <div className="public-order-checkout-main">
              <section className="public-order-checkout-section public-order-type-field">
              <div className="public-order-section-title">
                <span>1</span>
                <div>
                  <h2 className="order-type-label">Nasıl teslim alacaksınız?</h2>
                  <p>Teslimat veya işletmeden gel-al seçeneğini belirleyin.</p>
                </div>
              </div>
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
                    <strong>Gel-Al</strong>
                    <small>Hazır olduğunda alacağım</small>
                  </span>
                  <span className="public-order-type-check" aria-hidden="true">
                    ✓
                  </span>
                </button>
              </div>
            </section>

            {orderType === "delivery" ? (
              <section className="public-order-checkout-section public-order-address-section">
                <div className="public-order-section-title">
                  <span>2</span>
                  <div>
                    <h2>Teslimat adresi</h2>
                    <p>Açık adres zorunludur; diğer alanlar doğru teslimata yardımcı olur.</p>
                  </div>
                </div>
                <div className="public-order-address-grid">
                  <div className="field public-order-field">
                    <label htmlFor="deliveryDistrict">İlçe</label>
                    <input
                      autoComplete="address-level2"
                      disabled={isRecordingOrder}
                      id="deliveryDistrict"
                      value={deliveryAddress.district}
                      onChange={(event) =>
                        onUpdateDeliveryAddress("district", event.target.value)
                      }
                    />
                  </div>
                  <div className="field public-order-field">
                    <label htmlFor="deliveryNeighborhood">Mahalle</label>
                    <input
                      autoComplete="address-level3"
                      disabled={isRecordingOrder}
                      id="deliveryNeighborhood"
                      value={deliveryAddress.neighborhood}
                      onChange={(event) =>
                        onUpdateDeliveryAddress("neighborhood", event.target.value)
                      }
                    />
                  </div>
                  <div className="field public-order-field public-order-address-wide">
                    <label htmlFor="deliveryStreetAddress">Açık Adres *</label>
                    <textarea
                      autoComplete="street-address"
                      disabled={isRecordingOrder}
                      id="deliveryStreetAddress"
                      required
                      value={deliveryAddress.streetAddress}
                      onChange={(event) =>
                        onUpdateDeliveryAddress("streetAddress", event.target.value)
                      }
                    />
                  </div>
                  <div className="field public-order-field">
                    <label htmlFor="deliveryBuilding">Apartman / Bina</label>
                    <input
                      disabled={isRecordingOrder}
                      id="deliveryBuilding"
                      value={deliveryAddress.building}
                      onChange={(event) =>
                        onUpdateDeliveryAddress("building", event.target.value)
                      }
                    />
                  </div>
                  <div className="field public-order-field">
                    <label htmlFor="deliveryFloorUnit">Kat / Daire</label>
                    <input
                      disabled={isRecordingOrder}
                      id="deliveryFloorUnit"
                      value={deliveryAddress.floorUnit}
                      onChange={(event) =>
                        onUpdateDeliveryAddress("floorUnit", event.target.value)
                      }
                    />
                  </div>
                  <div className="field public-order-field public-order-address-wide">
                    <label htmlFor="deliveryDirections">Adres Tarifi</label>
                    <textarea
                      disabled={isRecordingOrder}
                      id="deliveryDirections"
                      value={deliveryAddress.directions}
                      onChange={(event) =>
                        onUpdateDeliveryAddress("directions", event.target.value)
                      }
                    />
                  </div>
                </div>
              </section>
            ) : (
              <section className="public-order-checkout-section public-order-pickup-section">
                <div className="public-order-section-title">
                  <span>2</span>
                  <div>
                    <h2>Gel-Al</h2>
                    <p>Hazır olduğunda işletmeden teslim alabilirsiniz; adres gerekmez.</p>
                  </div>
                </div>
              </section>
            )}

            <section className="public-order-checkout-section public-order-contact-section">
              <div className="public-order-section-title">
                <span>3</span>
                <div>
                  <h2>İletişim bilgileri</h2>
                  <p>İşletmenin siparişiniz için size ulaşabileceği bilgileri girin.</p>
                </div>
              </div>
              <div className="public-order-contact-grid">
                <div className="field public-order-field">
                  <label htmlFor="fullName">Ad Soyad *</label>
                  <input
                    autoComplete="name"
                    disabled={isRecordingOrder}
                    id="fullName"
                    required
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
                    required
                    type="tel"
                    value={customer.phone}
                    onChange={(event) => onUpdateCustomer("phone", event.target.value)}
                  />
                </div>
              </div>
            </section>

            <fieldset className="public-order-checkout-section public-order-payment-field">
              <legend className="public-order-section-title">
                <span>4</span>
                <span className="public-order-legend-copy">
                  <strong>Ödeme tercihi</strong>
                  <small>Online ödeme alınmaz.</small>
                </span>
              </legend>
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
                  </p>
                </>
              )}
              {paymentMethodError ? (
                <p className="public-order-payment-error" role="alert">
                  {paymentMethodError}
                </p>
              ) : null}
            </fieldset>

            <section className="public-order-checkout-section public-order-note-section">
              <div className="public-order-section-title public-order-section-title-plain">
                <div>
                  <h2>Sipariş notu</h2>
                  <p>Ürün hazırlığıyla ilgili notunuzu işletmeye iletin.</p>
                </div>
              </div>
              <div className="field public-order-field public-order-note-field">
                <label htmlFor="note">Sipariş Notu</label>
                <textarea
                  disabled={isRecordingOrder}
                  id="note"
                  placeholder="Örn. sos ayrı olsun (opsiyonel)"
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
              <p className="public-order-whatsapp-notice">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M20 11.5a8.5 8.5 0 0 1-12.6 7.45L3 20l1.08-4.18A8.5 8.5 0 1 1 20 11.5Z" />
                  <path d="M8.2 8.1c.4 2.2 2.2 4 4.4 4.5l1.1-1.1 2.1 1v1.7c0 .7-.6 1.3-1.3 1.3A7.9 7.9 0 0 1 6.6 7.6c0-.7.6-1.3 1.3-1.3h1.7l1 2.1-1.1 1.1" />
                </svg>
                <span>
                  Girdiğiniz iletişim ve sipariş bilgileri, siparişinizin işletmeye
                  iletilmesi amacıyla WhatsApp üzerinden aktarılacaktır.
                </span>
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
                    WhatsApp’ta Devam Et
                  </button>
                ) : null}
              </div>
            ) : null}
            <button
              className="submit-button public-order-submit-button whatsapp-order-submit"
              disabled={isOrderSubmitDisabled}
              type="submit"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M20 11.5a8.5 8.5 0 0 1-12.6 7.45L3 20l1.08-4.18A8.5 8.5 0 1 1 20 11.5Z" />
                <path d="M8.2 8.1c.4 2.2 2.2 4 4.4 4.5l1.1-1.1 2.1 1v1.7c0 .7-.6 1.3-1.3 1.3A7.9 7.9 0 0 1 6.6 7.6c0-.7.6-1.3 1.3-1.3h1.7l1 2.1-1.1 1.1" />
              </svg>
              <span>
                {isRecordingOrder ? "Sipariş kaydediliyor..." : "WhatsApp’ta Devam Et"}
              </span>
              {!isRecordingOrder ? <strong>{formatPrice(total)}</strong> : null}
            </button>
              </div>

              <aside className="public-order-checkout-summary" aria-label="Sepet özeti">
                <section className="public-order-checkout-section public-order-cart-section">
                  <div className="public-order-checkout-section-heading">
                    <div>
                      <span>Siparişiniz</span>
                      <h2>Sepetim ({cartItemCount})</h2>
                    </div>
                    {cart.length > 0 && isOrderingOpen && orderRecoveryMode !== "saved" ? (
                      <button
                        className="public-order-clear-cart-button"
                        disabled={isRecordingOrder}
                        type="button"
                        onClick={onClearCart}
                      >
                        Temizle
                      </button>
                    ) : null}
                  </div>
                  <div className="cart public-order-cart-items">
                    {cart.length === 0 ? (
                      <p className="empty-cart">Sepetiniz boş.</p>
                    ) : (
                      cart.map((item) => (
                        <div className="cart-item public-order-cart-item" key={item.id}>
                          {item.imageUrl ? (
                            <img
                              alt=""
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
                      ))
                    )}
                  </div>
                  <div className="public-order-totals">
                    <div className="public-order-total-row">
                      <span>Ara toplam</span>
                      <strong>{formatPrice(total)}</strong>
                    </div>
                    <div className="cart-total public-order-cart-total">
                      <span>Toplam</span>
                      <strong>{formatPrice(total)}</strong>
                    </div>
                  </div>
                </section>
              </aside>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
