import type { OrderStatus, OrderType } from "../../lib/supabase-orders";
import type { PaymentMethodMode } from "../../lib/payment-methods";

export const FIXTURE_USER_ID = "00000000-0000-4000-8000-000000000001";
export const FIXTURE_USER_EMAIL = "e2e-business@example.invalid";
export const FIXTURE_USER_PASSWORD = "SafeE2ELocalOnly2026!";

export const FIXTURE_ACCESS_TOKEN = "mock-e2e-jwt-access-token-000000000001";
export const FIXTURE_REFRESH_TOKEN = "mock-e2e-jwt-refresh-token-000000000001";

// Synthetic Admin fixtures
export const FIXTURE_ADMIN_USER_ID = "00000000-0000-4000-8000-000000000099";
export const FIXTURE_ADMIN_USER_EMAIL = "admin@example.invalid";
export const FIXTURE_ADMIN_USER_PASSWORD = "SafeAdminE2E2026!";
export const FIXTURE_ADMIN_ACCESS_TOKEN = "mock-e2e-jwt-admin-access-token-000000000099";
export const FIXTURE_ADMIN_REFRESH_TOKEN = "mock-e2e-jwt-admin-refresh-token-000000000099";

// Synthetic Inactive Admin fixtures (for testing 403 rejection)
export const FIXTURE_INACTIVE_ADMIN_USER_ID = "00000000-0000-4000-8000-000000000098";
export const FIXTURE_INACTIVE_ADMIN_EMAIL = "inactive-admin@example.invalid";
export const FIXTURE_INACTIVE_ADMIN_PASSWORD = "SafeInactiveAdmin2026!";
export const FIXTURE_INACTIVE_ADMIN_ACCESS_TOKEN = "mock-e2e-jwt-inactive-admin-token-000000000098";
export const FIXTURE_INACTIVE_ADMIN_REFRESH_TOKEN = "mock-e2e-jwt-inactive-admin-refresh-000000000098";

export const FIXTURE_BUSINESS_ID = "00000000-0000-4000-8000-000000000101";
export const FIXTURE_BUSINESS_SLUG = "e2e-test-kebap";

export const FIXTURE_BUSINESS_2_ID = "00000000-0000-4000-8000-000000000102";
export const FIXTURE_BUSINESS_2_SLUG = "pasif-pide-sarayi";

export const FIXTURE_BUSINESS_3_ID = "00000000-0000-4000-8000-000000000103";
export const FIXTURE_BUSINESS_3_SLUG = "suresi-dolmus-corbaci";

export const FIXTURE_BUSINESS_4_ID = "00000000-0000-4000-8000-000000000104";
export const FIXTURE_BUSINESS_4_SLUG = "engelli-donercilik";

export const FIXTURE_BUSINESS_5_ID = "00000000-0000-4000-8000-000000000105";
export const FIXTURE_BUSINESS_5_SLUG = "cok-ozel-geleneksel-uzun-isimli-isletme";

export type FixtureBusiness = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  whatsapp_order_number: string | null;
  city: string | null;
  district: string | null;
  neighborhood: string | null;
  address: string | null;
  delivery_status: string | null;
  logo_text: string | null;
  payment_method_mode: PaymentMethodMode | null;
  minimum_order_amount: number | null;
  preparation_time_minutes: number | null;
  is_open: boolean | null;
  order_note: string | null;
  service_radius_km: number | null;
  logo_url: string | null;
  cover_image_url: string | null;
  is_active: boolean | null;
  owner_id: string | null;
  subscription_status: string | null;
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FixtureAdminUser = {
  id: string;
  email: string;
  is_active: boolean;
  created_at: string;
};

export type FixtureProfile = {
  id: string;
  email: string;
};

export type FixtureAdminAuditSnapshot = {
  is_active: boolean;
  subscription_status: "active" | "expired" | "blocked";
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
  updated_at?: string;
};

export type FixtureAdminAuditLog = {
  id: string;
  business_id: string;
  actor_user_id: string;
  actor_email: string;
  action: string;
  before_state: FixtureAdminAuditSnapshot | Record<string, never>;
  after_state: FixtureAdminAuditSnapshot;
  created_at: string;
};

