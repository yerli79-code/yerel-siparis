import Link from "next/link";
import type { RefObject } from "react";
import type { Business, Product, ProductCategory } from "../lib/businesses";

type PublicOrderBusiness = Business & {
  city?: string | null;
  logoUrl?: string | null;
};

type CategoryOption = ProductCategory & {
  filterKey: string;
};

type PublicOrderMenuCartItem = Product & {
  quantity: number;
};

type PublicOrderMenuProps = {
  business: PublicOrderBusiness;
  logoText: string;
  addressText: string;
  orderInfoItems: string[];
  orderNote: string;
  accessMessage: string;
  isOrderingOpen: boolean;
  hasAnyProducts: boolean;
  categories: CategoryOption[];
  visibleCategories: ProductCategory[];
  cart: PublicOrderMenuCartItem[];
  selectedCategory: string;
  searchQuery: string;
  allCategoryKey: string;
  allCategoriesLabel: string;
  totalProductCount: number;
  cartLength: number;
  cartItemCount: number;
  total: number;
  isMobileViewport: boolean;
  isRecordingOrder: boolean;
  cartTriggerRef: RefObject<HTMLButtonElement | null>;
  formatPrice: (price: number) => string;
  onSelectCategory: (categoryKey: string) => void;
  onSearchQueryChange: (query: string) => void;
  onAddItem: (product: Product) => void;
  onDecreaseItem: (productId: string) => void;
  onIncreaseItem: (productId: string) => void;
  onOpenCheckout: () => void;
};

