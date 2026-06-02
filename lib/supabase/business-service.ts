import type { Business, Product, ProductCategory } from "../businesses";
import { createSlug } from "../business-storage";
import { getSupabaseClient } from "./client";

type BusinessRow = {
  id: string;
  owner_id: string | null;
  slug: string;
  name: string;
  description: string;
  whatsapp_order_number: string;
  category: string;
  city: string;
  district: string;
  neighborhood: string;
  address: string;
  delivery_status: string;
  logo_text: string;
  cover_image: string;
  is_active: boolean;
};

type ProductRow = {
  id: string;
  business_id: string;
  client_product_id: string;
  name: string;
  price: number | string;
  category: string;
  description: string;
  image_label: string;
  is_active: boolean;
  sort_order: number;
};

type RegisterBusinessInput = {
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  whatsappOrderNumber: string;
  password: string;
  slug: string;
};

function groupProducts(productRows: ProductRow[]) {
  const categories = new Map<string, ProductCategory>();

  productRows.forEach((row) => {
    const categoryName = row.category || "Genel";
    const categoryId = createSlug(categoryName);
    const product: Product = {
      id: row.client_product_id || row.id,
      name: row.name,
      price: Number(row.price),
      description: row.description,
      imageLabel: row.image_label,
      isActive: row.is_active,
    };

    const category = categories.get(categoryName);
    if (category) {
      category.products.push(product);
      return;
    }

    categories.set(categoryName, {
      id: categoryId,
      name: categoryName,
      products: [product],
    });
  });

  return Array.from(categories.values());
}

function mapBusiness(row: BusinessRow, productRows: ProductRow[] = []): Business {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    whatsappOrderNumber: row.whatsapp_order_number,
    category: row.category,
    city: row.city,
    district: row.district,
    neighborhood: row.neighborhood,
    address: row.address,
    deliveryStatus: row.delivery_status,
    logoText: row.logo_text,
    coverImage: row.cover_image,
    productCategories: groupProducts(productRows),
  };
}

function businessToRow(business: Business, ownerId?: string) {
  return {
    owner_id: ownerId,
    slug: business.slug,
    name: business.name,
    description: business.description,
    whatsapp_order_number: business.whatsappOrderNumber,
    category: business.category || "Genel",
    city: business.city || "",
    district: business.district || "",
    neighborhood: business.neighborhood || "",
    address: business.address || "",
    delivery_status: business.deliveryStatus || "Teslimat bilgisi eklenmedi",
    logo_text: business.logoText || business.name.slice(0, 2).toLocaleUpperCase("tr-TR"),
    cover_image: business.coverImage || "",
    is_active: true,
  };
}

function flattenProducts(businessId: string, business: Business) {
  let sortOrder = 0;

  return business.productCategories.flatMap((category) =>
    category.products.map((product) => {
      sortOrder += 1;
      return {
        business_id: businessId,
        client_product_id: product.id,
        name: product.name,
        price: product.price,
        category: category.name,
        description: product.description,
        image_label: product.imageLabel,
        is_active: product.isActive !== false,
        sort_order: sortOrder,
      };
    }),
  );
}

function getProductRow(businessId: string, product: Product, categoryName: string) {
  return {
    business_id: businessId,
    client_product_id: product.id,
    name: product.name,
    price: product.price,
    category: categoryName,
    description: product.description,
    image_label: product.imageLabel,
    is_active: product.isActive !== false,
  };
}

async function getAuthenticatedOwnerId() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(".env.local icinde Supabase URL veya anon key eksik.");
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;

  const ownerId = session?.user.id;
  if (!ownerId) {
    throw new Error("Supabase oturumu yok. Once /giris sayfasindan giris yapin.");
  }

  return { supabase, ownerId };
}

async function findOrCreateOwnedBusinessId(business: Business) {
  const { supabase, ownerId } = await getAuthenticatedOwnerId();
  const { data: existingBusiness, error: findError } = await supabase
    .from("businesses")
    .select("id")
    .eq("slug", business.slug)
    .maybeSingle();

  if (findError) throw findError;

  if (existingBusiness?.id) {
    const { error: updateError } = await supabase
      .from("businesses")
      .update(businessToRow(business, ownerId))
      .eq("id", existingBusiness.id);

    if (updateError) throw updateError;

    return {
      supabase,
      businessId: existingBusiness.id as string,
    };
  }

  const { data: insertedBusiness, error: insertError } = await supabase
    .from("businesses")
    .insert(businessToRow(business, ownerId))
    .select("id")
    .single();

  if (insertError) throw insertError;

  return {
    supabase,
    businessId: insertedBusiness.id as string,
  };
}

export async function fetchBusinessesFromSupabase() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data: businessRows, error: businessError } = await supabase
    .from("businesses")
    .select("*")
    .order("created_at", { ascending: false });

  if (businessError) throw businessError;
  if (!businessRows?.length) return [];

  const businessIds = businessRows.map((business) => business.id);
  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select("*")
    .in("business_id", businessIds)
    .order("sort_order", { ascending: true });

  if (productError) throw productError;

  return (businessRows as BusinessRow[]).map((business) =>
    mapBusiness(
      business,
      ((productRows ?? []) as ProductRow[]).filter(
        (product) => product.business_id === business.id,
      ),
    ),
  );
}

