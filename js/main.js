/* ═══════════════════════════════════════════════════════════════
   BonVoy — Customer Site JS
   Products loading, cart logic, fly animation, order form, GPS
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─── Constants ─────────────────────────────────────────────── */
const CART_KEY      = 'bonvoy_cart';
const PRODUCTS_KEY  = 'bonvoy_products';
const PRODUCTS_TTL  = 5 * 60 * 1000; // 5 minutes
const CITIES        = ['Amman','Salt','Zarqa','Jerash','Irbid','Madaba','Balqaa'];
const CITY_MAP = {
  'amman': 'Amman',  'عمان': 'Amman',
  'salt':  'Salt',   'السلط': 'Salt',
  'zarqa': 'Zarqa',  'الزرقاء': 'Zarqa',
  'jerash':'Jerash',  'جرش': 'Jerash',
  'irbid': 'Irbid',  'اربد': 'Irbid',
  'madaba':'Madaba',  'مادبا': 'Madaba',
  'balqaa':'Balqaa',  'البلقاء': 'Balqaa',
};
const NAME_RE  = /^[؀-ۿa-zA-Z\s'\-]{2,80}$/;
const PHONE_RE = /^(07[789]\d{7}|(\+9627[789]\d{7}))$/;

/* ─── State ─────────────────────────────────────────────────── */
let allProducts      = [];
let activeCategory   = 'all';
let deliveryFees     = {};
let currentFee       = null;
let locationMode     = 'gps'; // 'gps' | 'manual'
let detectedLocation = null;  // { lat, lon, address }

/* ─── DOM refs ──────────────────────────────────────────────── */
const navbar        = document.getElementById('navbar');
const cartBtn       = document.getElementById('cart-btn');
const cartBadge     = document.getElementById('cart-badge');
const cartOverlay   = document.getElementById('cart-overlay');
const cartSidebar   = document.getElementById('cart-sidebar');
const cartClose     = document.getElementById('cart-close');
const cartItemsEl   = document.getElementById('cart-items');
const cartFooter    = document.getElementById('cart-footer');
const cartSubtotal  = document.getElementById('cart-subtotal');
const cartDelivery  = document.getElementById('cart-delivery');
const cartTotal     = document.getElementById('cart-total');
const btnCheckout   = document.getElementById('btn-checkout');
const productGrid   = document.getElementById('product-grid');
const orderModal    = document.getElementById('order-modal');
const hamburger     = document.getElementById('hamburger');
const mobileMenu    = document.getElementById('mobile-menu');

/* ══════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  scatterStars();
  loadProducts();
  restoreCart();
  bindNavbar();
  bindCart();
  bindCategoryTabs();
  bindOrderModal();
  loadStoreStatus();
  setDateLimits();
});

/* ─── Scatter stars in hero ─────────────────────────────────── */
function scatterStars() {
  const deco = document.getElementById('hero-deco');
  if (!deco) return;
  const chars = ['✦','✧','★','✦','✧','★','✦','✧'];
  chars.slice(0, 7).forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = 'star-deco';
    s.textContent = ch;
    s.style.cssText = `
      left: ${10 + Math.random() * 80}%;
      top:  ${5  + Math.random() * 85}%;
      color: #D4622A;
      font-size: ${12 + Math.random() * 14}px;
      opacity: 0.5;
      --twinkle-dur: ${1.5 + Math.random() * 2}s;
      --twinkle-delay: ${Math.random() * 2}s;
    `;
    deco.appendChild(s);
  });
}

/* ─── Navbar scroll shadow ──────────────────────────────────── */
function bindNavbar() {
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 10);
    highlightActiveSection();
  }, { passive: true });

  // Smooth scroll for nav links
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
      // close mobile menu if open
      hamburger.classList.remove('open');
      mobileMenu.classList.remove('open');
    });
  });

  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    mobileMenu.classList.toggle('open');
  });

  document.querySelectorAll('.mob-link').forEach(a => {
    a.addEventListener('click', () => {
      hamburger.classList.remove('open');
      mobileMenu.classList.remove('open');
    });
  });
}