export default function PublicOrderMenu({
  business,
  logoText,
  addressText,
  orderInfoItems,
  orderNote,
  accessMessage,
  isOrderingOpen,
  hasAnyProducts,
  categories,
  visibleCategories,
  cart,
  selectedCategory,
  searchQuery,
  allCategoryKey,
  allCategoriesLabel,
  totalProductCount,
  cartLength,
  cartItemCount,
  total,
  isMobileViewport,
  isRecordingOrder,
  cartTriggerRef,
  formatPrice,
  onSelectCategory,
  onSearchQueryChange,
  onAddItem,
  onDecreaseItem,
  onIncreaseItem,
  onOpenCheckout,
}: PublicOrderMenuProps) {
  const hasActiveSearch = searchQuery.trim().length > 0;
  const shouldShowCartBar = cartLength > 0 && isOrderingOpen;
  const businessSecondaryText =
    [addressText, business.address].filter(Boolean).join(" · ") ||
    business.description;

  return (
    <>
      <header className="hero business-hero public-order-hero">
        <div className="hero-content business-hero-content public-order-hero-content">
          <Link
            aria-label="İşletmelere dön"
            className="public-order-back-link"
            href="/"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>

          <div className="business-identity public-order-identity">
            {business.logoUrl ? (
              <img
                alt={business.name}
                className="business-logo public-order-logo"
                src={business.logoUrl}
              />
            ) : (
              <span className="business-logo-text public-order-logo">{logoText}</span>
            )}
            <div className="public-order-identity-copy">
              <h1>{business.name}</h1>
              <span className="public-order-platform-label">Yerel Sipariş&apos;te</span>
              {businessSecondaryText ? <p>{businessSecondaryText}</p> : null}
            </div>
          </div>
          <span
            aria-label={isOrderingOpen ? "İşletme siparişe açık" : "İşletme siparişe kapalı"}
            className={`public-order-status ${isOrderingOpen ? "open" : "closed"}`}
          >
            <span aria-hidden="true" />
            {isOrderingOpen ? "Açık" : "Kapalı"}
          </span>
        </div>
      </header>

      {orderInfoItems.length > 0 || orderNote ? (
        <section
          className="business-order-info public-order-info"
          aria-label="Sipariş bilgileri"
        >
          {orderInfoItems.length > 0 ? (
            <div className="business-order-badges public-order-badges">
              {orderInfoItems.map((item) => (
                <span
                  className={`business-order-badge public-order-badge ${
                    item === "Şu an kapalı" ? "closed" : ""
                  }`}
                  key={item}
                >
                  {item}
                </span>
              ))}
            </div>
          ) : null}
          {orderNote ? (
            <p className="business-order-note public-order-note">
              <strong>Sipariş notu:</strong> {orderNote}
            </p>
          ) : null}
        </section>
      ) : null}

      {accessMessage ? (
        <section className="section access-message public-order-access-message">
          <h2>Sipariş alınamıyor</h2>
          <p>{accessMessage}</p>
        </section>
      ) : (
        <div className="layout public-order-layout">
          <section
            className={`section menu-section public-order-menu ${
              shouldShowCartBar ? "public-order-menu-with-cart" : ""
            }`}
          >
            {!isOrderingOpen ? (
              <p className="manual-order-warning public-order-rule-warning">
                Bu işletme şu an sipariş almıyor.
              </p>
            ) : null}
            <div className="menu-heading public-order-menu-heading">
              <h2>Menü</h2>
              <span>{totalProductCount} ürün</span>
            </div>
            {hasAnyProducts ? (
              <label className="public-order-search">
                <span className="public-order-search-label">Menüde ürün ara</span>
                <svg
                  aria-hidden="true"
                  className="public-order-search-icon"
                  viewBox="0 0 24 24"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
                <input
                  type="search"
                  value={searchQuery}
                  placeholder="Menüde ara"
                  onChange={(event) => onSearchQueryChange(event.target.value)}
                />
              </label>
            ) : null}
            {hasAnyProducts ? (
              <div
                className="menu-category-tabs public-order-category-tabs"
                aria-label="Kategori menüsü"
              >
                <button
                  className={`menu-category-tab public-order-category-tab ${
                    selectedCategory === allCategoryKey ? "selected" : ""
                  }`}
                  type="button"
                  onClick={() => onSelectCategory(allCategoryKey)}
                >
                  {allCategoriesLabel} ({totalProductCount})
                </button>
                {categories.map((category) => (
                  <button
                    className={`menu-category-tab public-order-category-tab ${
                      selectedCategory === category.filterKey ? "selected" : ""
                    }`}
                    key={category.id}
                    type="button"
                    onClick={() => onSelectCategory(category.filterKey)}
                  >
                    {category.name} ({category.products.length})
                  </button>
                ))}
              </div>
            ) : null}
            {!hasAnyProducts ? (
              <div className="menu-empty-state public-order-empty-state">
                <strong>Menü henüz hazır değil.</strong>
                <p>Bu işletme ürünlerini eklediğinde burada görünecek.</p>
              </div>
            ) : visibleCategories.length === 0 ? (
              <div
                className="menu-empty-state public-order-empty-state"
                aria-live="polite"
              >
                {hasActiveSearch ? (
                  <strong>Aramanıza uygun ürün bulunamadı.</strong>
                ) : (
                  <>
                    <strong>Bu kategoride ürün yok.</strong>
                    <p>Başka bir kategori seçerek menüye göz atabilirsiniz.</p>
                  </>
                )}
              </div>
            ) : null}
            {visibleCategories.map((category) => (
              <div className="category public-order-category" key={category.id}>
                {category.name ? (
                  <h3 className="category-title public-order-category-title">
                    {category.name}
                  </h3>
                ) : null}
                <div className="products public-order-products">
                  {category.products.map((product) => {
                    const quantity =
                      cart.find((item) => item.id === product.id)?.quantity ?? 0;

                    return (
                      <article
                        className="product-card menu-product-card public-order-product"
                        key={product.id}
                      >
                        {product.imageUrl ? (
                          <img
                            alt={product.name}
                            className="product-card-image public-order-product-image"
                            src={product.imageUrl}
                          />
                        ) : (
                          <span className="product-image-placeholder public-order-product-image">
                            {product.imageLabel || category.name}
                          </span>
                        )}
                        <div className="public-order-product-details">
                          <div className="product-copy public-order-product-copy">
                            <p className="product-name">{product.name}</p>
                            {product.description ? (
                              <p className="product-description">
                                {product.description}
                              </p>
                            ) : null}
                          </div>
                          <div className="public-order-product-footer">
                            <span className="price">{formatPrice(product.price)}</span>
                            <div className="public-order-product-actions">
                              {quantity > 0 ? (
                                <div
                                  className="public-order-product-stepper"
                                  aria-label={`${product.name} adet kontrolü`}
                                >
                                  <button
                                    aria-label={`${product.name} adetini azalt`}
                                    disabled={!isOrderingOpen || isRecordingOrder}
                                    type="button"
                                    onClick={() => onDecreaseItem(product.id)}
                                  >
                                    −
                                  </button>
                                  <output aria-live="polite">{quantity}</output>
                                  <button
                                    aria-label={`${product.name} adetini artır`}
                                    disabled={!isOrderingOpen || isRecordingOrder}
                                    type="button"
                                    onClick={() => onIncreaseItem(product.id)}
                                  >
                                    +
                                  </button>
                                </div>
                              ) : (
                                <button
                                  aria-label={`${product.name} sepete ekle`}
                                  className="add-button public-order-add-button"
                                  disabled={!isOrderingOpen || isRecordingOrder}
                                  type="button"
                                  onClick={() => onAddItem(product)}
                                >
                                  <span aria-hidden="true">+</span>
                                  <span>Ekle</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>

          <aside className="public-order-desktop-cart" aria-label="Sipariş özeti">
            <div className="public-order-desktop-cart-card">
              <div className="public-order-desktop-cart-heading">
                <div>
                  <span>Sipariş özeti</span>
                  <strong>Sepetim</strong>
                </div>
                <b>{cartItemCount}</b>
              </div>
              {cart.length === 0 ? (
                <div className="public-order-desktop-cart-empty">
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <circle cx="9" cy="20" r="1" />
                    <circle cx="19" cy="20" r="1" />
                    <path d="M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H7" />
                  </svg>
                  <p>Sepetiniz boş.</p>
                  <span>Menüden ürün ekleyerek başlayın.</span>
                </div>
              ) : (
                <div className="public-order-desktop-cart-items">
                  {cart.map((item) => (
                    <div className="public-order-desktop-cart-item" key={item.id}>
                      {item.imageUrl ? (
                        <img alt="" src={item.imageUrl} />
                      ) : (
                        <span aria-hidden="true" className="public-order-desktop-cart-fallback">
                          {item.name.slice(0, 1).toLocaleUpperCase("tr-TR")}
                        </span>
                      )}
                      <div className="public-order-desktop-cart-copy">
                        <strong>{item.name}</strong>
                        <span>{formatPrice(item.price * item.quantity)}</span>
                      </div>
                      <div className="public-order-desktop-cart-quantity">
                        <button
                          aria-label={`${item.name} adedini azalt`}
                          disabled={!isOrderingOpen || isRecordingOrder}
                          type="button"
                          onClick={() => onDecreaseItem(item.id)}
                        >
                          −
                        </button>
                        <output aria-label={`${item.quantity} adet`}>{item.quantity}</output>
                        <button
                          aria-label={`${item.name} adedini artır`}
                          disabled={!isOrderingOpen || isRecordingOrder}
                          type="button"
                          onClick={() => onIncreaseItem(item.id)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="public-order-desktop-cart-total">
                <span>Toplam</span>
                <strong>{formatPrice(total)}</strong>
              </div>
              <button
                className="public-order-desktop-cart-button"
                disabled={cart.length === 0 || !isOrderingOpen || isRecordingOrder}
                ref={!isMobileViewport ? cartTriggerRef : undefined}
                type="button"
                onClick={onOpenCheckout}
              >
                Siparişi tamamla
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </aside>

          {shouldShowCartBar && isMobileViewport ? (
            <button
              aria-label={`Sepetim, ${cartItemCount} ürün, ${formatPrice(total)}`}
              aria-controls="public-order-cart-panel"
              aria-expanded={false}
              className="public-order-cart-bar"
              disabled={isRecordingOrder}
              ref={cartTriggerRef}
              type="button"
              onClick={onOpenCheckout}
            >
              <svg
                aria-hidden="true"
                className="public-order-cart-icon"
                viewBox="0 0 24 24"
              >
                <circle cx="9" cy="20" r="1" />
                <circle cx="19" cy="20" r="1" />
                <path d="M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H7" />
              </svg>
              <span className="public-order-cart-summary">
                <strong>Sepetim · {cartItemCount} ürün</strong>
              </span>
              <b>{formatPrice(total)}</b>
              <span aria-hidden="true" className="public-order-cart-arrow">
                ›
              </span>
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}
