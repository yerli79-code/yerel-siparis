import Link from "next/link";
import type { CSSProperties, RefObject } from "react";
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
  heroStyle?: CSSProperties;
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
  heroStyle,
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

  return (
    <>
      <header className="hero business-hero public-order-hero" style={heroStyle}>
        <div className="hero-content business-hero-content public-order-hero-content">
          <div className="business-topline public-order-topline">
            <Link className="eyebrow business-back-link" href="/">
              ← İşletmeler
            </Link>
          </div>

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
              <p>{business.description}</p>
            </div>
          </div>

          <div className="business-meta public-order-location">
            {addressText ? <span>{addressText}</span> : null}
            {business.address ? <span>{business.address}</span> : null}
          </div>
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
              <div>
                <span className="menu-kicker">Menü</span>
                <h2>Ürünler</h2>
              </div>
              <span>{categories.length} kategori</span>
            </div>
            {hasAnyProducts ? (
              <label className="public-order-search">
                <span className="public-order-search-label">Menüde ürün ara</span>
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
                        <div className="product-card-body public-order-product-body">
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
                          <div className="product-copy public-order-product-copy">
                            <p className="product-name">{product.name}</p>
                            {product.description ? (
                              <p className="product-description">
                                {product.description}
                              </p>
                            ) : null}
                            <span className="price">{formatPrice(product.price)}</span>
                          </div>
                        </div>
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
                              className="add-button public-order-add-button"
                              disabled={!isOrderingOpen || isRecordingOrder}
                              type="button"
                              onClick={() => onAddItem(product)}
                            >
                              {isOrderingOpen ? "+ Ekle" : "Kapalı"}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>

          {shouldShowCartBar ? (
            <button
              aria-controls="public-order-cart-panel"
              aria-expanded={false}
              className="public-order-cart-bar"
              disabled={isRecordingOrder}
              ref={cartTriggerRef}
              type="button"
              onClick={onOpenCheckout}
            >
              <span className="public-order-cart-summary">
                <strong>{cartItemCount} ürün</strong>
                <small>{formatPrice(total)}</small>
              </span>
              <b>Siparişi Tamamla</b>
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}