function highlightActiveSection() {
  const sections = ['home','menu','about'];
  let current = 'home';
  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el && window.scrollY >= el.offsetTop - 120) current = id;
  });
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === '#' + current);
  });
}

/* ─── Store status ──────────────────────────────────────────── */
async function loadStoreStatus() {
  try {
    const snap = await db.collection('settings').doc('store_info').get();
    if (snap.exists && snap.data().isOpen === false) {
      document.getElementById('store-closed-banner').classList.add('visible');
    }
  } catch (_) {}
}

/* ══════════════════════════════════════════════════════════════
   PRODUCTS
   ══════════════════════════════════════════════════════════════ */
async function loadProducts() {
  // Try cache first
  const cached = getCachedProducts();
  if (cached) {
    allProducts = cached;
    renderProducts();
    loadDeliveryFees();
    return;
  }

  try {
    const res  = await fetch('/.netlify/functions/get-products?category=all');
    const data = await res.json();
    allProducts = data.products || [];
    cacheProducts(allProducts);
    renderProducts();
    loadDeliveryFees();
  } catch (err) {
    productGrid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--color-error)">
      Failed to load products. Please refresh the page.</p>`;
  }
}

function getCachedProducts() {
  try {
    const raw = localStorage.getItem(PRODUCTS_KEY);
    if (!raw) return null;
    const { ts, products } = JSON.parse(raw);
    if (Date.now() - ts > PRODUCTS_TTL) return null;
    return products;
  } catch (_) { return null; }
}

function cacheProducts(products) {
  try {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify({ ts: Date.now(), products }));
  } catch (_) {}
}

function renderProducts() {
  const filtered = activeCategory === 'all'
    ? allProducts
    : allProducts.filter(p => p.category === activeCategory);

  if (!filtered.length) {
    productGrid.innerHTML = `<p style="grid-column:1/-1;text-align:center;opacity:0.6">
      No products in this category yet.</p>`;
    return;
  }

  productGrid.innerHTML = filtered.map(p => `
    <div class="product-card">
      <div class="card-img-wrap">
        <img loading="lazy" src="${escHtml(p.imageUrl)}" alt="${escHtml(p.name)}"
             width="400" height="300">
      </div>
      <div class="card-body">
        <span class="card-category">${escHtml(p.category)}</span>
        <h3 class="card-name">${escHtml(p.name)}</h3>
        <p class="card-desc">${escHtml(p.description)}</p>
        <div class="card-footer">
          <span class="card-price">JOD ${Number(p.price).toFixed(2)}</span>
          <button class="btn-add"
                  data-id="${escHtml(p.id)}"
                  data-name="${escHtml(p.name)}"
                  data-price="${p.price}"
                  data-img="${escHtml(p.imageUrl)}">
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  `).join('');

  // Bind add-to-cart buttons
  productGrid.querySelectorAll('.btn-add').forEach(btn => {
    btn.addEventListener('click', e => {
      const { id, name, price, img } = btn.dataset;
      const imgEl = btn.closest('.product-card').querySelector('.card-img-wrap img');
      flyToCart(imgEl, { id, name, price: parseFloat(price), imageUrl: img });
    });
  });
}

/* ─── Category tabs ─────────────────────────────────────────── */
function bindCategoryTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = btn.dataset.category;
      renderProducts();
    });
  });
}

/* ─── Delivery fees ─────────────────────────────────────────── */
async function loadDeliveryFees() {
  try {
    const snap = await db.collection('settings').doc('delivery_fees').get();
    if (snap.exists) deliveryFees = snap.data();
  } catch (_) {}
}

/* ══════════════════════════════════════════════════════════════
   CART STATE
   ══════════════════════════════════════════════════════════════ */
function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch (_) { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function addToCart(item) {
  const cart = getCart();
  const existing = cart.find(c => c.id === item.id);
  if (existing) {
    existing.qty = Math.min(existing.qty + 1, 99);
  } else {
    cart.push({ ...item, qty: 1 });
  }
  saveCart(cart);
  updateCartUI();
}

function removeFromCart(id) {
  saveCart(getCart().filter(c => c.id !== id));
  updateCartUI();
}

function updateQty(id, delta) {
  const cart = getCart();
  const item = cart.find(c => c.id === id);
  if (!item) return;
  item.qty = Math.max(1, Math.min(99, item.qty + delta));
  saveCart(cart);
  updateCartUI();
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  updateCartUI();
}

function getCartTotal() {
  return getCart().reduce((sum, item) => sum + item.price * item.qty, 0);
}

/* ─── Update all cart UI ────────────────────────────────────── */
function updateCartUI() {
  const cart = getCart();
  const count = cart.reduce((s, i) => s + i.qty, 0);

  // Badge
  cartBadge.textContent = count;
  cartBadge.classList.toggle('visible', count > 0);

  // Items list
  if (!cart.length) {
    cartItemsEl.innerHTML = `
      <div class="cart-empty">
        <svg width="64" height="80" viewBox="0 0 80 110" fill="none" aria-hidden="true">
          <path d="M40 8 C40 8 62 14 62 38 L62 68 L50 80 L30 80 L18 68 L18 38 C18 14 40 8 40 8Z"
                stroke="#D4622A" stroke-width="2" fill="rgba(212,98,42,0.1)" stroke-linejoin="round"/>
          <circle cx="40" cy="38" r="9" fill="none" stroke="#D4622A" stroke-width="2"/>
          <circle cx="40" cy="38" r="4" fill="#D4622A"/>
          <path d="M32 78 L30 90 L40 84 L50 90 L48 78" fill="#E8891A" opacity="0.6"/>
        </svg>
        <p>Your cart is empty</p>
      </div>`;
    cartFooter.style.display = 'none';
    return;
  }

  cartItemsEl.innerHTML = cart.map(item => `
    <div class="cart-item" data-id="${escHtml(item.id)}">
      <img class="cart-item-img" src="${escHtml(item.imageUrl)}" alt="${escHtml(item.name)}" width="56" height="56">
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(item.name)}</div>
        <div class="cart-item-price">JOD ${(item.price * item.qty).toFixed(2)}</div>
        <div class="cart-item-actions">
          <button class="qty-btn" data-action="dec" data-id="${escHtml(item.id)}">−</button>
          <span class="qty-display">${item.qty}</span>
          <button class="qty-btn" data-action="inc" data-id="${escHtml(item.id)}">+</button>
        </div>
      </div>
      <button class="cart-remove" data-id="${escHtml(item.id)}" aria-label="Remove ${escHtml(item.name)}">×</button>
    </div>
  `).join('');

  // Bind qty/remove buttons
  cartItemsEl.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => updateQty(btn.dataset.id, btn.dataset.action === 'inc' ? 1 : -1));
  });
  cartItemsEl.querySelectorAll('.cart-remove').forEach(btn => {
    btn.addEventListener('click', () => removeFromCart(btn.dataset.id));
  });

  const subtotal = getCartTotal();
  cartSubtotal.textContent = `JOD ${subtotal.toFixed(2)}`;
  cartDelivery.textContent  = 'Select city at checkout';
  cartTotal.textContent     = `JOD ${subtotal.toFixed(2)}`;
  cartFooter.style.display  = 'block';
}

function restoreCart() { updateCartUI(); }

/* ─── Cart sidebar bindings ─────────────────────────────────── */
function bindCart() {
  cartBtn.addEventListener('click', openCart);
  cartClose.addEventListener('click', closeCart);
  cartOverlay.addEventListener('click', closeCart);
  btnCheckout.addEventListener('click', () => { closeCart(); openOrderModal(); });
}

function openCart() {
  cartOverlay.classList.add('open');
  cartSidebar.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  cartOverlay.classList.remove('open');
  cartSidebar.classList.remove('open');
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════════════════════════════
   FLY-TO-CART ANIMATION
   ══════════════════════════════════════════════════════════════ */
function flyToCart(imgEl, item) {
  addToCart(item);

  if (!imgEl) return;
  const imgRect  = imgEl.getBoundingClientRect();
  const cartRect = cartBtn.getBoundingClientRect();

  const ghost     = document.createElement('img');
  ghost.src       = item.imageUrl;
  ghost.style.cssText = `
    position: fixed;
    left: ${imgRect.left + imgRect.width / 2 - 30}px;
    top:  ${imgRect.top  + imgRect.height / 2 - 30}px;
    width: 60px; height: 60px;
    border-radius: 50%;
    object-fit: cover;
    pointer-events: none;
    z-index: 9999;
    transition: transform 0.65s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                opacity 0.65s ease;
  `;
  document.body.appendChild(ghost);

  // Trigger reflow
  ghost.offsetHeight; // eslint-disable-line no-unused-expressions

  const deltaX = (cartRect.left + cartRect.width  / 2) - (imgRect.left + imgRect.width  / 2);
  const deltaY = (cartRect.top  + cartRect.height / 2) - (imgRect.top  + imgRect.height / 2);

  ghost.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(0.1)`;
  ghost.style.opacity   = '0';

  ghost.addEventListener('transitionend', () => {
    ghost.remove();
    // Badge bounce
    cartBadge.classList.remove('bounce');
    void cartBadge.offsetWidth;
    cartBadge.classList.add('bounce');
    setTimeout(() => cartBadge.classList.remove('bounce'), 400);
  }, { once: true });
}

