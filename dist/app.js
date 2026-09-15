(() => {
  const site = window.BAVALINK_SITE || {};
  const PHONE = String(site.phoneDigits || "254724809656").replace(/\D/g, "");
  const catalog = window.BAVALINK_CATALOG || { products: [], categories: [] };
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
      if (typeof value === "string" && /^https?:\/\//i.test(value)) image.src = value;
    });

    const brand = site.brandName || "Bavalink";
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

  function imageMarkup(product, className = "") {
    if (!product.image) return `<div class="placeholder-image ${className}" aria-label="No product image">B</div>`;
    return `<img class="${className}" src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'placeholder-image',textContent:'B'}))" />`;
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
    els.categoryShowcase.innerHTML = selected.map((category) => `
      <article class="category-card" role="button" tabindex="0" data-category="${escapeHTML(category.name)}" aria-label="Shop ${escapeHTML(category.name)}">
        ${category.image ? `<img src="${escapeHTML(category.image)}" alt="${escapeHTML(category.name)}" loading="lazy" />` : `<div class="placeholder-image">B</div>`}
        <div><div><h3>${escapeHTML(category.name)}</h3><p>${category.count} products</p></div><b>↘</b></div>
      </article>
    `).join("");
  }

  function renderFilters() {
    const priority = ["All", "Drills", "Water Pumps", "Grinders", "Welding Machines", "Weighing Scales", "Electric Saws", "Hand Tools", "Tool Sets", "Solar Systems", "Spray Guns", "Finishing Sanders"];
    els.filterRow.innerHTML = priority.filter((name) => name === "All" || categories.some((category) => category.name === name)).map((name) => `
      <button class="filter-chip ${state.category === name ? "active" : ""}" type="button" data-category="${escapeHTML(name)}">${escapeHTML(name)}</button>
    `).join("");
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
            <button class="add-button" type="button" data-add-product="${product.id}">Add to basket</button>
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
  }

  function selectCategory(category) {
    state.category = category;
    state.limit = 16;
    renderFilters();
    renderProducts();
    document.querySelector("#catalogue").scrollIntoView({ behavior: "smooth" });
  }

  function openProduct(product) {
    if (!product) return;
    const hasDiscount = product.onSale && product.regularPrice > product.price;
    const description = product.description || product.shortDescription || "Contact the Bavalink team for specifications, stock confirmation and delivery information.";
    const message = encodeURIComponent(`Hello Bavalink, I am interested in ${product.name} (${money(product)}). Is it available?`);
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
            <button class="dialog-add" type="button" data-add-product="${product.id}">Add to basket</button>
            <a class="dialog-whatsapp" href="https://wa.me/${PHONE}?text=${message}" target="_blank" rel="noreferrer">Ask on WhatsApp ↗</a>
          </div>
        </div>
      </div>`;
    els.dialog.showModal();
    document.body.classList.add("no-scroll");
  }

  function closeProduct() {
    els.dialog.close();
    if (!els.cartDrawer.classList.contains("open")) document.body.classList.remove("no-scroll");
  }

  function readCart() {
    try { return JSON.parse(localStorage.getItem("bavalink-cart")) || {}; } catch { return {}; }
  }

  function saveCart() {
    localStorage.setItem("bavalink-cart", JSON.stringify(state.cart));
    renderCart();
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
      </article>`).join("") : `<div class="empty-cart"><strong>Your basket is empty</strong><p>Add a product and send the full order to Bavalink on WhatsApp.</p></div>`;
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
    const message = [`Hello Bavalink, I would like to order:`, "", ...lines, "", `Estimated total: KSh ${new Intl.NumberFormat("en-KE").format(total)}`, "", "Please confirm stock and delivery cost."].join("\n");
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
    const add = event.target.closest("[data-add-product]");
    const category = event.target.closest("[data-category]");
    const plus = event.target.closest("[data-cart-plus]");
    const minus = event.target.closest("[data-cart-minus]");
    const remove = event.target.closest("[data-cart-remove]");
    if (view) openProduct(productById.get(view.dataset.viewProduct));
    if (add) addToCart(add.dataset.addProduct);
    if (category) selectCategory(category.dataset.category);
    if (plus) updateCart(plus.dataset.cartPlus, 1);
    if (minus) updateCart(minus.dataset.cartMinus, -1);
    if (remove) { delete state.cart[String(remove.dataset.cartRemove)]; saveCart(); }
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
  applySiteConfiguration();

  if (!products.length) {
    els.grid.innerHTML = `<div class="no-results"><strong>Catalogue unavailable</strong><p>Call or WhatsApp +254 724 809656 and we’ll help you find the equipment you need.</p></div>`;
    els.resultCount.textContent = "Please contact Bavalink for the latest stock";
    els.loadMore.hidden = true;
  } else {
    renderCategoryShowcase();
    renderFilters();
    renderProducts();
  }
  renderCart();
})();
