import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = "https://davismerchants.co.ke/wp-json/wc/store/v1";

const decodeEntities = (value = "") => value
  .replace(/<[^>]*>/g, " ")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#039;|&apos;/gi, "'")
  .replace(/&ndash;/gi, "–")
  .replace(/&mdash;/gi, "—")
  .replace(/&times;/gi, "×")
  .replace(/\s+/g, " ")
  .trim();

async function getJson(url, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Bevalink catalog migration/1.0" },
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } catch (error) {
    if (attempt >= 3) throw error;
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    return getJson(url, attempt + 1);
  }
}

const [categories, ...pages] = await Promise.all([
  getJson(`${base}/products/categories?per_page=100`),
  getJson(`${base}/products?per_page=100&page=1`),
  getJson(`${base}/products?per_page=100&page=2`),
  getJson(`${base}/products?per_page=100&page=3`),
]);

const products = pages.flat().map((product) => ({
  id: product.id,
  name: decodeEntities(product.name),
  slug: product.slug,
  sku: decodeEntities(product.sku || ""),
  description: decodeEntities(product.description || product.short_description),
  shortDescription: decodeEntities(product.short_description),
  categories: product.categories.map((category) => decodeEntities(category.name)),
  image: product.images?.[0]?.src || "",
  gallery: (product.images || []).slice(0, 5).map((image) => image.src),
  price: Number(product.prices?.price || 0),
  regularPrice: Number(product.prices?.regular_price || product.prices?.price || 0),
  salePrice: Number(product.prices?.sale_price || 0),
  currency: product.prices?.currency_code || "KES",
  minorUnit: Number(product.prices?.currency_minor_unit ?? 2),
  onSale: Boolean(product.on_sale),
  inStock: Boolean(product.is_in_stock),
  rating: Number(product.average_rating || 0),
  reviewCount: Number(product.review_count || 0),
}));

const cleanedCategories = categories
  .filter((category) => category.count > 0 && category.slug !== "uncategorized")
  .map((category) => ({
    id: category.id,
    name: decodeEntities(category.name),
    slug: category.slug,
    count: category.count,
    image: category.image?.src || "",
  }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

const payload = {
  generatedAt: new Date().toISOString(),
  source: "Imported equipment catalogue",
  categories: cleanedCategories,
  products,
};

const target = join(process.cwd(), "dist", "catalog-data.js");
await writeFile(target, `window.BEVALINK_CATALOG = ${JSON.stringify(payload)};\n`, "utf8");
console.log(`Saved ${products.length} products and ${cleanedCategories.length} categories.`);