/* ══════════════════════════════════════════════════════════════
   ORDER MODAL
   ══════════════════════════════════════════════════════════════ */
function bindOrderModal() {
  orderModal.addEventListener('click', e => {
    if (e.target === orderModal) closeOrderModal();
  });

  document.getElementById('f-city').addEventListener('change', onCityChange);
  document.getElementById('btn-detect').addEventListener('click', detectLocation);
  document.getElementById('switch-to-manual').addEventListener('click', switchToManual);
  document.getElementById('switch-to-gps').addEventListener('click', switchToGPS);
  document.getElementById('order-form').addEventListener('submit', submitOrder);
}

function openOrderModal() {
  if (!getCart().length) { openCart(); return; }
  populateModalSummary();
  orderModal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeOrderModal() {
  orderModal.classList.remove('open');
  document.body.style.overflow = '';
}

function setDateLimits() {
  const dateInput = document.getElementById('f-date');
  const today = new Date();
  const max30  = new Date(); max30.setDate(today.getDate() + 30);
  const fmt = d => d.toISOString().split('T')[0];
  dateInput.min = fmt(today);
  dateInput.max = fmt(max30);
}

function onCityChange() {
  const city = document.getElementById('f-city').value;
  currentFee = deliveryFees[city] ?? null;
  updateModalSummaryFee();
}

function updateModalSummaryFee() {
  const subtotal = getCartTotal();
  const feeEl    = document.getElementById('modal-delivery-fee');
  const totalEl  = document.getElementById('modal-total');

  if (currentFee !== null) {
    feeEl.textContent  = `JOD ${currentFee.toFixed(2)}`;
    totalEl.textContent = `JOD ${(subtotal + currentFee).toFixed(2)}`;
  } else {
    feeEl.textContent  = 'Select city';
    totalEl.textContent = `JOD ${subtotal.toFixed(2)}`;
  }
}

function populateModalSummary() {
  const cart   = getCart();
  const listEl = document.getElementById('modal-items-list');
  const subEl  = document.getElementById('modal-subtotal');

  listEl.innerHTML = cart.map(item => `
    <div class="order-summary-item">
      <span>${escHtml(item.name)} × ${item.qty}</span>
      <span>JOD ${(item.price * item.qty).toFixed(2)}</span>
    </div>
  `).join('');

  const subtotal = getCartTotal();
  subEl.textContent = `JOD ${subtotal.toFixed(2)}`;
  updateModalSummaryFee();
}

/* ─── GPS Location ──────────────────────────────────────────── */
async function detectLocation() {
  const btn = document.getElementById('btn-detect');
  const resultEl = document.getElementById('location-result');
  const addrEl   = document.getElementById('detected-address');
  const accEl    = document.getElementById('location-accuracy');

  // Return cached result
  if (detectedLocation) {
    addrEl.textContent = detectedLocation.address;
    resultEl.style.display = 'flex';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Getting location…';

  if (!navigator.geolocation) {
    switchToManual('Location not supported by your browser.');
    btn.disabled = false;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      try {
        const res  = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=en&zoom=18&addressdetails=1`,
          { headers: { 'User-Agent': 'BonVoy-Delivery/1.0' } }
        );
        const data = await res.json();
        const a    = data.address || {};
        const parts = [a.road, a.house_number, a.neighbourhood, a.suburb].filter(Boolean).join(', ');
        const address = parts || (data.display_name || '').substring(0, 200);

        detectedLocation = { lat, lon, address };

        addrEl.textContent = address;
        accEl.textContent  = `Accuracy: ±${Math.round(accuracy)}m`;
        resultEl.style.display = 'flex';

        // Auto-match city
        const cityFields = [a.city, a.town, a.county, a.state, a.city_district];
        for (const f of cityFields) {
          if (!f) continue;
          const matched = CITY_MAP[f.toLowerCase()] || CITY_MAP[f];
          if (matched) {
            const sel = document.getElementById('f-city');
            sel.value = matched;
            onCityChange();
            break;
          }
        }
      } catch (_) {
        detectedLocation = { lat, lon, address: `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
        addrEl.textContent = detectedLocation.address;
        resultEl.style.display = 'flex';
      }
      btn.textContent = '📍 Detect My Location';
      btn.disabled = false;
    },
    err => {
      btn.textContent = '📍 Detect My Location';
      btn.disabled    = false;
      switchToManual('⚠️ Location access denied. Enter your address below.');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
  );
}

function switchToManual(errorMsg) {
  locationMode = 'manual';
  animateHeight(document.getElementById('mode-gps'), false);
  animateHeight(document.getElementById('mode-manual'), true);
  if (errorMsg) {
    const errEl = document.getElementById('err-address');
    errEl.textContent = typeof errorMsg === 'string' ? errorMsg : '';
    errEl.classList.toggle('visible', typeof errorMsg === 'string');
  }
}

function switchToGPS() {
  locationMode = 'gps';
  animateHeight(document.getElementById('mode-manual'), false);
  animateHeight(document.getElementById('mode-gps'), true);
}

function animateHeight(el, show) {
  if (show) {
    el.style.display = 'flex';
    const h = el.scrollHeight;
    el.style.height = '0px';
    el.style.overflow = 'hidden';
    el.style.transition = 'height 0.3s cubic-bezier(0.4,0,0.2,1)';
    requestAnimationFrame(() => { el.style.height = h + 'px'; });
    el.addEventListener('transitionend', () => {
      el.style.height = 'auto';
      el.style.overflow = '';
    }, { once: true });
  } else {
    el.style.height = el.scrollHeight + 'px';
    el.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      el.style.transition = 'height 0.3s cubic-bezier(0.4,0,0.2,1)';
      el.style.height = '0px';
    });
    el.addEventListener('transitionend', () => { el.style.display = 'none'; el.style.height = ''; }, { once: true });
  }
}