export async function fetchBusinessBySlugFromSupabase(slug: string) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data: businessRow, error: businessError } = await supabase
    .from("businesses")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (businessError) throw businessError;
  if (!businessRow) return null;

  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("business_id", businessRow.id)
    .order("sort_order", { ascending: true });

  if (productError) throw productError;

  return mapBusiness(businessRow as BusinessRow, (productRows ?? []) as ProductRow[]);
}

export async function registerBusinessWithSupabase(input: RegisterBusinessInput) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      data: {
        full_name: input.ownerName.trim(),
        phone: input.phone.trim(),
      },
    },
  });

  if (authError) throw authError;

  const userId = authData.user?.id;
  if (!userId) return null;

  const newBusiness: Business = {
    slug: input.slug,
    name: input.businessName.trim(),
    description: "Yeni kayit olan isletme.",
    whatsappOrderNumber: input.whatsappOrderNumber.trim(),
    ownerName: input.ownerName.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
    category: "Genel",
    city: "",
    district: "",
    neighborhood: "",
    address: "",
    deliveryStatus: "Teslimat bilgisi eklenmedi",
    logoText: input.businessName.trim().slice(0, 2).toLocaleUpperCase("tr-TR"),
    coverImage: "",
    productCategories: [],
  };

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: userId,
    email: input.email.trim(),
    full_name: input.ownerName.trim(),
    phone: input.phone.trim(),
    role: "business_owner",
  });

  if (profileError) throw profileError;

  const { error: businessError } = await supabase
    .from("businesses")
    .insert(businessToRow(newBusiness, userId));

  if (businessError) throw businessError;

  return newBusiness;
}

export async function loginBusinessWithSupabase(email: string, password: string) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(".env.local icinde Supabase URL veya anon key eksik.");
  }

  const { data: authData, error: authError } =
    await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

  if (authError) throw authError;

  const ownerId = authData.session?.user.id ?? authData.user?.id;
  if (!ownerId) {
    throw new Error("Giris basarili gorunuyor ama Supabase session olusmadi.");
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) throw sessionError;
  if (!session?.user.id) {
    throw new Error("Supabase session tarayicida saklanamadi.");
  }

  const { data: businessRow, error: businessError } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", ownerId)
    .limit(1)
    .maybeSingle();

  if (businessError) throw businessError;
  if (!businessRow) {
    throw new Error("Bu kullaniciya ait Supabase isletme kaydi bulunamadi.");
  }

  return fetchBusinessBySlugFromSupabase((businessRow as BusinessRow).slug);
}

export async function getCurrentBusinessFromSupabaseSession() {
  const { supabase, ownerId } = await getAuthenticatedOwnerId();
  const { data: businessRow, error: businessError } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", ownerId)
    .limit(1)
    .maybeSingle();

  if (businessError) throw businessError;
  if (!businessRow) return null;

  return fetchBusinessBySlugFromSupabase((businessRow as BusinessRow).slug);
}

export async function signOutFromSupabase() {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function syncBusinessWithProductsToSupabase(business: Business) {
  const { supabase, businessId } = await findOrCreateOwnedBusinessId(business);

  const { error: deleteError } = await supabase
    .from("products")
    .delete()
    .eq("business_id", businessId);

  if (deleteError) throw deleteError;

  const products = flattenProducts(businessId, business);
  if (!products.length) return true;

  const { error: insertProductsError } = await supabase
    .from("products")
    .insert(products);

  if (insertProductsError) throw insertProductsError;

  return true;
}

export async function saveBusinessDetailsToSupabase(business: Business) {
  await findOrCreateOwnedBusinessId(business);
  return fetchBusinessBySlugFromSupabase(business.slug);
}

export async function upsertProductInSupabase(
  business: Business,
  product: Product,
  categoryName: string,
) {
  const { supabase, businessId } = await findOrCreateOwnedBusinessId(business);
  const productRow = getProductRow(businessId, product, categoryName);

  const { data: existingProduct, error: findError } = await supabase
    .from("products")
    .select("id")
    .eq("business_id", businessId)
    .eq("client_product_id", product.id)
    .maybeSingle();

  if (findError) throw findError;

  if (existingProduct?.id) {
    const { error: updateError } = await supabase
      .from("products")
      .update(productRow)
      .eq("id", existingProduct.id);

    if (updateError) throw updateError;
  } else {
    const { error: insertError } = await supabase
      .from("products")
      .insert(productRow);

    if (insertError) throw insertError;
  }

  return fetchBusinessBySlugFromSupabase(business.slug);
}

export async function deleteProductFromSupabase(
  business: Business,
  productId: string,
) {
  const { supabase, businessId } = await findOrCreateOwnedBusinessId(business);
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("business_id", businessId)
    .eq("client_product_id", productId);

  if (error) throw error;

  return fetchBusinessBySlugFromSupabase(business.slug);
}
