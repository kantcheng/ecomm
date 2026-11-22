/* ============================================================
   Voltaro storefront logic — cart (localStorage), rendering,
   GDPR cookie consent, shared header/footer behaviours.
   ============================================================ */

const CART_KEY = "voltaro_cart_v1";
const COOKIE_KEY = "voltaro_cookie_consent_v1";

/* ---------- Cart ---------- */
function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || {};
  } catch {
    return {};
  }
}
function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}
function addToCart(id, qty = 1) {
  const cart = getCart();
  cart[id] = (cart[id] || 0) + qty;
  saveCart(cart);
  toast(`✓ ${findProduct(id).name} added to cart`);
}
function setQty(id, qty) {
  const cart = getCart();
  if (qty <= 0) delete cart[id];
  else cart[id] = qty;
  saveCart(cart);
}
function cartCount() {
  const cart = getCart();
  return Object.values(cart).reduce((a, b) => a + b, 0);
}
function cartSubtotal() {
  const cart = getCart();
  return Object.entries(cart).reduce((sum, [id, q]) => sum + findProduct(id).price * q, 0);
}
function updateCartBadge() {
  document.querySelectorAll(".cart-badge").forEach((el) => {
    el.textContent = cartCount();
  });
}

/* ---------- Product card ---------- */
function starStr(r) {
  const full = Math.round(r);
  return "★".repeat(full) + "☆".repeat(5 - full);
}
function productCard(p) {
  return `
  <div class="card">
    <a class="thumb" href="product.html?id=${p.id}"><img src="${p.image}" alt="${p.name}" loading="lazy"></a>
    <div class="card-body">
      <span class="cat">${p.category}</span>
      ${p.badge ? `<span class="tag${p.badge === "Sale" ? " tag-green" : ""}">${p.badge}</span>` : ""}
      <h3><a href="product.html?id=${p.id}">${p.name}</a></h3>
      <div class="stars">${starStr(p.rating)}<small>${p.rating} (${p.reviews.toLocaleString()})</small></div>
      <div class="price-row">
        <div class="price">${eur(p.price)}${p.was ? `<s>${eur(p.was)}</s>` : ""}</div>
        <button class="add-btn" data-add="${p.id}">Add</button>
      </div>
    </div>
  </div>`;
}

/* ---------- Global click handler for add-to-cart ---------- */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-add]");
  if (btn) {
    addToCart(btn.dataset.add);
    return;
  }
  const qtyBtn = e.target.closest("[data-qty]");
  if (qtyBtn) {
    const id = qtyBtn.dataset.qty;
    const delta = parseInt(qtyBtn.dataset.delta, 10);
    setQty(id, (getCart()[id] || 0) + delta);
    renderCart?.();
    return;
  }
  const rm = e.target.closest("[data-remove]");
  if (rm) {
    setQty(rm.dataset.remove, 0);
    renderCart?.();
  }
});

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ---------- GDPR cookie consent ---------- */
function initCookieBanner() {
  const bar = document.getElementById("cookieBar");
  if (!bar) return;
  if (!localStorage.getItem(COOKIE_KEY)) bar.classList.add("show");
  bar.querySelectorAll("[data-consent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      localStorage.setItem(COOKIE_KEY, btn.dataset.consent);
      bar.classList.remove("show");
    });
  });
}

/* ---------- Shared init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  updateCartBadge();
  initCookieBanner();
});