/* ─── Form Validation ───────────────────────────────────────── */
function showErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('visible');
}
function clearErr(id) { document.getElementById(id).classList.remove('visible'); }
function setInputError(inputId, hasErr) {
  const el = document.getElementById(inputId);
  if (el) el.classList.toggle('error', hasErr);
}

function validateForm() {
  let valid = true;

  const name = document.getElementById('f-name').value.trim();
  if (!NAME_RE.test(name)) {
    showErr('err-name', 'Name must be 2–80 characters, letters only'); setInputError('f-name', true); valid = false;
  } else { clearErr('err-name'); setInputError('f-name', false); }

  const phone = document.getElementById('f-phone').value.trim();
  if (!PHONE_RE.test(phone)) {
    showErr('err-phone', 'Enter a valid Jordanian number'); setInputError('f-phone', true); valid = false;
  } else { clearErr('err-phone'); setInputError('f-phone', false); }

  const city = document.getElementById('f-city').value;
  if (!CITIES.includes(city)) {
    showErr('err-city', 'Please select your city'); setInputError('f-city', true); valid = false;
  } else { clearErr('err-city'); setInputError('f-city', false); }

  // Address
  let address = '';
  if (locationMode === 'gps') {
    if (!detectedLocation) {
      showErr('err-address', 'Please detect your location or switch to manual'); valid = false;
    } else {
      address = detectedLocation.address;
      clearErr('err-address');
    }
  } else {
    address = document.getElementById('address-manual').value.trim();
    const stripped = stripHTML(address);
    if (stripped.length < 5 || stripped.length > 300) {
      showErr('err-address', 'Address must be 5–300 characters'); valid = false;
    } else { clearErr('err-address'); }
  }

  const dateVal = document.getElementById('f-date').value;
  if (!dateVal) {
    showErr('err-date', 'Please select a delivery date'); setInputError('f-date', true); valid = false;
  } else {
    const chosen = new Date(dateVal);
    const today  = new Date(); today.setHours(0,0,0,0);
    const max30  = new Date(); max30.setDate(max30.getDate() + 30); max30.setHours(23,59,59,999);
    if (chosen < today || chosen > max30) {
      showErr('err-date', 'Date must be today or within the next 30 days'); setInputError('f-date', true); valid = false;
    } else { clearErr('err-date'); setInputError('f-date', false); }
  }

  return valid;
}