export type FixtureProduct = {
  id: string;
  business_id: string;
  client_product_id: string | null;
  name: string;
  price: number;
  description: string | null;
  category: string | null;
  image_label: string | null;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type FixtureOrder = {
  id: string;
  order_number: number;
  business_order_number: number | null;
  business_id: string;
  status: OrderStatus;
  order_type: OrderType;
  payment_method: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_note: string | null;
  total_amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
};

export type FixtureOrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  created_at: string;
};

export const STALE_PRODUCT_UPDATED_AT = "2026-09-21T08:00:00.000Z";
export const STALE_ORDER_UPDATED_AT = "2026-09-21T10:00:00.000Z";

export function createInitialFixtures() {
  const user = {
    id: FIXTURE_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: FIXTURE_USER_EMAIL,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  const business: FixtureBusiness = {
    id: FIXTURE_BUSINESS_ID,
    owner_id: FIXTURE_USER_ID,
    name: "E2E Test Kebap Salonu",
    slug: FIXTURE_BUSINESS_SLUG,
    description: "Otomasyon ve E2E test işletmesi",
    category: "Kebap",
    whatsapp_order_number: "905551112233",
    city: "İstanbul",
    district: "Kadıköy",
    neighborhood: "Caferağa",
    address: "Caferağa Mah. Moda Cad. No:42",
    delivery_status: "delivery_and_pickup",
    logo_text: "EK",
    payment_method_mode: "cash_or_card",
    minimum_order_amount: 150,
    preparation_time_minutes: 25,
    is_open: true,
    order_note: "Siparişleriniz özenle hazırlanıp sıcak teslim edilir.",
    service_radius_km: 5,
    logo_url: null,
    cover_image_url: null,
    is_active: true,
    subscription_status: "active",
    subscription_started_at: "2026-06-01T10:00:00.000Z",
    subscription_expires_at: "2030-01-01T00:00:00.000Z",
    created_at: "2026-06-01T10:00:00.000Z",
    updated_at: "2026-09-21T10:00:00.000Z",
  };

  const business2: FixtureBusiness = {
    id: FIXTURE_BUSINESS_2_ID,
    owner_id: "00000000-0000-4000-8000-000000000002",
    name: "Pasif Pide Sarayı",
    slug: FIXTURE_BUSINESS_2_SLUG,
    description: "Leziz Karadeniz pideleri",
    category: "Pide",
    whatsapp_order_number: "905552223344",
    city: "İstanbul",
    district: "Kadıköy",
    neighborhood: "Moda",
    address: "Moda Cad. No:12",
    delivery_status: "delivery_and_pickup",
    logo_text: "PP",
    payment_method_mode: "cash_or_card",
    minimum_order_amount: 100,
    preparation_time_minutes: 20,
    is_open: true,
    order_note: null,
    service_radius_km: 3,
    logo_url: null,
    cover_image_url: null,
    is_active: false,
    subscription_status: "active",
    subscription_started_at: "2026-06-01T10:00:00.000Z",
    subscription_expires_at: "2030-01-01T00:00:00.000Z",
    created_at: "2026-06-02T10:00:00.000Z",
    updated_at: "2026-09-21T10:00:00.000Z",
  };

  const business3: FixtureBusiness = {
    id: FIXTURE_BUSINESS_3_ID,
    owner_id: "00000000-0000-4000-8000-000000000003",
    name: "Süresi Dolmuş Çorbacı",
    slug: FIXTURE_BUSINESS_3_SLUG,
    description: "Gece çorbaları",
    category: "Çorba",
    whatsapp_order_number: "905553334455",
    city: "Ankara",
    district: "Çankaya",
    neighborhood: "Kızılay",
    address: "Karanfil Sok. No:5",
    delivery_status: "pickup_only",
    logo_text: "SÇ",
    payment_method_mode: "cash",
    minimum_order_amount: 80,
    preparation_time_minutes: 15,
    is_open: false,
    order_note: null,
    service_radius_km: 2,
    logo_url: null,
    cover_image_url: null,
    is_active: false,
    subscription_status: "expired",
    subscription_started_at: "2025-01-01T10:00:00.000Z",
    subscription_expires_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T10:00:00.000Z",
    updated_at: "2026-01-01T10:00:00.000Z",
  };

  const business4: FixtureBusiness = {
    id: FIXTURE_BUSINESS_4_ID,
    owner_id: "00000000-0000-4000-8000-000000000004",
    name: "Engelli Dönercilik",
    slug: FIXTURE_BUSINESS_4_SLUG,
    description: "Yaprak döner",
    category: "Döner",
    whatsapp_order_number: "905554445566",
    city: "İzmir",
    district: "Konak",
    neighborhood: "Alsancak",
    address: "Kıbrıs Şehitleri Cad. No:18",
    delivery_status: "delivery_only",
    logo_text: "ED",
    payment_method_mode: "card",
    minimum_order_amount: 120,
    preparation_time_minutes: 20,
    is_open: false,
    order_note: null,
    service_radius_km: 4,
    logo_url: null,
    cover_image_url: null,
    is_active: false,
    subscription_status: "blocked",
    subscription_started_at: "2026-01-01T10:00:00.000Z",
    subscription_expires_at: "2026-05-01T00:00:00.000Z",
    created_at: "2026-01-01T10:00:00.000Z",
    updated_at: "2026-05-01T10:00:00.000Z",
  };

  const business5: FixtureBusiness = {
    id: FIXTURE_BUSINESS_5_ID,
    owner_id: "00000000-0000-4000-8000-000000000005",
    name: "ÇokÖzelGelenekselUzunİsimliÖrnekİşletmeKebapPideVeLahmacunSalonu",
    slug: FIXTURE_BUSINESS_5_SLUG,
    description: "Uzun isim testi",
    category: "Kebap",
    whatsapp_order_number: "905555556677",
    city: "Bursa",
    district: "Nilüfer",
    neighborhood: "Görükle",
    address: "Atatürk Cad. No:99",
    delivery_status: "delivery_and_pickup",
    logo_text: "ÇÖ",
    payment_method_mode: "cash_or_card",
    minimum_order_amount: 150,
    preparation_time_minutes: 30,
    is_open: true,
    order_note: null,
    service_radius_km: 5,
    logo_url: null,
    cover_image_url: null,
    is_active: true,
    subscription_status: "active",
    subscription_started_at: "2026-06-01T10:00:00.000Z",
    subscription_expires_at: "2030-01-01T00:00:00.000Z",
    created_at: "2026-06-03T10:00:00.000Z",
    updated_at: "2026-09-21T10:00:00.000Z",
  };

  const businesses: FixtureBusiness[] = [business, business2, business3, business4, business5];

  const adminUser = {
    id: FIXTURE_ADMIN_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: FIXTURE_ADMIN_USER_EMAIL,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  const inactiveAdminUser = {
    id: FIXTURE_INACTIVE_ADMIN_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: FIXTURE_INACTIVE_ADMIN_EMAIL,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  const adminUsers: FixtureAdminUser[] = [
    {
      id: FIXTURE_ADMIN_USER_ID,
      email: FIXTURE_ADMIN_USER_EMAIL,
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: FIXTURE_INACTIVE_ADMIN_USER_ID,
      email: FIXTURE_INACTIVE_ADMIN_EMAIL,
      is_active: false,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  const profiles: FixtureProfile[] = [
    { id: FIXTURE_USER_ID, email: FIXTURE_USER_EMAIL },
    { id: "00000000-0000-4000-8000-000000000002", email: "pideci@example.invalid" },
    { id: "00000000-0000-4000-8000-000000000003", email: "corbaci@example.invalid" },
    { id: "00000000-0000-4000-8000-000000000004", email: "donerci@example.invalid" },
    { id: "00000000-0000-4000-8000-000000000005", email: "uzunisim@example.invalid" },
  ];

  const adminAuditLogs: FixtureAdminAuditLog[] = [
    {
      id: "00000000-0000-4000-8000-000000004001",
      business_id: FIXTURE_BUSINESS_ID,
      actor_user_id: FIXTURE_ADMIN_USER_ID,
      actor_email: FIXTURE_ADMIN_USER_EMAIL,
      action: "business.reactivated",
      before_state: {
        is_active: false,
        subscription_status: "active",
        subscription_started_at: "2026-06-01T10:00:00.000Z",
        subscription_expires_at: "2030-01-01T00:00:00.000Z",
        updated_at: "2026-09-20T13:59:00.000Z",
      },
      after_state: {
        is_active: true,
        subscription_status: "active",
        subscription_started_at: "2026-06-01T10:00:00.000Z",
        subscription_expires_at: "2030-01-01T00:00:00.000Z",
        updated_at: "2026-09-20T14:00:00.000Z",
      },
      created_at: "2026-09-20T14:00:00.000Z",
    },
  ];

  const products: FixtureProduct[] = [
    {
      id: "00000000-0000-4000-8000-000000001001",
      business_id: FIXTURE_BUSINESS_ID,
      client_product_id: "cpid-adana-01",
      name: "Adana Kebap Dürüm",
      price: 180,
      description: "Zırh kıyması, lavaş, közlenmiş biber ve domates",
      category: "Dürümler",
      image_label: "Adana Kebap Dürüm",
      image_url: null,
      is_active: true,
      sort_order: 0,
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-09-21T10:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000001002",
      business_id: FIXTURE_BUSINESS_ID,
      client_product_id: "cpid-urfa-02",
      name: "Urfa Kebap Porsiyon",
      price: 280,
      description: "Acısız zırh kıyması, tırnak pide, bulgur pilavı ile",
      category: "Porsiyonlar",
      image_label: "Urfa Kebap Porsiyon",
      image_url: null,
      is_active: true,
      sort_order: 1,
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-09-21T10:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000001003",
      business_id: FIXTURE_BUSINESS_ID,
      client_product_id: "cpid-spesiyal-03",
      // Long unbroken product name for Phase 4 F5 text wrapping verification
      name: "ÇokÖzelGelenekselKözdePişirilmişSpesiyalKarışıkKebapTabağıBolGarnitürlüVeİkramlı",
      price: 480,
      description: "Adana, kuzu şiş, tavuk kanat, içli köfte ve özel garnitürler",
      category: "Porsiyonlar",
      image_label: "Spesiyal Karışık Kebap",
      image_url: null,
      is_active: true,
      sort_order: 2,
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-09-21T10:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000001004",
      business_id: FIXTURE_BUSINESS_ID,
      client_product_id: "cpid-kola-04",
      name: "Kutu Kola 330ml",
      price: 45,
      description: "Soğuk meşrubat",
      category: "İçecekler",
      image_label: "Kutu Kola",
      image_url: null,
      is_active: true,
      sort_order: 3,
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-09-21T10:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000001005",
      business_id: FIXTURE_BUSINESS_ID,
      client_product_id: "cpid-salata-05",
      name: "Mevsim Salata",
      price: 70,
      description: "Göbek marul, havuç, mor lahana, nar ekşisi sosu",
      category: "Yan Ürünler",
      image_label: "Mevsim Salata",
      image_url: null,
      is_active: false, // Inactive product fixture
      sort_order: 4,
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-09-21T10:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000001006",
      business_id: FIXTURE_BUSINESS_ID,
      client_product_id: "cpid-kunefe-06",
      name: "Fıstıklı Künefe",
      price: 160,
      description: "Sıcak şerbetli Hatay künefesi",
      category: "Tatlılar",
      image_label: "Fıstıklı Künefe",
      image_url: null,
      is_active: true,
      sort_order: 5,
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-09-21T10:00:00.000Z",
    },
  ];

  const orders: FixtureOrder[] = [
    {
      id: "00000000-0000-4000-8000-000000002001",
      order_number: 101,
      business_order_number: 101,
      business_id: FIXTURE_BUSINESS_ID,
      status: "new",
      order_type: "pickup",
      payment_method: "cash",
      customer_name: "Ahmet Yılmaz",
      customer_phone: "05551234567",
      customer_address: null,
      customer_note: "Acısız olsun lütfen",
      total_amount: 225,
      currency: "TRY",
      created_at: "2026-09-21T12:30:00.000Z",
      updated_at: "2026-09-21T12:30:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000002002",
      order_number: 102,
      business_order_number: 102,
      business_id: FIXTURE_BUSINESS_ID,
      status: "preparing",
      order_type: "delivery",
      payment_method: "card",
      customer_name: "Mehmet Öz",
      customer_phone: "05559876543",
      customer_address: "Caferağa Mah. Şair Nefi Sok. No:5 D:2",
      customer_note: "Zil çalışmıyor lütfen telefon edin",
      total_amount: 480,
      currency: "TRY",
      created_at: "2026-09-21T12:15:00.000Z",
      updated_at: "2026-09-21T12:20:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000002003",
      order_number: 103,
      business_order_number: 103,
      business_id: FIXTURE_BUSINESS_ID,
      status: "ready",
      order_type: "delivery",
      payment_method: "cash",
      customer_name: "Ayşe Demir",
      customer_phone: "05553334455",
      customer_address: "Osmanağa Mah. Söğütlüçeşme Cad. No:12 D:4",
      customer_note: null,
      total_amount: 280,
      currency: "TRY",
      created_at: "2026-09-21T12:00:00.000Z",
      updated_at: "2026-09-21T12:10:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000002004",
      order_number: 104,
      business_order_number: 104,
      business_id: FIXTURE_BUSINESS_ID,
      status: "delivered",
      order_type: "pickup",
      payment_method: "card",
      customer_name: "Fatma Kaya",
      customer_phone: "05557778899",
      customer_address: null,
      customer_note: null,
      total_amount: 340,
      currency: "TRY",
      created_at: "2026-09-21T11:30:00.000Z",
      updated_at: "2026-09-21T11:50:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000002005",
      order_number: 105,
      business_order_number: 105,
      business_id: FIXTURE_BUSINESS_ID,
      status: "cancelled",
      order_type: "delivery",
      payment_method: "cash",
      customer_name: "Ali Can",
      customer_phone: "05552221100",
      customer_address: "Moda Bostanı Sok. No:3",
      customer_note: "Müşteri vazgeçti",
      total_amount: 350,
      currency: "TRY",
      created_at: "2026-09-21T11:00:00.000Z",
      updated_at: "2026-09-21T11:05:00.000Z",
    },
  ];

  const orderItems: FixtureOrderItem[] = [
    {
      id: "00000000-0000-4000-8000-000000003001",
      order_id: "00000000-0000-4000-8000-000000002001",
      product_id: "00000000-0000-4000-8000-000000001001",
      product_name: "Adana Kebap Dürüm",
      unit_price: 180,
      quantity: 1,
      line_total: 180,
      created_at: "2026-09-21T12:30:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000003002",
      order_id: "00000000-0000-4000-8000-000000002001",
      product_id: "00000000-0000-4000-8000-000000001004",
      product_name: "Kutu Kola 330ml",
      unit_price: 45,
      quantity: 1,
      line_total: 45,
      created_at: "2026-09-21T12:30:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000003003",
      order_id: "00000000-0000-4000-8000-000000002002",
      product_id: "00000000-0000-4000-8000-000000001003",
      product_name: "ÇokÖzelGelenekselKözdePişirilmişSpesiyalKarışıkKebapTabağıBolGarnitürlüVeİkramlı",
      unit_price: 480,
      quantity: 1,
      line_total: 480,
      created_at: "2026-09-21T12:15:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000003004",
      order_id: "00000000-0000-4000-8000-000000002003",
      product_id: "00000000-0000-4000-8000-000000001002",
      product_name: "Urfa Kebap Porsiyon",
      unit_price: 280,
      quantity: 1,
      line_total: 280,
      created_at: "2026-09-21T12:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000003005",
      order_id: "00000000-0000-4000-8000-000000002004",
      product_id: "00000000-0000-4000-8000-000000001001",
      product_name: "Adana Kebap Dürüm",
      unit_price: 180,
      quantity: 1,
      line_total: 180,
      created_at: "2026-09-21T11:30:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000003006",
      order_id: "00000000-0000-4000-8000-000000002004",
      product_id: "00000000-0000-4000-8000-000000001006",
      product_name: "Fıstıklı Künefe",
      unit_price: 160,
      quantity: 1,
      line_total: 160,
      created_at: "2026-09-21T11:30:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000003007",
      order_id: "00000000-0000-4000-8000-000000002005",
      product_id: "00000000-0000-4000-8000-000000001002",
      product_name: "Urfa Kebap Porsiyon",
      unit_price: 280,
      quantity: 1,
      line_total: 280,
      created_at: "2026-09-21T11:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000003008",
      order_id: "00000000-0000-4000-8000-000000002005",
      product_id: "00000000-0000-4000-8000-000000001005",
      product_name: "Mevsim Salata",
      unit_price: 70,
      quantity: 1,
      line_total: 70,
      created_at: "2026-09-21T11:00:00.000Z",
    },
  ];

  return {
    user,
    adminUser,
    inactiveAdminUser,
    business,
    businesses,
    products,
    orders,
    orderItems,
    profiles,
    adminUsers,
    adminAuditLogs,
  };
}
