export type Product = {
  id: string;
  name: string;
  price: number;
  description: string;
  imageLabel: string;
  imageUrl?: string | null;
  isActive?: boolean;
};

export type ProductCategory = {
  id: string;
  name: string;
  products: Product[];
};

export type Business = {
  id?: string;
  slug: string;
  name: string;
  description: string;
  whatsappOrderNumber: string;
  email: string;
  createdAt: string;
  category: string;
  city?: string;
  district: string;
  neighborhood: string;
  address: string;
  deliveryStatus: string;
  minimumOrderAmount?: number | null;
  preparationTimeMinutes?: number | null;
  isOpen?: boolean;
  orderNote?: string | null;
  logoText: string;
  subscriptionStatus: "active" | "expired" | "blocked";
  subscriptionStartedAt?: string | null;
  subscriptionExpiresAt: string | null;
  isActive: boolean;
  productCategories: ProductCategory[];
};

const inThirtyDays = () =>
  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

export function getSeedBusinesses(): Business[] {
  return [
    {
      slug: "demo-kebap",
      name: "Demo Kebap",
      description: "QR ile hızlı sipariş demosu.",
      whatsappOrderNumber: "905555555555",
      email: "demo@kebap.test",
      createdAt: new Date().toISOString(),
      category: "Kebap",
      district: "Kadıköy",
      neighborhood: "Caferağa",
      address: "Moda Caddesi No: 12/A",
      deliveryStatus: "Paket servis uygun",
      minimumOrderAmount: null,
      preparationTimeMinutes: null,
      isOpen: true,
      orderNote: null,
      logoText: "DK",
      subscriptionStatus: "active",
      subscriptionStartedAt: new Date().toISOString(),
      subscriptionExpiresAt: inThirtyDays(),
      isActive: true,
      productCategories: [
        {
          id: "durumler",
          name: "Dürümler",
          products: [
            {
              id: "adana-durum",
              name: "Adana Dürüm",
              price: 250,
              description: "Adana kebap, lavaş ve yeşillik.",
              imageLabel: "Adana",
            },
            {
              id: "tavuk-durum",
              name: "Tavuk Dürüm",
              price: 180,
              description: "Marine tavuk, patates ve özel sos.",
              imageLabel: "Tavuk",
            },
          ],
        },
        {
          id: "icecekler",
          name: "İçecekler",
          products: [
            {
              id: "ayran",
              name: "Ayran",
              price: 40,
              description: "Soğuk ayran.",
              imageLabel: "Ayran",
            },
            {
              id: "kola",
              name: "Kola",
              price: 60,
              description: "Soğuk kutu kola.",
              imageLabel: "Kola",
            },
          ],
        },
      ],
    },
    {
      slug: "ahmet-doner",
      name: "Ahmet Döner",
      description: "Döner ve menü sipariş demosu.",
      whatsappOrderNumber: "905555555551",
      email: "ahmet@doner.test",
      createdAt: new Date().toISOString(),
      category: "Döner",
      district: "Üsküdar",
      neighborhood: "Mimar Sinan",
      address: "Hakimiyet Caddesi No: 8",
      deliveryStatus: "Yakın bölgelere teslimat",
      minimumOrderAmount: null,
      preparationTimeMinutes: null,
      isOpen: true,
      orderNote: null,
      logoText: "AD",
      subscriptionStatus: "active",
      subscriptionStartedAt: new Date().toISOString(),
      subscriptionExpiresAt: inThirtyDays(),
      isActive: true,
      productCategories: [
        {
          id: "donerler",
          name: "Dönerler",
          products: [
            {
              id: "et-doner",
              name: "Et Döner Dürüm",
              price: 230,
              description: "Et döner, lavaş ve turşu.",
              imageLabel: "Et",
            },
          ],
        },
      ],
    },
  ];
}