/* ─── Submit ────────────────────────────────────────────────── */
async function submitOrder(e) {
  e.preventDefault();

  // Honeypot check
  if (document.getElementById('hp-field').value !== '') return;

  if (!validateForm()) return;

  const btn = document.getElementById('btn-place-order');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Placing order…';

  const city    = document.getElementById('f-city').value;
  const address = locationMode === 'gps'
    ? detectedLocation.address
    : stripHTML(document.getElementById('address-manual').value.trim());

  const payload = {
    name:         document.getElementById('f-name').value.trim(),
    phone:        document.getElementById('f-phone').value.trim(),
    city,
    address,
    locationMode,
    coordinates:  locationMode === 'gps' ? { lat: detectedLocation.lat, lon: detectedLocation.lon } : null,
    items:        getCart().map(i => ({ id: i.id, name: i.name, qty: i.qty, price: i.price })),
    notes:        stripHTML(document.getElementById('f-notes').value.trim()),
    deliveryDate: document.getElementById('f-date').value,
    _hp:          document.getElementById('hp-field').value,
  };

  try {
    const res  = await fetch('/.netlify/functions/submit-order', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.status === 201) {
      showSuccessScreen(data.orderId, payload.phone);
      clearCart();
    } else if (res.status === 429) {
      showFormError('Too many orders, please wait a moment and try again.');
    } else if (res.status === 400) {
      if (data.errors) {
        Object.entries(data.errors).forEach(([field, msg]) => showErr('err-' + field, msg));
      } else {
        showFormError(data.error || 'Validation failed. Please check your details.');
      }
    } else {
      showFormError('Something went wrong. Please try again.');
    }
  } catch (_) {
    showFormError('Connection issue. Please check your internet and try again.');
  }

  btn.disabled = false;
  btn.innerHTML = 'Place Order 🚀';
}

