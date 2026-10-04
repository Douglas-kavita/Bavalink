(() => {
  const site = window.BEVALINK_SITE || {};
  const PHONE = String(site.phoneDigits || "254724809656").replace(/\D/g, "");
  const catalog = window.BEVALINK_CATALOG || { products: [], categories: [] };
  const products = catalog.products || [];
  const categories = catalog.categories || [];
  const productById = new Map(products.map((product) => [String(product.id), product]));

  const state = {
    query: "",
    category: "All",
    sort: "featured",
    limit: 16,
    cart: readCart(),
  };

  const els = {
    categoryShowcase: document.querySelector("#category-showcase"),
    filterRow: document.querySelector("#filter-row"),
    grid: document.querySelector("#product-grid"),
    resultCount: document.querySelector("#results-count"),
    clearFilters: document.querySelector("#clear-filters"),
    loadMore: document.querySelector("#load-more"),
    catalogueSearch: document.querySelector("#catalogue-search-input"),
    heroSearch: document.querySelector("#hero-search-input"),
    heroForm: document.querySelector(".hero-search"),
    sort: document.querySelector("#sort-select"),
    productStat: document.querySelector("#product-stat"),
    dialog: document.querySelector("#product-dialog"),
    dialogContent: document.querySelector("#dialog-content"),
    cartDrawer: document.querySelector(".cart-drawer"),
    backdrop: document.querySelector(".drawer-backdrop"),
    cartItems: document.querySelector("#cart-items"),
    cartCount: document.querySelector(".cart-count"),
    drawerCount: document.querySelector("#drawer-count"),
    cartTotal: document.querySelector("#cart-total"),
    checkout: document.querySelector("#whatsapp-checkout"),
    toast: document.querySelector("#toast"),
    menuButton: document.querySelector(".menu-button"),
    mobileNav: document.querySelector(".mobile-nav"),
  };

  function applySiteConfiguration() {
    const root = document.documentElement;
    if (site.colors) {
      if (site.colors.ink) root.style.setProperty("--ink", site.colors.ink);
      if (site.colors.paper) root.style.setProperty("--paper", site.colors.paper);
      if (site.colors.lime) root.style.setProperty("--lime", site.colors.lime);
      if (site.colors.orange) root.style.setProperty("--orange", site.colors.orange);
    }

    document.querySelectorAll("[data-site]").forEach((element) => {
      const value = site[element.dataset.site];
      if (typeof value === "string") element.textContent = value;
    });

    document.querySelectorAll("[data-site-image]").forEach((image) => {
      const value = site[image.dataset.siteImage];
      if (typeof value === "string" && /^(https?:\/\/|\/)/i.test(value)) {
        image.src = imageSource(value);
        image.addEventListener("error", () => {
          if (image.dataset.proxyTried === "1") return;
          image.dataset.proxyTried = "1";
          image.src = "/api/image?url=" + encodeURIComponent(value);
        }, { once: true });
      }
    });

    const brand = site.brandName || "Bevalink";
    document.title = `${brand} | Tools, Machinery & Equipment in Kenya`;
    document.querySelectorAll(".brand-name").forEach((element) => {
      const split = Math.max(1, Math.ceil(brand.length / 2));
      element.innerHTML = `${escapeHTML(brand.slice(0, split).toUpperCase())}<span>${escapeHTML(brand.slice(split).toUpperCase())}</span>`;
    });

    const phoneDisplay = site.phoneDisplay || "+254 724 809656";
    document.querySelectorAll('a[href^="tel:"]').forEach((link) => link.href = `tel:+${PHONE}`);
    document.querySelectorAll('a[href*="wa.me/"]').forEach((link) => {
      const url = new URL(link.href);
      url.pathname = `/${PHONE}`;
      link.href = url.toString();
    });
    document.querySelectorAll('[data-site="phoneDisplay"]').forEach((element) => element.textContent = phoneDisplay);

    const email = site.email || "bevalink99@gmail.com";
    document.querySelectorAll("[data-email-link]").forEach((link) => link.href = "mailto:" + email);
    document.querySelectorAll("[data-social-link]").forEach((link) => {
      const raw = String(site[link.dataset.socialLink] || "").trim();
      let target = "";
      if (raw) {
        try {
          const candidate = /^https?:\/\//i.test(raw) ? raw : "https://" + raw.replace(/^\/+/, "");
          const parsed = new URL(candidate);
          if (["http:", "https:"].includes(parsed.protocol)) target = parsed.toString();
        } catch {}
      }
      if (target) {
        link.href = target;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.classList.add("active");
        link.removeAttribute("aria-disabled");
      } else {
        link.removeAttribute("href");
        link.removeAttribute("target");
        link.setAttribute("aria-disabled", "true");
        link.classList.remove("active");
      }
    });

    const visibility = site.visibility || {};
    const sections = { categories: "#categories", catalogue: "#catalogue", why: "#why-us", contact: "#contact" };
    Object.entries(sections).forEach(([key, selector]) => {
      const section = document.querySelector(selector);
      if (section && visibility[key] === false) section.hidden = true;
    });
  }

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]);
  }

  function money(product, value = product.price) {
    const amount = value / (10 ** (product.minorUnit ?? 2));
    return `KSh ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(amount)}`;
  }

  function imageSource(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    try {
      const parsed = new URL(value, window.location.origin);
      if (parsed.origin === window.location.origin || !["http:", "https:"].includes(parsed.protocol)) return parsed.toString();
      if (["davismerchants.co.ke", "www.davismerchants.co.ke"].includes(parsed.hostname.toLowerCase())) {
        return "/api/image?url=" + encodeURIComponent(parsed.toString());
      }
      return parsed.toString();
    } catch {
      return value;
    }
  }

  function productSlug(product) {
    return String(product?.name || "product")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-");
  }

  function productUrl(product) {
    return "/product/" + productSlug(product);
  }

  function imageMarkup(product, className = "") {
    if (!product.image) return `<div class="placeholder-image ${className}" aria-label="No product image">B</div>`;
    const originalUrl = String(product.image).trim();
    return `<img class="${className}" src="${escapeHTML(imageSource(originalUrl))}" data-original-url="${escapeHTML(originalUrl)}" alt="${escapeHTML(product.name)}" loading="eager" />`;
  }
  function getFilteredProducts() {
    const query = state.query.trim().toLowerCase();
    let result = products.filter((product) => {
      const matchesCategory = state.category === "All" || product.categories.includes(state.category);
      const haystack = `${product.name} ${product.description} ${product.categories.join(" ")} ${product.sku}`.toLowerCase();
      return matchesCategory && (!query || haystack.includes(query));
    });

    if (state.sort === "price-low") result.sort((a, b) => a.price - b.price);
    if (state.sort === "price-high") result.sort((a, b) => b.price - a.price);
    if (state.sort === "name") result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  function renderCategoryShowcase() {
    const priority = ["Drills", "Water Pumps", "Grinders", "Welding Machines", "Weighing Scales", "Electric Saws", "Tool Sets", "Solar Systems"];
    const selected = priority.map((name) => categories.find((item) => item.name === name)).filter(Boolean);
    els.categoryShowcase.innerHTML = selected.map((category) => {
      const fallbackProduct = products.find((product) =>
        Array.isArray(product.categories) &&
        product.categories.includes(category.name) &&
        product.image
      );
      const image = category.image || fallbackProduct?.image || "";
      return `
        <article class="category-card" role="button" tabindex="0" data-category="${escapeHTML(category.name)}" aria-label="Shop ${escapeHTML(category.name)}">
          ${image ? `<img src="${escapeHTML(imageSource(image))}" alt="${escapeHTML(category.name)}" loading="eager" />` : `<div class="placeholder-image">B</div>`}
          <div><div><h3>${escapeHTML(category.name)}</h3><p>${category.count} products</p></div><b>↘</b></div>
        </article>
      `;
    }).join("");

    els.categoryShowcase.querySelectorAll("img").forEach((img) => {
      img.dataset.originalUrl = img.src;
      img.addEventListener("error", () => {
        if (img.dataset.fallbackTried === "1") {
          img.style.display = "none";
          return;
        }
        img.dataset.fallbackTried = "1";
        const categoryName = img.alt;
        const category = categories.find((item) => item.name === categoryName);
        const fallbackProduct = products.find((product) =>
          Array.isArray(product.categories) &&
          product.categories.includes(categoryName) &&
          product.image
        );
        img.src = fallbackProduct?.image || (category?.image || "");
      });
    });;
  }

  function renderFilters() {
    const priority = ["All", "Drills", "Water Pumps", "Grinders", "Welding Machines", "Weighing Scales", "Electric Saws", "Hand Tools", "Tool Sets", "Solar Systems", "Spray Guns", "Car washer", "Finishing Sanders"];
    const visible = priority.filter((name) => name === "All" || categories.some((category) => category.name === name));
    const electricSawChildren = ["Circular Saw", "Jig Saw", "mitre saw", "Power Saw"].filter((name) => categories.some((category) => category.name === name));
    const remaining = categories.map((category) => category.name).filter((name) => !visible.includes(name)).sort((a,b) => a.localeCompare(b));
    els.filterRow.innerHTML = visible.map((name) => `
      <button class="filter-chip ${state.category === name ? "active" : ""}" type="button" data-category="${escapeHTML(name)}">${escapeHTML(name)}</button>
    `).join("") +
    (electricSawChildren.length ? `
      <label class="category-dropdown">
        <span>Electric Saws ▾</span>
        <select data-electric-saw-select aria-label="Electric saw type">
          <option value="Electric Saws">${state.category === "Electric Saws" ? "All Electric Saws" : "Electric Saws"}</option>
          ${electricSawChildren.map((name) => `<option value="${escapeHTML(name)}" ${state.category === name ? "selected" : ""}>${escapeHTML(name)}</option>`).join("")}
        </select>
      </label>` : "") +
    (remaining.length ? `
      <label class="category-dropdown">
        <span>More Categories ▾</span>
        <select data-more-category-select aria-label="More product categories">
          <option value="">More Categories</option>
          ${remaining.map((name) => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("")}
        </select>
      </label>` : "");
  }

  function productCard(product) {
    const hasDiscount = product.onSale && product.regularPrice > product.price;
    const discount = hasDiscount ? Math.round((1 - product.price / product.regularPrice) * 100) : 0;
    return `
      <article class="product-card" data-id="${product.id}">
        <div class="product-image-wrap" data-view-product="${product.id}" role="button" tabindex="0" aria-label="View ${escapeHTML(product.name)}">
          ${hasDiscount ? `<span class="sale-badge">Save ${discount}%</span>` : ""}
          ${product.inStock ? `<span class="stock-badge">In stock</span>` : ""}
          ${imageMarkup(product)}
        </div>
        <div class="product-info">
          <p class="product-category">${escapeHTML(product.categories[0] || "Equipment")}</p>
          <h3 class="product-name" data-view-product="${product.id}">${escapeHTML(product.name)}</h3>
          <div class="product-price"><strong>${money(product)}</strong>${hasDiscount ? `<del>${money(product, product.regularPrice)}</del>` : ""}</div>
          <div class="product-actions">
            <button class="add-button" type="button" data-add-product="${product.id}">Add to Cart</button><button class="whatsapp-button" type="button" data-whatsapp-product="${product.id}">Order via WhatsApp</button>
            <button class="view-button" type="button" data-view-product="${product.id}" aria-label="View product details">↗</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderProducts() {
    const filtered = getFilteredProducts();
    const visible = filtered.slice(0, state.limit);
    els.productStat.textContent = `${products.length}+`;
    els.resultCount.textContent = filtered.length === products.length
      ? `${filtered.length} products in the full catalogue`
      : `${filtered.length} product${filtered.length === 1 ? "" : "s"} found`;
    els.clearFilters.hidden = !state.query && state.category === "All";
    els.loadMore.hidden = state.limit >= filtered.length;
    els.grid.innerHTML = visible.length
      ? visible.map(productCard).join("")
      : `<div class="no-results"><strong>No matching tools found</strong><p>Try another product name or clear the filters.</p></div>`;
    els.grid.querySelectorAll("img[data-original-url]").forEach((img) => {
      img.addEventListener("error", () => {
        if (img.dataset.fallbackTried === "1") { img.style.display = "none"; return; }
        img.dataset.fallbackTried = "1";
        img.src = img.dataset.originalUrl;
      }, { once: false });
    });
  }

  function selectCategory(category) {
    state.category = category;
    state.limit = 16;
    renderFilters();
    renderProducts();
    document.querySelector("#catalogue").scrollIntoView({ behavior: "smooth" });
  }

  function openProduct(product, updateUrl = true) {
    if (!product) return;
    if (updateUrl) history.pushState({ productId: String(product.id) }, "", productUrl(product));
    const hasDiscount = product.onSale && product.regularPrice > product.price;
    const description = product.description || product.shortDescription || "Contact the Bevalink team for specifications, stock confirmation and delivery information.";
    const message = encodeURIComponent(`Hello Bevalink, I am interested in ${product.name} (${money(product)}). Is it available?`);
    els.dialogContent.innerHTML = `
      <div class="dialog-grid">
        <div class="dialog-image">${imageMarkup(product)}</div>
        <div class="dialog-body">
          <p class="product-category">${escapeHTML(product.categories.join(" · ") || "Equipment")}</p>
          <h2>${escapeHTML(product.name)}</h2>
          <div class="dialog-price"><strong>${money(product)}</strong>${hasDiscount ? `<del>${money(product, product.regularPrice)}</del>` : ""}</div>
          <p class="dialog-description">${escapeHTML(description)}</p>
          <div class="dialog-meta"><span>${product.inStock ? "Available to order" : "Confirm stock"}</span>${product.sku ? `<span>SKU: ${escapeHTML(product.sku)}</span>` : ""}<span>Countrywide delivery</span></div>
          <div class="dialog-actions">
            <button class="dialog-add" type="button" data-add-product="${product.id}">Add to Cart</button><a class="dialog-whatsapp" href="https://wa.me/${PHONE}?text=${message}" target="_blank" rel="noreferrer">Order via WhatsApp ↗</a>
          </div>
        </div>
      </div>`;
    els.dialog.showModal();
    document.body.classList.add("no-scroll");
  }

  function closeProduct(updateUrl = true) {
    els.dialog.close();
    if (updateUrl && location.pathname.startsWith("/product/")) history.pushState({}, "", "/");
    if (!els.cartDrawer.classList.contains("open")) document.body.classList.remove("no-scroll");
  }

  function readCart() {
    try { return JSON.parse(localStorage.getItem("bevalink-cart")) || {}; } catch { return {}; }
  }

  function saveCart() {
    localStorage.setItem("bevalink-cart", JSON.stringify(state.cart));
    renderCart();
  }

  function askOnWhatsApp(id) {
    const product = productById.get(String(id));
    if (!product) return;
    const message = encodeURIComponent(`Hello Bevalink, I am interested in ${product.name} (${money(product)}). Is it available?`);
    window.open(`https://wa.me/${PHONE}?text=${message}`, "_blank", "noopener,noreferrer");
  }

  function addToCart(id) {
    const key = String(id);
    state.cart[key] = (state.cart[key] || 0) + 1;
    saveCart();
    const product = productById.get(key);
    showToast(`${product?.name || "Product"} added to basket`);
  }

  function updateCart(id, amount) {
    const key = String(id);
    state.cart[key] = Math.max(0, (state.cart[key] || 0) + amount);
    if (!state.cart[key]) delete state.cart[key];
    saveCart();
  }

  function renderCart() {
    const rows = Object.entries(state.cart).map(([id, qty]) => ({ product: productById.get(id), qty })).filter((row) => row.product);
    const units = rows.reduce((sum, row) => sum + row.qty, 0);
    const total = rows.reduce((sum, row) => sum + (row.product.price / (10 ** row.product.minorUnit)) * row.qty, 0);
    els.cartCount.textContent = units;
    els.drawerCount.textContent = `${units} item${units === 1 ? "" : "s"}`;
    els.cartTotal.textContent = `KSh ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(total)}`;
    els.checkout.disabled = rows.length === 0;
    els.cartItems.innerHTML = rows.length ? rows.map(({ product, qty }) => `
      <article class="cart-item">
        ${product.image ? `<img src="${escapeHTML(product.image)}" alt="" />` : `<div class="cart-thumb-placeholder"></div>`}
        <div><h4>${escapeHTML(product.name)}</h4><p class="cart-item-price">${money(product)}</p><div class="qty-control"><button type="button" data-cart-minus="${product.id}" aria-label="Reduce quantity">−</button><span>${qty}</span><button type="button" data-cart-plus="${product.id}" aria-label="Increase quantity">+</button></div></div>
        <button class="remove-item" type="button" data-cart-remove="${product.id}" aria-label="Remove ${escapeHTML(product.name)}">×</button>
      </article>`).join("") : `<div class="empty-cart"><strong>Your basket is empty</strong><p>Add a product and send the full order to Bevalink on WhatsApp.</p></div>`;
  }

  function openCart() {
    els.backdrop.hidden = false;
    requestAnimationFrame(() => els.cartDrawer.classList.add("open"));
    els.cartDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
  }

  function closeCart() {
    els.cartDrawer.classList.remove("open");
    els.cartDrawer.setAttribute("aria-hidden", "true");
    setTimeout(() => { els.backdrop.hidden = true; }, 270);
    if (!els.dialog.open) document.body.classList.remove("no-scroll");
  }

  function checkoutWhatsApp() {
    const rows = Object.entries(state.cart).map(([id, qty]) => ({ product: productById.get(id), qty })).filter((row) => row.product);
    if (!rows.length) return;
    const total = rows.reduce((sum, row) => sum + (row.product.price / (10 ** row.product.minorUnit)) * row.qty, 0);
    const lines = rows.map(({ product, qty }, index) => `${index + 1}. ${product.name} × ${qty} — ${money(product, product.price * qty)}`);
    const message = [`Hello Bevalink, I would like to order:`, "", ...lines, "", `Estimated total: KSh ${new Intl.NumberFormat("en-KE").format(total)}`, "", "Please confirm stock and delivery cost."].join("\n");
    if (typeof window.gtag === "function") {
      window.gtag("event", "conversion", {
        send_to: "AW-18492819458/QpNiCLnI5Y8dEIKQiPJE",
        value: total,
        currency: "KES",
        transaction_id: `whatsapp-${Date.now()}`
      });
    }
    window.open(`https://wa.me/${PHONE}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  let toastTimer;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  document.addEventListener("click", (event) => {
    const view = event.target.closest("[data-view-product]");
    const whatsappProduct = event.target.closest("[data-whatsapp-product]");
    const category = event.target.closest("[data-category]");
    const plus = event.target.closest("[data-cart-plus]");
    const minus = event.target.closest("[data-cart-minus]");
    const remove = event.target.closest("[data-cart-remove]");
    const sawSelect = event.target.closest("[data-electric-saw-select]");
    const moreSelect = event.target.closest("[data-more-category-select]");
    if (view) openProduct(productById.get(view.dataset.viewProduct));
    if (whatsappProduct) askOnWhatsApp(whatsappProduct.dataset.whatsappProduct);
    if (category) selectCategory(category.dataset.category);
    if (plus) updateCart(plus.dataset.cartPlus, 1);
    if (minus) updateCart(minus.dataset.cartMinus, -1);
    if (remove) { delete state.cart[String(remove.dataset.cartRemove)]; saveCart(); }
    if (sawSelect && sawSelect.value) selectCategory(sawSelect.value);
    if (moreSelect && moreSelect.value) selectCategory(moreSelect.value);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-view-product], .category-card")) event.target.click();
    if (event.key === "Escape" && els.cartDrawer.classList.contains("open")) closeCart();
  });

  els.catalogueSearch.addEventListener("input", (event) => { state.query = event.target.value; state.limit = 16; renderProducts(); });
  els.heroForm.addEventListener("submit", (event) => { event.preventDefault(); state.query = els.heroSearch.value; els.catalogueSearch.value = state.query; state.limit = 16; renderProducts(); document.querySelector("#catalogue").scrollIntoView({ behavior: "smooth" }); });
  els.sort.addEventListener("change", (event) => { state.sort = event.target.value; renderProducts(); });
  els.loadMore.addEventListener("click", () => { state.limit += 16; renderProducts(); });
  els.clearFilters.addEventListener("click", () => { state.query = ""; state.category = "All"; state.limit = 16; els.catalogueSearch.value = ""; renderFilters(); renderProducts(); });
  document.querySelector(".cart-button").addEventListener("click", openCart);
  document.querySelector(".drawer-close").addEventListener("click", closeCart);
  els.backdrop.addEventListener("click", closeCart);
  els.checkout.addEventListener("click", checkoutWhatsApp);
  document.querySelector(".dialog-close").addEventListener("click", closeProduct);
  els.dialog.addEventListener("click", (event) => { if (event.target === els.dialog) closeProduct(); });
  document.querySelector(".search-jump").addEventListener("click", () => { document.querySelector("#catalogue").scrollIntoView({ behavior: "smooth" }); setTimeout(() => els.catalogueSearch.focus(), 500); });
  els.menuButton.addEventListener("click", () => { const open = els.menuButton.getAttribute("aria-expanded") === "true"; els.menuButton.setAttribute("aria-expanded", String(!open)); els.mobileNav.classList.toggle("open", !open); });
  els.mobileNav.addEventListener("click", () => { els.menuButton.setAttribute("aria-expanded", "false"); els.mobileNav.classList.remove("open"); });
  document.querySelectorAll("[data-footer-filter]").forEach((link) => link.addEventListener("click", () => selectCategory(link.dataset.footerFilter)));
  document.querySelector("#year").textContent = new Date().getFullYear();
  window.addEventListener("popstate", syncProductRoute);
  function syncProductRoute() {
    const match = location.pathname.match(/^\/product\/([^/]+)\/?$/i);
    if (!match) {
      if (els.dialog.open) closeProduct(false);
      return;
    }
    const slug = match[1].toLowerCase();
    const product = products.find((item) => productSlug(item) === slug);
    if (product) openProduct(product, false);
  }

  applySiteConfiguration();

  if (!products.length) {
    els.grid.innerHTML = `<div class="no-results"><strong>Catalogue unavailable</strong><p>Call or WhatsApp +254 724 809656 and we’ll help you find the equipment you need.</p></div>`;
    els.resultCount.textContent = "Please contact Bevalink for the latest stock";
    els.loadMore.hidden = true;
  } else {
    renderCategoryShowcase();
    renderFilters();
    renderProducts();
  }
  renderCart();
  syncProductRoute();
})();
