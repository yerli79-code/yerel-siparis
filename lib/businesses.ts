export type Product = {
  id: string;
  name: string;
  price: number;
  description: string;
  imageLabel: string;
  isActive?: boolean;
};

export type ProductCategory = {
  id: string;
  name: string;
  products: Product[];
};

export type Business = {
  slug: string;
  name: string;
  description: string;
  whatsappOrderNumber: string;
  ownerName?: string;
  email?: string;
  phone?: string;
  password?: string;
  category: string;
  city: string;
  district: string;
  neighborhood: string;
  address: string;
  deliveryStatus: string;
  logoText: string;
  coverImage?: string;
  productCategories: ProductCategory[];
};

export const businesses: Business[] = [
  {
    slug: "demo-kebap",
    name: "Demo Kebap",
    description:
      "Izgara, d\u00fcr\u00fcm, pide ve i\u00e7ecek sipari\u015fleri i\u00e7in h\u0131zl\u0131 QR men\u00fc demosu.",
    whatsappOrderNumber: "905365857147",
    category: "Kebap & Restoran",
    city: "\u0130stanbul",
    district: "Kad\u0131k\u00f6y",
    neighborhood: "Cafera\u011fa",
    address: "Moda Caddesi No: 12/A",
    deliveryStatus: "Paket servis ve gel-al uygun",
    logoText: "DK",
    coverImage: "Kapak görseli placeholder",
    productCategories: [
      {
        id: "durumler",
        name: "D\u00fcr\u00fcmler",
        products: [
          {
            id: "adana-durum",
            name: "Adana D\u00fcr\u00fcm",
            price: 250,
            description:
              "Lava\u015f i\u00e7inde Adana kebap, ye\u015fillik, so\u011fan ve iste\u011fe g\u00f6re ac\u0131 sos.",
            imageLabel: "Adana",
          },
          {
            id: "tavuk-durum",
            name: "Tavuk D\u00fcr\u00fcm",
            price: 180,
            description:
              "Marine tavuk, patates, tur\u015fu ve hafif sar\u0131msakl\u0131 sos ile haz\u0131rlan\u0131r.",
            imageLabel: "Tavuk",
          },
          {
            id: "urfa-durum",
            name: "Urfa D\u00fcr\u00fcm",
            price: 240,
            description:
              "Ac\u0131s\u0131z Urfa kebap, közlenmi\u015f biber, domates ve taze lava\u015f.",
            imageLabel: "Urfa",
          },
        ],
      },
      {
        id: "lahmacun-pide",
        name: "Lahmacun & Pide",
        products: [
          {
            id: "lahmacun",
            name: "Lahmacun",
            price: 120,
            description:
              "\u0130nce hamur, k\u0131ymal\u0131 har\u00e7, maydanoz ve limonla servis edilir.",
            imageLabel: "Lahmacun",
          },
          {
            id: "kasarli-pide",
            name: "Ka\u015farl\u0131 Pide",
            price: 220,
            description:
              "Ta\u015f f\u0131r\u0131nda pi\u015fen bol ka\u015farl\u0131 klasik pide.",
            imageLabel: "Pide",
          },
          {
            id: "kusbasili-pide",
            name: "Ku\u015fba\u015f\u0131l\u0131 Pide",
            price: 280,
            description:
              "Ku\u015fba\u015f\u0131 et, biber, domates ve \u00f6zel baharat kar\u0131\u015f\u0131m\u0131.",
            imageLabel: "Etli",
          },
        ],
      },
      {
        id: "icecekler",
        name: "\u0130\u00e7ecekler",
        products: [
          {
            id: "ayran",
            name: "Ayran",
            price: 40,
            description: "So\u011fuk ayran.",
            imageLabel: "Ayran",
          },
          {
            id: "kola",
            name: "Kola",
            price: 60,
            description: "So\u011fuk kutu kola.",
            imageLabel: "Kola",
          },
          {
            id: "su",
            name: "Su",
            price: 20,
            description: "500 ml pet \u015fi\u015fe su.",
            imageLabel: "Su",
          },
        ],
      },
    ],
  },
  {
    slug: "ahmet-doner",
    name: "Ahmet D\u00f6ner",
    description:
      "Et d\u00f6ner, tavuk d\u00f6ner ve pratik men\u00fclerle mahalle d\u00f6nercisi demosu.",
    whatsappOrderNumber: "905555555551",
    category: "D\u00f6ner",
    city: "\u0130stanbul",
    district: "\u00dcsk\u00fcdar",
    neighborhood: "Mimar Sinan",
    address: "Hakimiyet Caddesi No: 8",
    deliveryStatus: "Yak\u0131n mahallelere teslimat var",
    logoText: "AD",
    coverImage: "Kapak görseli placeholder",
    productCategories: [
      {
        id: "donerler",
        name: "D\u00f6nerler",
        products: [
          {
            id: "et-doner-durum",
            name: "Et D\u00f6ner D\u00fcr\u00fcm",
            price: 230,
            description: "Et d\u00f6ner, lava\u015f, domates, patates ve tur\u015fu.",
            imageLabel: "Et",
          },
          {
            id: "tavuk-doner-durum",
            name: "Tavuk D\u00f6ner D\u00fcr\u00fcm",
            price: 160,
            description:
              "Tavuk d\u00f6ner, lava\u015f, patates, tur\u015fu ve \u00f6zel sos.",
            imageLabel: "Tavuk",
          },
          {
            id: "pilavustu-doner",
            name: "Pilav\u00fcst\u00fc D\u00f6ner",
            price: 260,
            description: "Tereya\u011fl\u0131 pilav \u00fczerine et d\u00f6ner.",
            imageLabel: "Pilav",
          },
        ],
      },
      {
        id: "menuler",
        name: "Men\u00fcler",
        products: [
          {
            id: "doner-menu",
            name: "D\u00f6ner Men\u00fc",
            price: 310,
            description:
              "Et d\u00f6ner d\u00fcr\u00fcm, patates ve kutu i\u00e7ecek.",
            imageLabel: "Men\u00fc",
          },
          {
            id: "tavuk-menu",
            name: "Tavuk D\u00f6ner Men\u00fc",
            price: 240,
            description:
              "Tavuk d\u00f6ner d\u00fcr\u00fcm, patates ve ayran.",
            imageLabel: "Men\u00fc",
          },
        ],
      },
      {
        id: "icecekler",
        name: "\u0130\u00e7ecekler",
        products: [
          {
            id: "ayran",
            name: "Ayran",
            price: 40,
            description: "So\u011fuk ayran.",
            imageLabel: "Ayran",
          },
          {
            id: "salgam",
            name: "\u015ealgam",
            price: 50,
            description: "Ac\u0131l\u0131 veya ac\u0131s\u0131z se\u00e7enek notta belirtilebilir.",
            imageLabel: "\u015ealgam",
          },
        ],
      },
    ],
  },
  {
    slug: "yildiz-tatli",
    name: "Y\u0131ld\u0131z Tatl\u0131",
    description:
      "G\u00fcnl\u00fck tatl\u0131, baklava ve s\u00fctl\u00fc tatl\u0131 sipari\u015fi i\u00e7in demo sayfa.",
    whatsappOrderNumber: "905555555552",
    category: "Tatl\u0131 & Pastane",
    city: "\u0130stanbul",
    district: "Maltepe",
    neighborhood: "\u0130dealtepe",
    address: "Ba\u011fdat Caddesi No: 144",
    deliveryStatus: "Gel-al ve kurye teslimat\u0131 uygun",
    logoText: "YT",
    coverImage: "Kapak görseli placeholder",
    productCategories: [
      {
        id: "serbetli",
        name: "\u015eerbetli Tatl\u0131lar",
        products: [
          {
            id: "baklava-500",
            name: "Baklava 500 gr",
            price: 360,
            description: "F\u0131st\u0131kl\u0131 klasik baklava, 500 gr paket.",
            imageLabel: "Baklava",
          },
          {
            id: "soguk-baklava",
            name: "So\u011fuk Baklava",
            price: 390,
            description: "S\u00fctl\u00fc ve kakaolu so\u011fuk baklava, 500 gr.",
            imageLabel: "So\u011fuk",
          },
        ],
      },
      {
        id: "sutlu",
        name: "S\u00fctl\u00fc Tatl\u0131lar",
        products: [
          {
            id: "sutlac",
            name: "F\u0131r\u0131n S\u00fctla\u00e7",
            price: 95,
            description: "G\u00fcnl\u00fck f\u0131r\u0131n s\u00fctla\u00e7.",
            imageLabel: "S\u00fctla\u00e7",
          },
          {
            id: "kazandibi",
            name: "Kazandibi",
            price: 105,
            description: "Karamelize y\u00fczeyli klasik kazandibi.",
            imageLabel: "Kazandibi",
          },
          {
            id: "profiterol",
            name: "Profiterol",
            price: 120,
            description: "\u00c7ikolata soslu porsiyon profiterol.",
            imageLabel: "Profiterol",
          },
        ],
      },
      {
        id: "icecekler",
        name: "\u0130\u00e7ecekler",
        products: [
          {
            id: "turk-kahvesi",
            name: "T\u00fcrk Kahvesi",
            price: 70,
            description: "Sade, orta veya \u015fekerli tercihi notta belirtilebilir.",
            imageLabel: "Kahve",
          },
          {
            id: "cay",
            name: "\u00c7ay",
            price: 25,
            description: "Taze demlenmi\u015f \u00e7ay.",
            imageLabel: "\u00c7ay",
          },
        ],
      },
    ],
  },
];

export function getBusinessBySlug(slug: string) {
  return businesses.find((business) => business.slug === slug);
}