function showFormError(msg) {
  let errBanner = document.getElementById('form-error-banner');
  if (!errBanner) {
    errBanner = document.createElement('div');
    errBanner.id = 'form-error-banner';
    errBanner.style.cssText = 'color:var(--color-error);background:rgba(198,40,40,0.08);border-radius:12px;padding:12px 16px;margin-bottom:12px;font-size:0.875rem;font-weight:600;';
    document.getElementById('order-form').prepend(errBanner);
  }
  errBanner.textContent = msg;
}

function showSuccessScreen(orderId, phone) {
  const card = document.getElementById('modal-card');
  card.innerHTML = `
    <div class="success-screen">
      <div class="success-check">🎉</div>
      <h3>Order Placed!</h3>
      <p>Your order <span class="order-id-display">#${escHtml(orderId)}</span> is confirmed.</p>
      <p>We'll contact you at <strong>${escHtml(phone)}</strong> to confirm delivery.</p>
      <p style="margin-top:8px;opacity:0.7;font-size:0.82rem">Check your Instagram DMs from @bonvoy.jo for updates.</p>
      <button class="btn btn-primary" style="margin-top:24px" id="btn-success-close">Close</button>
    </div>
  `;
  document.getElementById('btn-success-close').addEventListener('click', closeOrderModal);
}

