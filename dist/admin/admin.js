(() => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  let site = clone(window.BEVALINK_SITE || {});
  let catalog = clone(window.BEVALINK_CATALOG || { categories: [], products: [] });
  let activeProductId = null;
  let dirty = false;
  const recoveryParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const recoveryToken = recoveryParams.get("access_token");

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const els = {
    loading: $("#loading-screen"), login: $("#login-screen"), reset: $("#reset-screen"), setup: $("#setup-screen"), app: $("#admin-app"),
    loginForm: $("#login-form"), loginError: $("#login-error"), loginNotice: $("#login-notice"), forgotPassword: $("#forgot-password-button"), adminEmail: $("#admin-email"),
    resetForm: $("#reset-form"), resetError: $("#reset-error"), save: $("#save-button"), saveState: $("#save-state"),
    viewTitle: $("#view-title"), viewKicker: $("#view-kicker"), productRows: $("#product-rows"), categoryRows: $("#category-rows"),
    productSearch: $("#product-search"), categoryFilter: $("#product-category-filter"), dialog: $("#product-dialog"),
    productForm: $("#product-form"), dialogTitle: $("#product-dialog-title"), deleteProduct: $("#delete-product-button"),
    toast: $("#admin-toast"), sidebar: $(".sidebar")
  };

  async function request(action, body = {}) {
    const response = await fetch("/api/admin", {
      method: action === "status" ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: action === "status" ? undefined : JSON.stringify({ action, ...body })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || "The request could not be completed."), { status: response.status, data });
    return data;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image could not be opened.")); };
      image.src = url;
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("This image could not be prepared.")), "image/webp", quality));
  }

  async function prepareImage(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
    if (file.size > 20_000_000) throw new Error("Choose an image smaller than 20 MB.");
    const image = await loadImage(file);
    const maximum = 1600;
    const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob = await canvasToBlob(canvas, 0.82);
    if (blob.size > 1_900_000) blob = await canvasToBlob(canvas, 0.64);
    if (blob.size > 2_500_000) throw new Error("The image is still too large. Choose a smaller photo.");
    const baseName = file.name.replace(/\.[^.]+$/, "") || "bevalink-image";
    return { blob, fileName: baseName + ".webp", mimeType: "image/webp" };
  }

  function readAsBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("The image could not be read."));
      reader.readAsDataURL(blob);
    });
  }

  async function uploadImage(file) {
    const prepared = await prepareImage(file);
    const data = await readAsBase64(prepared.blob);
    return request("upload", { fileName: prepared.fileName, mimeType: prepared.mimeType, data });
  }

  function enhanceImageInputs(root = document) {
    const selector = [
      'input[data-setting="heroMainImage"]',
      'input[data-setting="heroTopImage"]',
      'input[data-setting="heroBottomImage"]',
      'input[data-setting="whyImage"]',
      'input[name="image"]',
      'input[data-category-field="image"]'
    ].join(",");

    [...root.querySelectorAll(selector)].forEach((input) => {
      if (input.dataset.uploadReady) return;
      input.dataset.uploadReady = "true";
      const field = document.createElement("div");
      field.className = "image-upload-field";
      input.parentNode.insertBefore(field, input);
      field.appendChild(input);
      const toolRow = document.createElement("div");
      toolRow.className = "image-upload-tools";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "device-upload-button";
      button.textContent = "Upload from phone / PC";
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = "image/jpeg,image/png,image/webp";
      picker.className = "device-file-input";
      const status = document.createElement("span");
      status.className = "image-upload-status";
      status.textContent = "or paste an image link above";
      toolRow.append(button, picker, status);
      const preview = document.createElement("img");
      preview.className = "image-upload-preview";
      preview.alt = "Selected image preview";
      const updatePreview = () => {
        const value = input.value.trim();
        preview.hidden = !value;
        if (value) preview.src = value;
      };
      input.addEventListener("input", updatePreview);
      preview.addEventListener("error", () => preview.hidden = true);
      field.append(toolRow, preview);
      updatePreview();

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        picker.click();
      });
      picker.addEventListener("click", (event) => event.stopPropagation());
      picker.addEventListener("change", async () => {
        const file = picker.files?.[0];
        if (!file) return;
        button.disabled = true;
        button.textContent = "Uploading…";
        status.textContent = "Preparing photo…";
        try {
          const result = await uploadImage(file);
          input.value = result.url;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          status.textContent = "Uploaded — publish changes";
          toast("Photo uploaded. Click Publish changes when ready.");
        } catch (error) {
          status.textContent = error.message;
          toast(error.message);
        } finally {
          button.disabled = false;
          button.textContent = "Upload from phone / PC";
          picker.value = "";
        }
      });
    });
  }

  function showOnly(element) {
    [els.loading, els.login, els.reset, els.setup, els.app].forEach((item) => item.hidden = item !== element);
  }

  async function start() {
    if (new URLSearchParams(location.search).get("reset") === "1" && recoveryToken) {
      return showOnly(els.reset);
    }
    try {
      const status = await request("status");
      els.adminEmail.textContent = status.adminEmail || "bevalink99@gmail.com";
      els.forgotPassword.hidden = !status.emailAuthEnabled;
      if (status.setupRequired) return showOnly(els.setup);
      if (!status.authenticated) return showOnly(els.login);
      openDashboard();
    } catch (error) {
      if (error.status === 503) showOnly(els.setup);
      else { showOnly(els.login); els.loginError.textContent = "The admin service is unavailable. Check the deployment and try again."; }
    }
  }

  function openDashboard() {
    showOnly(els.app);
    fillSiteFields();
    renderEverything();
    enhanceImageInputs();
  }

  function markDirty() {
    dirty = true;
    els.saveState.textContent = "Unpublished changes";
    els.saveState.classList.add("dirty");
  }

  function markSaved() {
    dirty = false;
    els.saveState.textContent = "All changes saved";
    els.saveState.classList.remove("dirty");
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => els.toast.classList.remove("show"), 2600);
  }

  function switchView(name) {
    const titles = { overview: ["Store control centre", "Overview"], site: ["Public website", "Website content"], products: ["Catalogue manager", "Products"], categories: ["Store navigation", "Categories"], appearance: ["Brand presentation", "Appearance"] };
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    $$("[data-view-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === name));
    els.viewKicker.textContent = titles[name][0];
    els.viewTitle.textContent = titles[name][1];
    els.sidebar.classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function fillSiteFields() {
    $$('[data-setting]').forEach((input) => input.value = site[input.dataset.setting] || "");
    $$('[data-color]').forEach((input) => input.value = site.colors?.[input.dataset.color] || "#000000");
    $$('[data-visibility]').forEach((input) => input.checked = site.visibility?.[input.dataset.visibility] !== false);
  }

  function money(product, value = product.price) {
    return `KSh ${new Intl.NumberFormat("en-KE").format(Number(value || 0) / (10 ** (product.minorUnit ?? 2)))}`;
  }

  function moneyAmount(value) {
    return `KSh ${new Intl.NumberFormat("en-KE").format(Math.round(Number(value || 0)))}`;
  }

  function productPricing(product) {
    const unit = 10 ** (product.minorUnit ?? 2);
    const current = Number(product.price || 0) / unit;
    const supplier = current ? Math.round(current / 1.6) : 0;
    const previous = Number(product.regularPrice || 0) / unit || Math.round(supplier * 1.8);
    return { supplier, profit: current - supplier, current, previous };
  }

  function updatePriceFields(form) {
    const supplier = Math.max(0, Number(form.supplierPrice.value || 0));
    form.profitAmount.value = Math.round(supplier * 0.6);
    form.price.value = Math.round(supplier * 1.6);
    form.regularPrice.value = Math.round(supplier * 1.8);
  }

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]);
  }

  function renderEverything() {
    refreshCounts();
    renderStats();
    renderProductFilters();
    renderProducts();
    renderCategories();
  }

  function refreshCounts() {
    catalog.categories.forEach((category) => {
      category.count = catalog.products.filter((product) => product.categories?.includes(category.name)).length;
    });
  }

  function renderStats() {
    $("#product-count").textContent = catalog.products.length;
    $("#category-count").textContent = catalog.categories.length;
    $("#stock-count").textContent = catalog.products.filter((product) => product.inStock).length;
    $("#sale-count").textContent = catalog.products.filter((product) => product.onSale).length;
  }

  function renderProductFilters() {
    const selected = els.categoryFilter.value || "All";
    els.categoryFilter.innerHTML = `<option value="All">All categories</option>${catalog.categories.map((category) => `<option value="${escapeHTML(category.name)}">${escapeHTML(category.name)}</option>`).join("")}`;
    if ([...els.categoryFilter.options].some((option) => option.value === selected)) els.categoryFilter.value = selected;
  }

  function renderProducts() {
    const query = els.productSearch.value.trim().toLowerCase();
    const category = els.categoryFilter.value;
    const rows = catalog.products.filter((product) => {
      const matchesText = !query || `${product.name} ${product.sku || ""} ${(product.categories || []).join(" ")}`.toLowerCase().includes(query);
      return matchesText && (category === "All" || product.categories?.includes(category));
    });
    els.productRows.innerHTML = rows.length ? rows.map((product) => {
      const pricing = productPricing(product);
      return `
        <div class="table-row" data-product-id="${product.id}">
          <div class="product-cell">${product.image ? `<img src="${escapeHTML(product.image)}" alt="" loading="lazy" />` : `<span class="product-placeholder">B</span>`}<div><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.sku || `ID ${product.id}`)}</small></div></div>
          <span>${escapeHTML(product.categories?.[0] || "Uncategorised")}</span>
          <span class="price-cell"><small>Supplier ${moneyAmount(pricing.supplier)}</small><strong>Website ${moneyAmount(pricing.current)}</strong><small class="profit-line">Profit +${moneyAmount(pricing.profit)}</small><del>Old ${moneyAmount(pricing.previous)}</del></span>
          <span class="status-pill ${product.inStock ? "" : "out"}">${product.inStock ? "In stock" : "Check stock"}</span>
          <button class="row-action" type="button" data-edit-product="${product.id}" aria-label="Edit ${escapeHTML(product.name)}">•••</button>
        </div>`;
    }).join("") : `<div class="empty-table">No products match this search.</div>`;
  }

  function renderCategories() {
    refreshCounts();
    els.categoryRows.innerHTML = catalog.categories.length ? catalog.categories.map((category) => `
      <div class="table-row" data-category-id="${category.id}">
        <input value="${escapeHTML(category.name)}" data-category-field="name" aria-label="Category name" />
        <span>${category.count}</span>
        <input type="url" value="${escapeHTML(category.image || "")}" data-category-field="image" aria-label="Category image URL" />
        <button class="row-action" type="button" data-delete-category="${category.id}" aria-label="Delete ${escapeHTML(category.name)}">×</button>
      </div>`).join("") : `<div class="empty-table">No categories have been added.</div>`;
    enhanceImageInputs(els.categoryRows);
  }

  function openProductEditor(id = null) {
    activeProductId = id == null ? null : Number(id);
    const product = activeProductId == null ? {
      id: Date.now(), name: "", sku: "", description: "", shortDescription: "", categories: [catalog.categories[0]?.name || "Equipment"], image: "", gallery: [], price: 0, regularPrice: 0, salePrice: 0, currency: "KES", minorUnit: 2, onSale: false, inStock: true, rating: 0, reviewCount: 0
    } : catalog.products.find((item) => Number(item.id) === activeProductId);
    if (!product) return;
    els.dialogTitle.textContent = activeProductId == null ? "Add product" : "Edit product";
    els.deleteProduct.hidden = activeProductId == null;
    const form = els.productForm.elements;
    form.name.value = product.name || "";
    form.sku.value = product.sku || "";
    const pricing = productPricing(product);
    form.supplierPrice.value = pricing.supplier;
    form.profitAmount.value = pricing.profit;
    form.price.value = pricing.current;
    form.regularPrice.value = pricing.previous;
    form.image.value = product.image || "";
    form.description.value = product.description || "";
    form.inStock.checked = product.inStock !== false;
    form.onSale.checked = true;
    form.category.innerHTML = catalog.categories.map((category) => `<option value="${escapeHTML(category.name)}">${escapeHTML(category.name)}</option>`).join("");
    form.category.value = product.categories?.[0] || catalog.categories[0]?.name || "";
    els.dialog.dataset.draft = JSON.stringify(product);
    els.dialog.showModal();
  }

  function saveProduct() {
    const form = els.productForm.elements;
    const draft = JSON.parse(els.dialog.dataset.draft);
    const minorUnit = Number(draft.minorUnit ?? 2);
    const supplierPrice = Math.max(0, Number(form.supplierPrice.value || 0));
    const websitePrice = Math.round(supplierPrice * 1.6);
    const previousPrice = Math.round(supplierPrice * 1.8);
    const updated = {
      ...draft,
      name: form.name.value.trim(), sku: form.sku.value.trim(), description: form.description.value.trim(), shortDescription: form.description.value.trim(),
      categories: [form.category.value], image: form.image.value.trim(), gallery: form.image.value.trim() ? [form.image.value.trim()] : [],
      price: websitePrice * (10 ** minorUnit), regularPrice: previousPrice * (10 ** minorUnit),
      salePrice: websitePrice * (10 ** minorUnit), inStock: form.inStock.checked, onSale: supplierPrice > 0
    };
    if (!updated.name) return;
    if (activeProductId == null) catalog.products.unshift(updated);
    else catalog.products[catalog.products.findIndex((item) => Number(item.id) === activeProductId)] = updated;
    els.dialog.close();
    markDirty();
    renderEverything();
    toast(activeProductId == null ? "Product added" : "Product updated");
  }

  async function publishChanges() {
    site.phoneDigits = String(site.phoneDisplay || "").replace(/\D/g, "");
    if (site.phoneDigits.startsWith("0")) site.phoneDigits = `254${site.phoneDigits.slice(1)}`;
    refreshCounts();
    catalog.generatedAt = new Date().toISOString();
    els.save.disabled = true;
    els.save.textContent = "Publishing…";
    try {
      const result = await request("save", { site, catalog });
      markSaved();
      toast(result.message || "Changes published successfully");
    } catch (error) {
      toast(error.message);
      els.saveState.textContent = "Publish failed";
      els.saveState.classList.add("dirty");
    } finally {
      els.save.disabled = false;
      els.save.textContent = "Publish changes";
    }
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ site, catalog }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `bevalink-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.loginError.textContent = "";
    els.loginNotice.textContent = "";
    const button = $("button[type='submit']", els.loginForm);
    button.disabled = true;
    try { await request("login", { password: $("#password").value }); $("#password").value = ""; openDashboard(); }
    catch (error) { els.loginError.textContent = error.message; }
    finally { button.disabled = false; }
  });

  els.forgotPassword.addEventListener("click", async () => {
    els.loginError.textContent = "";
    els.loginNotice.textContent = "";
    els.forgotPassword.disabled = true;
    els.forgotPassword.textContent = "Sending reset email…";
    try {
      const result = await request("forgotPassword");
      els.loginNotice.textContent = result.message || "Check the admin email for the password reset link.";
    } catch (error) {
      els.loginError.textContent = error.message;
    } finally {
      els.forgotPassword.disabled = false;
      els.forgotPassword.textContent = "Forgot password? Reset it by email";
    }
  });

  els.resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.resetError.textContent = "";
    const password = $("#new-password").value;
    const confirmation = $("#confirm-password").value;
    if (password.length < 12) { els.resetError.textContent = "Use at least 12 characters."; return; }
    if (password !== confirmation) { els.resetError.textContent = "The passwords do not match."; return; }
    const button = $("button[type='submit']", els.resetForm);
    button.disabled = true;
    try {
      await request("resetPassword", { accessToken: recoveryToken, password });
      history.replaceState(null, "", "/admin");
      $("#new-password").value = "";
      $("#confirm-password").value = "";
      openDashboard();
      toast("Your admin password has been changed.");
    } catch (error) {
      els.resetError.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $$('[data-jump]').forEach((button) => button.addEventListener("click", () => { switchView(button.dataset.jump); if (button.dataset.jump === "products") openProductEditor(); }));
  $$('[data-setting]').forEach((input) => input.addEventListener("input", () => { site[input.dataset.setting] = input.value; markDirty(); }));
  $$('[data-color]').forEach((input) => input.addEventListener("input", () => { site.colors ||= {}; site.colors[input.dataset.color] = input.value; input.previousElementSibling.querySelector("i").style.background = input.value; markDirty(); }));
  $$('[data-visibility]').forEach((input) => input.addEventListener("change", () => { site.visibility ||= {}; site.visibility[input.dataset.visibility] = input.checked; markDirty(); }));
  els.productSearch.addEventListener("input", renderProducts);
  els.categoryFilter.addEventListener("change", renderProducts);
  $("#add-product-button").addEventListener("click", () => openProductEditor());
  els.productRows.addEventListener("click", (event) => { const button = event.target.closest("[data-edit-product]"); if (button) openProductEditor(button.dataset.editProduct); });
  $$(".dialog-close").forEach((button) => button.addEventListener("click", () => els.dialog.close()));
  els.productForm.addEventListener("submit", (event) => { event.preventDefault(); saveProduct(); });
  els.productForm.elements.supplierPrice.addEventListener("input", () => updatePriceFields(els.productForm.elements));
  els.deleteProduct.addEventListener("click", () => { if (activeProductId == null || !confirm("Delete this product permanently?")) return; catalog.products = catalog.products.filter((item) => Number(item.id) !== activeProductId); els.dialog.close(); markDirty(); renderEverything(); toast("Product deleted"); });
  $("#add-category-button").addEventListener("click", () => { const name = prompt("New category name"); if (!name?.trim()) return; catalog.categories.push({ id: Date.now(), name: name.trim(), slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), count: 0, image: "" }); markDirty(); renderEverything(); });
  els.categoryRows.addEventListener("change", (event) => {
    const input = event.target.closest("[data-category-field]"); if (!input) return;
    const row = input.closest("[data-category-id]"); const category = catalog.categories.find((item) => String(item.id) === row.dataset.categoryId); if (!category) return;
    if (input.dataset.categoryField === "name") { const previous = category.name; category.name = input.value.trim() || previous; catalog.products.forEach((product) => { product.categories = (product.categories || []).map((name) => name === previous ? category.name : name); }); }
    else category.image = input.value.trim();
    markDirty(); renderEverything();
  });
  els.categoryRows.addEventListener("click", (event) => { const button = event.target.closest("[data-delete-category]"); if (!button) return; const category = catalog.categories.find((item) => String(item.id) === button.dataset.deleteCategory); if (!category || !confirm(`Delete the ${category.name} category? Products will remain in the catalogue.`)) return; catalog.categories = catalog.categories.filter((item) => item !== category); markDirty(); renderEverything(); });
  els.save.addEventListener("click", publishChanges);
  $("#export-button").addEventListener("click", exportBackup);
  $("#logout-button").addEventListener("click", async () => { await request("logout").catch(() => {}); location.reload(); });
  $("#mobile-menu").addEventListener("click", () => els.sidebar.classList.toggle("open"));
  window.addEventListener("beforeunload", (event) => { if (!dirty) return; event.preventDefault(); event.returnValue = ""; });
  start();
})();