/* ══════════════════════════════════════════════════════════════
   SEED DATA (call seedProducts() from browser console once,
   while logged in as admin)
   ══════════════════════════════════════════════════════════════ */
/* async function seedProducts() {
  const products = [
    { name:'Nutella Brownie Box', category:'Brownies', price:4.50, description:'Rich fudgy brownie loaded with Nutella, 6 pieces per box', available:true, imageUrl:'https://placehold.co/400x300/D4622A/FFFFFF?text=Nutella+Brownie+Box' },
    { name:'Lotus Brownie',       category:'Brownies', price:5.00, description:'Biscoff-swirled brownie, crispy caramelized edges',          available:true, imageUrl:'https://placehold.co/400x300/D4622A/FFFFFF?text=Lotus+Brownie' },
    { name:'Cookie Dough Brownie',category:'Brownies', price:5.50, description:'Fudgy brownie topped with unbaked cookie dough',            available:true, imageUrl:'https://placehold.co/400x300/D4622A/FFFFFF?text=Cookie+Dough+Brownie' },
    { name:'Birthday Cake',       category:'Cakes',    price:18.00,description:'Custom 1kg cake, message of your choice included',          available:true, imageUrl:'https://placehold.co/400x300/D4622A/FFFFFF?text=Birthday+Cake' },
    { name:'Spiderman Cake',      category:'Cakes',    price:22.00,description:'Character fondant cake, serves 8–10 people',               available:true, imageUrl:'https://placehold.co/400x300/D4622A/FFFFFF?text=Spiderman+Cake' },
    { name:'Batman Cake',         category:'Cakes',    price:22.00,description:'Yellow & black character cake, serves 8–10 people',        available:true, imageUrl:'https://placehold.co/400x300/D4622A/FFFFFF?text=Batman+Cake' },
    { name:'Choc Chip Cookie',    category:'Cookies',  price:2.50, description:'Soft & gooey American-style, pack of 4',                   available:true, imageUrl:'https://placehold.co/400x300/D4622A/FFFFFF?text=Choc+Chip+Cookie' },
    { name:'BonVoy Gift Box',     category:'Specials', price:12.00,description:'Assorted brownies & cookies in branded orange box',        available:true, imageUrl:'https://placehold.co/400x300/D4622A/FFFFFF?text=BonVoy+Gift+Box' },
  ];
  const user = firebase.auth().currentUser;
  if (!user) { console.error('Not logged in'); return; }
  const token = await user.getIdToken();
  for (const p of products) {
    const res = await fetch('/.netlify/functions/admin-action', {
      method:'POST',
      headers:{ 'Content-Type':'application/json','Authorization':'Bearer '+token },
      body: JSON.stringify({ action:'addProduct', payload: p })
    });
    const d = await res.json();
    console.log('Added:', p.name, d);
  }
  console.log('Seed complete!');
} */

/* ─── Helpers ───────────────────────────────────────────────── */
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function stripHTML(str) {
  return String(str).replace(/<[^>]*>/g, '').trim();
}
