/* ═══════════════════════════════════════════════════════════════
   BonVoy Admin JS
   Auth guard, orders, products, settings, real-time updates
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const LAST_SEEN_KEY = 'bonvoy_admin_last_seen';
const CITIES        = ['Amman','Salt','Zarqa','Jerash','Irbid','Madaba','Balqaa'];

let ordersLastId     = null;
let allOrdersLoaded  = false;
let ordersUnsubscribe = null;

/* ══════════════════════════════════════════════════════════════
   AUTH GUARD
   ══════════════════════════════════════════════════════════════ */
firebase.auth().onAuthStateChanged(user => {
  if (!user) { window.location.replace('/admin/login.html'); return; }

  user.getIdToken().then(token => {
    window._adminToken = token;

    // Show email in UI
    const email = user.email || '';
    document.getElementById('sidebar-email').textContent = email;
    document.getElementById('topbar-email').textContent  = email;

    initDashboard();
  });
});

// Refresh token every 55 minutes (Firebase tokens expire at 60)
setInterval(() => {
  firebase.auth().currentUser?.getIdToken(true).then(t => { window._adminToken = t; });
}, 55 * 60 * 1000);

/* ─── API helper ────────────────────────────────────────────── */
async function adminAction(action, payload = {}) {
  const res = await fetch('/.netlify/functions/admin-action', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + window._adminToken,
    },
    body: JSON.stringify({ action, payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data.data;
}

/* ══════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════ */
function initDashboard() {
  bindTabs();
  bindLogout();
  loadOrdersTab();
  loadProductsTab();
  loadSettingsTab();
  startRealtimeOrders();
}

/* ─── Tab switching ─────────────────────────────────────────── */
let _extrasGroupsLoaded = false;
function bindTabs() {
  const allNavItems = document.querySelectorAll('.nav-item, .bottom-nav-item');
  allNavItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      allNavItems.forEach(i => i.classList.toggle('active', i.dataset.tab === tab));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
      // Also sync mobile nav items
      document.querySelectorAll('.mobile-nav-item[data-tab]').forEach(m => {
        m.classList.toggle('active', m.dataset.tab === tab);
      });

      if (tab === 'orders') markOrdersSeen();
      if (tab === 'extras-groups' && !_extrasGroupsLoaded) {
        _extrasGroupsLoaded = true;
        loadExtrasGroupsTab();
      }
    });
  });
}

/* ─── Logout ────────────────────────────────────────────────── */
function bindLogout() {
  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (ordersUnsubscribe) ordersUnsubscribe();
    await firebase.auth().signOut();
    window.location.replace('/admin/login.html');
  });
}

/* ─── Toast ─────────────────────────────────────────────────── */
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast ' + type + ' visible';
  setTimeout(() => { t.classList.remove('visible'); }, 3500);
}

/* ═══════════════════════════════════════════════════════════════
   ORDERS TAB
   ═══════════════════════════════════════════════════════════════ */
async function loadOrdersTab() {
  ordersLastId    = null;
  allOrdersLoaded = false;
  await fetchAndRenderOrders(true);
  bindOrderFilters();
  updateStats();
}

async function fetchAndRenderOrders(replace = false) {
  const search  = (document.getElementById('search-orders')?.value  || '').trim();
  const status  = document.getElementById('filter-status')?.value  || '';
  const city    = document.getElementById('filter-city')?.value    || '';

  const dateFrom = document.getElementById('filter-date-from')?.value || null;
  const dateTo   = document.getElementById('filter-date-to')?.value   || null;

  const payload = {
    status:   status   || undefined,
    city:     city     || undefined,
    search:   search   || undefined,
    dateFrom: dateFrom || undefined,
    dateTo:   dateTo   || undefined,
    limit: 20,
  };
  if (!replace && ordersLastId) payload.startAfter = ordersLastId;

  try {
    const { orders, lastId } = await adminAction('getOrders', payload);
    ordersLastId = lastId;
    if (!lastId || orders.length < 20) {
      allOrdersLoaded = true;
      document.getElementById('load-more-btn').style.display = 'none';
    } else {
      document.getElementById('load-more-btn').style.display = 'block';
    }

    const tbody  = document.getElementById('orders-tbody');
    const rows   = orders.map(o => renderOrderRow(o)).join('');
    if (replace) {
      tbody.innerHTML = rows || '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:0.5">No orders found.</td></tr>';
    } else {
      tbody.insertAdjacentHTML('beforeend', rows);
    }

    // Bind row clicks
    tbody.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', () => openOrderDetail(row.dataset.id));
    });
  } catch (err) {
    showToast('Failed to load orders: ' + err.message, 'error');
  }
}

function renderOrderRow(o) {
  const itemsCount = (o.items || []).reduce((s, i) => s + i.qty, 0);
  const dateStr    = o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-GB') : '—';
  return `
    <tr data-id="${escHtml(o.id)}">
      <td style="font-size:0.75rem;opacity:0.5">${escHtml(o.id.substring(0,8))}…</td>
      <td style="font-weight:600">${escHtml(o.customerName)}</td>
      <td>${escHtml(o.phone)}</td>
      <td>${escHtml(o.city)}</td>
      <td>${itemsCount} item${itemsCount !== 1 ? 's' : ''}</td>
      <td>JOD ${Number(o.total).toFixed(2)}</td>
      <td>${dateStr}</td>
      <td><span class="badge badge-${escHtml(o.status)}">${escHtml(o.status)}</span></td>
    </tr>
  `;
}

function bindOrderFilters() {
  let debounce;
  document.getElementById('search-orders').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => fetchAndRenderOrders(true), 350);
  });
  ['filter-status','filter-city','filter-date-from','filter-date-to'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => fetchAndRenderOrders(true));
  });
  document.getElementById('load-more-btn').addEventListener('click', () => {
    if (!allOrdersLoaded) fetchAndRenderOrders(false);
  });
}

/* ─── Order detail modal ────────────────────────────────────── */
async function openOrderDetail(id) {
  const overlay = document.getElementById('order-modal');
  overlay.classList.add('open');
  const body = document.getElementById('order-detail-body');
  body.innerHTML = '<p style="text-align:center;opacity:0.5;padding:24px">Loading…</p>';

  try {
    const o = await adminAction('getOrderById', { id });
    const mapsLink = o.coordinates
      ? `<a class="maps-link" href="https://maps.google.com/?q=${o.coordinates.lat},${o.coordinates.lon}" target="_blank" rel="noopener">View on Google Maps ↗</a>`
      : '—';

    const itemsList = (o.items || []).map(i => {
      const baseLineTotal = i.price * i.qty;
      const extrasBlock = (i.extras && i.extras.length)
        ? i.extras.map(ex =>
            `<div style="font-size:0.78rem;color:#5C3D1E;opacity:0.75;padding-left:12px">
               • ${escHtml(ex.name)} ${ex.price > 0 ? '(+JOD ' + Number(ex.price).toFixed(2) + ')' : '(Free)'}
             </div>`).join('')
          + (i.extrasTotal
              ? `<div style="font-size:0.78rem;color:#D4622A;font-weight:600;padding-left:12px">Extras: +JOD ${Number(i.extrasTotal).toFixed(2)}</div>`
              : '')
        : '';
      const lineTotal = (i.price + (i.extras || []).reduce((s,ex)=>s+(ex.price||0),0)) * i.qty;
      return `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:0.82rem">
          <span>${escHtml(i.name)} × ${i.qty}</span>
          <span>JOD ${lineTotal.toFixed(2)}</span>
        </div>${extrasBlock}</div>`;
    }).join('');

    const baseSubtotal   = (o.items || []).reduce((s,i)=>s+i.price*i.qty, 0);
    const extrasSubtotal = (o.items || []).reduce((s,i)=>s+(i.extrasTotal||0), 0);

    body.innerHTML = `
      <div class="order-detail-row"><span class="order-detail-label">Order ID</span><span style="font-size:0.8rem">${escHtml(o.id)}</span></div>
      <div class="order-detail-row"><span class="order-detail-label">Customer</span><span>${escHtml(o.customerName)}</span></div>
      <div class="order-detail-row"><span class="order-detail-label">Phone</span><span>${escHtml(o.phone)}</span></div>
      <div class="order-detail-row"><span class="order-detail-label">City</span><span>${escHtml(o.city)}</span></div>
      <div class="order-detail-row"><span class="order-detail-label">Address</span><span>${escHtml(o.address)}</span></div>
      <div class="order-detail-row"><span class="order-detail-label">Location</span><span>${mapsLink}</span></div>
      <div class="order-detail-row"><span class="order-detail-label">Delivery Date</span><span>${escHtml(o.deliveryDate)}</span></div>
      <div class="order-detail-row"><span class="order-detail-label">Notes</span><span>${escHtml(o.notes || '—')}</span></div>
      <hr style="margin:12px 0;border:none;border-top:1px solid rgba(61,32,16,0.08)">
      ${itemsList}
      <div style="font-size:0.82rem;margin-top:8px;display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;justify-content:space-between;opacity:0.7"><span>Items subtotal</span><span>JOD ${baseSubtotal.toFixed(2)}</span></div>
        ${extrasSubtotal > 0 ? `<div style="display:flex;justify-content:space-between;opacity:0.7"><span>Extras subtotal</span><span>+JOD ${extrasSubtotal.toFixed(2)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;opacity:0.7"><span>Delivery fee</span><span>JOD ${Number(o.deliveryFee||0).toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;font-weight:700;font-size:0.9rem;border-top:1px solid rgba(61,32,16,0.08);padding-top:6px;margin-top:2px">
          <span>Total</span><span>JOD ${Number(o.total).toFixed(2)}</span>
        </div>
      </div>
      <hr style="margin:12px 0;border:none;border-top:1px solid rgba(61,32,16,0.08)">
      <div class="order-detail-row">
        <span class="order-detail-label">Status</span>
        <select class="status-select-inline" id="status-select" data-id="${escHtml(o.id)}">
          <option value="pending"   ${o.status==='pending'   ?'selected':''}>Pending</option>
          <option value="confirmed" ${o.status==='confirmed' ?'selected':''}>Confirmed</option>
          <option value="delivered" ${o.status==='delivered' ?'selected':''}>Delivered</option>
          <option value="cancelled" ${o.status==='cancelled' ?'selected':''}>Cancelled</option>
        </select>
      </div>
      <button class="btn-save" id="btn-update-status" style="margin-top:12px;width:100%">Update Status</button>
      <div style="margin-top:10px;font-size:0.72rem;opacity:0.4">
        Created: ${o.createdAt ? new Date(o.createdAt).toLocaleString('en-GB') : '—'}
      </div>
    `;

    document.getElementById('btn-update-status').addEventListener('click', async () => {
      const sel = document.getElementById('status-select');
      const btn = document.getElementById('btn-update-status');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        await adminAction('updateOrderStatus', { id, status: sel.value });
        showToast('Status updated', 'success');
        closeModal('order-modal');
        fetchAndRenderOrders(true);
        updateStats();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
      btn.disabled = false; btn.textContent = 'Update Status';
    });
  } catch (err) {
    body.innerHTML = `<p style="color:#C62828;padding:16px">Failed to load order: ${escHtml(err.message)}</p>`;
  }
}

document.getElementById('order-modal-close').addEventListener('click', () => closeModal('order-modal'));
document.getElementById('order-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('order-modal')) closeModal('order-modal');
});

/* ─── Real-time new orders (onSnapshot) ────────────────────── */
function startRealtimeOrders() {
  const lastSeen = parseInt(localStorage.getItem(LAST_SEEN_KEY) || '0');
  ordersUnsubscribe = db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .onSnapshot(snap => {
      if (snap.empty) return;
      const doc = snap.docs[0];
      const ts  = doc.data().createdAt?.toDate?.()?.getTime() || 0;
      if (ts > lastSeen) updateUnreadBadge();
    });
}

function updateUnreadBadge() {
  const lastSeen = parseInt(localStorage.getItem(LAST_SEEN_KEY) || '0');
  db.collection('orders')
    .where('createdAt', '>', new Date(lastSeen))
    .get()
    .then(snap => {
      const count = snap.size;
      const badge = document.getElementById('orders-unread-badge');
      badge.textContent = count;
      badge.classList.toggle('visible', count > 0);
      badge.classList.toggle('pulse', count > 0);
    })
    .catch(() => {});
}

function markOrdersSeen() {
  localStorage.setItem(LAST_SEEN_KEY, Date.now().toString());
  const badge = document.getElementById('orders-unread-badge');
  badge.classList.remove('visible', 'pulse');
  badge.textContent = '0';
}

/* ─── Stats ─────────────────────────────────────────────────── */
async function updateStats() {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const snap  = await db.collection('orders').orderBy('createdAt','desc').limit(200).get();
    let todayCount = 0, pendingCount = 0, todayRev = 0, allRev = 0;
    snap.docs.forEach(d => {
      const data = d.data();
      allRev += data.total || 0;
      const ts = data.createdAt?.toDate?.();
      if (ts && ts >= today) { todayCount++; todayRev += data.total || 0; }
      if (data.status === 'pending') pendingCount++;
    });
    document.getElementById('stat-today').textContent         = todayCount;
    document.getElementById('stat-pending').textContent       = pendingCount;
    document.getElementById('stat-revenue-today').textContent = 'JOD ' + todayRev.toFixed(2);
    document.getElementById('stat-revenue-all').textContent   = 'JOD ' + allRev.toFixed(2);
    if (pendingCount > 0) document.getElementById('stat-pending-sub').textContent = '⚠️ needs attention';
  } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════════
   PRODUCTS TAB
   ═══════════════════════════════════════════════════════════════ */
async function loadProductsTab() {
  try {
    const { products } = await adminAction('getAdminProducts', {});
    renderAdminProducts(products);
  } catch (err) {
    document.getElementById('admin-product-grid').innerHTML =
      `<p style="color:#C62828;grid-column:1/-1">Failed to load products: ${escHtml(err.message)}</p>`;
  }
}

function renderAdminProducts(products) {
  const grid = document.getElementById('admin-product-grid');
  if (!products.length) {
    grid.innerHTML = '<p style="grid-column:1/-1;opacity:0.5;text-align:center;padding:32px">No products yet. Add your first product!</p>';
    return;
  }
  grid.innerHTML = products.map(p => `
    <div class="admin-product-card" data-id="${escHtml(p.id)}">
      <img class="apc-img" src="${escHtml(p.imageUrl)}" alt="${escHtml(p.name)}" loading="lazy" width="400" height="300">
      <div class="apc-body">
        <div class="apc-cat">${escHtml(p.category)}</div>
        <div class="apc-name">${escHtml(p.name)}</div>
        <div class="apc-price">JOD ${Number(p.price).toFixed(2)}</div>
      </div>
      <div class="apc-actions">
        <label class="apc-toggle">
          <label class="toggle-switch">
            <input type="checkbox" class="toggle-available" data-id="${escHtml(p.id)}" ${p.available ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <span>${p.available ? 'Available' : 'Hidden'}</span>
        </label>
        <button class="apc-btn apc-btn-edit" data-id="${escHtml(p.id)}">Edit</button>
        <button class="apc-btn apc-btn-delete" data-id="${escHtml(p.id)}" data-name="${escHtml(p.name)}">Delete</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.toggle-available').forEach(toggle => {
    toggle.addEventListener('change', async () => {
      try {
        await adminAction('editProduct', { id: toggle.dataset.id, available: toggle.checked });
        const label = toggle.closest('.apc-toggle').querySelector('span');
        if (label) label.textContent = toggle.checked ? 'Available' : 'Hidden';
        showToast(toggle.checked ? 'Product shown' : 'Product hidden', 'success');
      } catch (err) {
        toggle.checked = !toggle.checked;
        showToast('Error: ' + err.message, 'error');
      }
    });
  });

  grid.querySelectorAll('.apc-btn-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.admin-product-card');
      const id   = btn.dataset.id;
      const snap = await db.collection('products').doc(id).get();
      if (snap.exists) openProductModal(snap.data(), id);
    });
  });

  grid.querySelectorAll('.apc-btn-delete').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteProduct(btn.dataset.id, btn.dataset.name));
  });
}

/* ─── Add product button ────────────────────────────────────── */
document.getElementById('btn-add-product').addEventListener('click', () => openProductModal(null, null));

/* ─── Product Modal ─────────────────────────────────────────── */
function openProductModal(product, id) {
  document.getElementById('product-modal-title').textContent = id ? 'Edit Product' : 'Add Product';
  document.getElementById('edit-product-id').value   = id || '';
  document.getElementById('p-name').value            = product?.name        || '';
  document.getElementById('p-category').value        = product?.category    || '';
  document.getElementById('p-desc').value            = product?.description || '';
  document.getElementById('p-price').value           = product?.price       || '';
  document.getElementById('p-available').checked     = product?.available !== false;
  const preview = document.getElementById('p-image-preview');
  if (product?.imageUrl) { preview.src = product.imageUrl; preview.classList.add('visible'); }
  else { preview.src = ''; preview.classList.remove('visible'); }
  document.getElementById('product-modal').classList.add('open');
}

document.getElementById('product-modal-close').addEventListener('click', () => closeModal('product-modal'));
document.getElementById('product-cancel-btn').addEventListener('click', () => closeModal('product-modal'));
document.getElementById('product-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('product-modal')) closeModal('product-modal');
});

// Image preview
document.getElementById('p-image').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB', 'error'); e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const preview = document.getElementById('p-image-preview');
    preview.src = ev.target.result; preview.classList.add('visible');
  };
  reader.readAsDataURL(file);
});

// Save product
document.getElementById('product-form').addEventListener('submit', async e => {
  e.preventDefault();
  const saveBtn = document.getElementById('product-save-btn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Saving…';

  const id          = document.getElementById('edit-product-id').value;
  const name        = document.getElementById('p-name').value.trim();
  const category    = document.getElementById('p-category').value;
  const description = document.getElementById('p-desc').value.trim();
  const price       = parseFloat(document.getElementById('p-price').value);
  const available   = document.getElementById('p-available').checked;
  const imageFile   = document.getElementById('p-image').files[0];

  if (!name || !category || !description || isNaN(price)) {
    showToast('Please fill all required fields', 'error');
    saveBtn.disabled = false; saveBtn.textContent = 'Save Product';
    return;
  }

  let imageUrl = document.getElementById('p-image-preview').src || '';

  if (imageFile) {
    try {
      imageUrl = await uploadProductImage(imageFile);
    } catch (err) {
      showToast('Image upload failed: ' + err.message, 'error');
      saveBtn.disabled = false; saveBtn.textContent = 'Save Product';
      return;
    }
  }

  try {
    const payload = { name, category, description, price, imageUrl, available };
    if (id) {
      await adminAction('editProduct', { id, ...payload });
      showToast('Product updated', 'success');
    } else {
      await adminAction('addProduct', payload);
      showToast('Product added', 'success');
    }
    closeModal('product-modal');
    loadProductsTab();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
  saveBtn.disabled = false; saveBtn.textContent = 'Save Product';
});

async function uploadProductImage(file) {
  const progressWrap = document.getElementById('upload-progress');
  const progressBar  = document.getElementById('upload-progress-bar');
  progressWrap.classList.add('visible'); progressBar.style.width = '0%';

  const filename  = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageRef = storage.ref('products/' + filename);
  const task = storageRef.put(file);

  return new Promise((resolve, reject) => {
    task.on('state_changed',
      snap => { progressBar.style.width = Math.round((snap.bytesTransferred / snap.totalBytes) * 100) + '%'; },
      err  => { progressWrap.classList.remove('visible'); reject(err); },
      async () => {
        progressWrap.classList.remove('visible');
        const url = await storageRef.getDownloadURL();
        resolve(url);
      }
    );
  });
}

async function confirmDeleteProduct(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  const card = document.querySelector(`.admin-product-card[data-id="${id}"]`);
  if (card) card.classList.add('fade-out');
  try {
    await adminAction('deleteProduct', { id });
    showToast('Product deleted', 'success');
    setTimeout(() => loadProductsTab(), 350);
  } catch (err) {
    if (card) card.classList.remove('fade-out');
    showToast('Error: ' + err.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS TAB
   ═══════════════════════════════════════════════════════════════ */
async function loadSettingsTab() {
  // Load delivery fees
  try {
    const snap = await db.collection('settings').doc('delivery_fees').get();
    const fees = snap.exists ? snap.data() : {};
    const tbody = document.getElementById('fees-tbody');
    tbody.innerHTML = CITIES.map(city => `
      <tr>
        <td style="padding:8px 0;font-weight:600">${city}</td>
        <td><input class="fee-input" type="number" min="0" max="100" step="0.01" data-city="${city}" value="${fees[city] ?? 2.50}"></td>
      </tr>
    `).join('');
  } catch (_) {}

  // Load store status
  try {
    const snap = await db.collection('settings').doc('store_info').get();
    if (snap.exists) {
      document.getElementById('toggle-store-open').checked = snap.data().isOpen !== false;
    }
  } catch (_) {}

  // Bind save buttons
  document.getElementById('btn-save-fees').addEventListener('click', saveDeliveryFees);
  document.getElementById('btn-save-store').addEventListener('click', saveStoreStatus);
}

async function saveDeliveryFees() {
  const btn  = document.getElementById('btn-save-fees');
  btn.disabled = true; btn.textContent = 'Saving…';
  const fees = {};
  document.querySelectorAll('.fee-input').forEach(input => {
    fees[input.dataset.city] = parseFloat(input.value);
  });
  try {
    await adminAction('updateDeliveryFee', { fees });
    showToast('Delivery fees saved', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
  btn.disabled = false; btn.textContent = 'Save Fees';
}

async function saveStoreStatus() {
  const btn = document.getElementById('btn-save-store');
  btn.disabled = true; btn.textContent = 'Saving…';
  const isOpen = document.getElementById('toggle-store-open').checked;
  try {
    await adminAction('saveStoreStatus', { isOpen });
    showToast('Store status saved', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
  btn.disabled = false; btn.textContent = 'Save Store Status';
}

/* ─── Helpers ───────────────────────────────────────────────── */
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ═══════════════════════════════════════════════════════════════
   PRODUCT MODAL — EXTRAS CONFIG
   ═══════════════════════════════════════════════════════════════ */

/* Extend openProductModal to populate extras fields */
const _origOpenProductModal = openProductModal;
function openProductModal(product, id) {
  _origOpenProductModal(product, id);

  // Populate extras config
  const hasExtras      = product?.hasExtras      || false;
  const extrasLabel    = product?.extrasLabel    || '';
  const extrasRequired = product?.extrasRequired || false;
  const extrasMultiple = product?.extrasMultiple || false;
  const extrasGroupId  = product?.extrasGroupId  || '';

  document.getElementById('p-has-extras').checked     = hasExtras;
  document.getElementById('p-extras-label').value     = extrasLabel;
  document.getElementById('p-extras-required').checked = extrasRequired;
  document.getElementById('p-extras-multiple').checked = extrasMultiple;
  document.getElementById('extras-config').style.display = hasExtras ? 'block' : 'none';

  if (extrasGroupId) {
    document.getElementById('extras-source-group').checked = true;
    document.getElementById('extras-own-panel').style.display   = 'none';
    document.getElementById('extras-group-panel').style.display = 'block';
  } else {
    document.getElementById('extras-source-own').checked = true;
    document.getElementById('extras-own-panel').style.display   = 'block';
    document.getElementById('extras-group-panel').style.display = 'none';
  }

  // Populate shared group dropdown
  _loadGroupsForSelect(extrasGroupId);

  // Load per-product extras if editing
  if (id && hasExtras && !extrasGroupId) {
    loadProductExtras(id);
  } else {
    document.getElementById('extras-items-list').innerHTML = '';
    document.getElementById('extras-count').textContent = 'Extras (0/25)';
    document.getElementById('add-extra-form').style.display = 'none';
  }
}

/* Toggle hasExtras section */
document.getElementById('p-has-extras').addEventListener('change', function () {
  document.getElementById('extras-config').style.display = this.checked ? 'block' : 'none';
});

/* Toggle own/group source */
document.getElementById('extras-source-own').addEventListener('change', function () {
  document.getElementById('extras-own-panel').style.display   = 'block';
  document.getElementById('extras-group-panel').style.display = 'none';
});
document.getElementById('extras-source-group').addEventListener('change', function () {
  document.getElementById('extras-own-panel').style.display   = 'none';
  document.getElementById('extras-group-panel').style.display = 'block';
  _loadGroupsForSelect(document.getElementById('p-extras-group-id').value);
});

/* Show/hide add-extra form */
document.getElementById('btn-add-extra').addEventListener('click', function () {
  const form = document.getElementById('add-extra-form');
  form.style.display = form.style.display === 'none' ? 'flex' : 'none';
  if (form.style.display === 'flex') document.getElementById('new-extra-name').focus();
});
document.getElementById('cancel-new-extra').addEventListener('click', function () {
  document.getElementById('add-extra-form').style.display = 'none';
});
document.getElementById('save-new-extra').addEventListener('click', saveNewExtra);

async function saveNewExtra() {
  const productId = document.getElementById('edit-product-id').value;
  if (!productId) { showToast('Save the product first before adding extras', 'error'); return; }

  const name      = document.getElementById('new-extra-name').value.trim();
  const price     = parseFloat(document.getElementById('new-extra-price').value) || 0;
  const available = document.getElementById('new-extra-avail').checked;
  const imgFile   = document.getElementById('new-extra-img').files[0];
  if (!name) { showToast('Extra name is required', 'error'); return; }

  const btn = document.getElementById('save-new-extra');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';

  let imageUrl = '';
  if (imgFile) {
    try {
      imageUrl = await _uploadExtraImage(imgFile, productId);
    } catch (err) {
      showToast('Image upload failed: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Save Extra'; return;
    }
  }

  try {
    await adminAction('addExtra', { type: 'product', parentId: productId, name, price, imageUrl, available });
    showToast('Extra added', 'success');
    document.getElementById('add-extra-form').style.display = 'none';
    document.getElementById('new-extra-name').value  = '';
    document.getElementById('new-extra-price').value = '0';
    document.getElementById('new-extra-img').value   = '';
    loadProductExtras(productId);
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
  btn.disabled = false; btn.textContent = 'Save Extra';
}

async function loadProductExtras(productId) {
  try {
    const { extras } = await adminAction('getExtras', { type: 'product', parentId: productId });
    renderExtrasList(extras, 'product', productId);
  } catch (err) {
    document.getElementById('extras-items-list').innerHTML =
      `<p style="font-size:0.82rem;color:#C62828">Failed: ${escHtml(err.message)}</p>`;
  }
}

function renderExtrasList(extras, type, parentId) {
  const list  = document.getElementById('extras-items-list');
  const count = document.getElementById('extras-count');
  const addBtn = document.getElementById('btn-add-extra');
  if (count) count.textContent = `Extras (${extras.length}/25)`;
  if (addBtn) addBtn.disabled = extras.length >= 25;

  if (!extras.length) {
    list.innerHTML = '<p style="font-size:0.82rem;opacity:0.5;padding:8px 0">No extras yet. Add one below.</p>';
    return;
  }
  list.innerHTML = extras.map((ex, idx) => `
    <div class="extra-item-row" data-id="${escHtml(ex.id)}" data-idx="${idx}" draggable="true">
      <span class="extra-drag-handle" title="Drag to reorder">⠿</span>
      <img class="extra-thumb" src="${escHtml(ex.imageUrl || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'36\' height=\'36\'%3E%3Crect width=\'36\' height=\'36\' rx=\'18\' fill=\'%23e8dece\'/%3E%3C/svg%3E')}" alt="">
      <div class="extra-info">
        <div class="extra-name">${escHtml(ex.name)}</div>
        <div class="extra-price">${ex.price === 0 ? 'Free' : 'JOD ' + Number(ex.price).toFixed(2)}</div>
      </div>
      <div class="extra-item-actions">
        <label class="toggle-switch extra-avail-toggle" title="Available">
          <input type="checkbox" class="extra-avail-chk" data-id="${escHtml(ex.id)}" ${ex.available ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="btn-delete-extra" data-id="${escHtml(ex.id)}" data-name="${escHtml(ex.name)}" title="Delete">×</button>
      </div>
    </div>
  `).join('');

  // Bind availability toggles
  list.querySelectorAll('.extra-avail-chk').forEach(chk => {
    chk.addEventListener('change', async () => {
      try {
        await adminAction('editExtra', { type, parentId, id: chk.dataset.id, available: chk.checked });
        showToast(chk.checked ? 'Extra shown' : 'Extra hidden', 'success');
      } catch (err) {
        chk.checked = !chk.checked;
        showToast('Error: ' + err.message, 'error');
      }
    });
  });

  // Bind delete buttons
  list.querySelectorAll('.btn-delete-extra').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete "${btn.dataset.name}"?`)) return;
      try {
        await adminAction('deleteExtra', { type, parentId, id: btn.dataset.id });
        showToast('Extra deleted', 'success');
        if (type === 'product') loadProductExtras(parentId);
        else loadGroupExtras(parentId);
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });
  });

  // Drag-to-reorder
  _bindExtrasDrag(list, type, parentId);
}

function _bindExtrasDrag(list, type, parentId) {
  let dragSrc = null;
  list.querySelectorAll('.extra-item-row').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragSrc = row;
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', async e => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (dragSrc === row) return;
      const rows  = [...list.querySelectorAll('.extra-item-row')];
      const from  = rows.indexOf(dragSrc);
      const to    = rows.indexOf(row);
      if (from < 0 || to < 0) return;
      // Reorder in DOM
      if (from < to) list.insertBefore(dragSrc, row.nextSibling);
      else           list.insertBefore(dragSrc, row);
      // Persist new order
      const ids = [...list.querySelectorAll('.extra-item-row')].map(r => r.dataset.id);
      try {
        await adminAction('reorderExtras', { type, parentId, ids });
      } catch (err) {
        showToast('Reorder failed: ' + err.message, 'error');
      }
    });
    row.addEventListener('dragend', () => {
      list.querySelectorAll('.extra-item-row').forEach(r => r.classList.remove('drag-over'));
    });
  });
}

async function _loadGroupsForSelect(selectedId) {
  const sel = document.getElementById('p-extras-group-id');
  if (!sel) return;
  try {
    const { groups } = await adminAction('getExtraGroups', {});
    sel.innerHTML = '<option value="">— Select a group —</option>' +
      groups.map(g => `<option value="${escHtml(g.id)}" ${g.id === selectedId ? 'selected' : ''}>${escHtml(g.name)}</option>`).join('');
  } catch (_) {}
}

async function _uploadExtraImage(file, parentId) {
  const filename   = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageRef = storage.ref('extras/' + parentId + '/' + filename);
  const task       = storageRef.put(file);
  return new Promise((resolve, reject) => {
    task.on('state_changed', null,
      err => reject(err),
      async () => { resolve(await storageRef.getDownloadURL()); }
    );
  });
}

/* Extend product form save to include extras config */
const _origProductForm = document.getElementById('product-form').onsubmit;
document.getElementById('product-form').addEventListener('submit', () => {
  // The original submit handler runs; we just need to patch the payload.
  // Patching happens via the adminAction call inside the original handler.
  // We override by monkey-patching adminAction for addProduct/editProduct once.
});

// Patch product save payload before it hits adminAction
const _origAdminAction = adminAction;
async function adminAction(action, payload = {}) {
  if (action === 'addProduct' || action === 'editProduct') {
    payload.hasExtras      = document.getElementById('p-has-extras')?.checked  || false;
    payload.extrasLabel    = document.getElementById('p-extras-label')?.value.trim()  || '';
    payload.extrasRequired = document.getElementById('p-extras-required')?.checked || false;
    payload.extrasMultiple = document.getElementById('p-extras-multiple')?.checked || false;
    const sourceOwn        = document.getElementById('extras-source-own')?.checked;
    payload.extrasGroupId  = (sourceOwn || !payload.hasExtras)
      ? null
      : (document.getElementById('p-extras-group-id')?.value || null);
  }
  return _origAdminAction(action, payload);
}

/* ═══════════════════════════════════════════════════════════════
   EXTRAS GROUPS TAB
   ═══════════════════════════════════════════════════════════════ */
async function loadExtrasGroupsTab() {
  try {
    const { groups } = await adminAction('getExtraGroups', {});
    renderExtrasGroups(groups);
  } catch (err) {
    document.getElementById('extras-groups-list').innerHTML =
      `<p style="color:#C62828;padding:16px">Failed: ${escHtml(err.message)}</p>`;
  }
}

function renderExtrasGroups(groups) {
  const list = document.getElementById('extras-groups-list');
  if (!groups.length) {
    list.innerHTML = '<p style="opacity:0.5;text-align:center;padding:32px">No groups yet. Create your first!</p>';
    return;
  }
  list.innerHTML = groups.map(g => `
    <div class="extra-group-card" data-gid="${escHtml(g.id)}">
      <div class="extra-group-row">
        <span class="extra-group-name">${escHtml(g.name)}</span>
        <div class="extra-group-actions">
          <button class="apc-btn apc-btn-edit" data-gid="${escHtml(g.id)}" data-gname="${escHtml(g.name)}">Rename</button>
          <button class="apc-btn apc-btn-delete" data-gid="${escHtml(g.id)}" data-gname="${escHtml(g.name)}">Delete</button>
        </div>
        <span class="extra-group-chevron">▼</span>
      </div>
      <div class="extra-group-body">
        <div style="padding-top:12px">
          <div class="extras-panel-header">
            <span class="extras-panel-count" id="gc-${escHtml(g.id)}-count">Extras (0/25)</span>
            <button type="button" class="btn-add-extra" id="gc-${escHtml(g.id)}-addbtn">+ Add Extra</button>
          </div>
          <div class="extras-items-list" id="gc-${escHtml(g.id)}-list"></div>
          <div class="add-extra-form" id="gc-${escHtml(g.id)}-form" style="display:none">
            <input type="text" class="gc-new-name" placeholder="Extra name" maxlength="80">
            <input type="number" class="gc-new-price" placeholder="Price (0=free)" min="0" max="100" step="0.01" value="0">
            <input type="file" class="gc-new-img" accept="image/*">
            <div class="extras-toggle-row">
              <label class="toggle-switch" style="margin:0">
                <input type="checkbox" class="gc-new-avail" checked>
                <span class="toggle-slider"></span>
              </label>
              <span>Available</span>
            </div>
            <div class="add-extra-form-actions">
              <button type="button" class="btn-save gc-save-btn">Save Extra</button>
              <button type="button" class="btn-cancel gc-cancel-btn">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.extra-group-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const card  = row.closest('.extra-group-card');
      const gid   = card.dataset.gid;
      const isOpen = card.classList.toggle('open');
      if (isOpen) loadGroupExtras(gid);
    });
  });

  list.querySelectorAll('.apc-btn-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newName = prompt('New group name:', btn.dataset.gname);
      if (!newName || !newName.trim()) return;
      try {
        await adminAction('editExtraGroup', { id: btn.dataset.gid, name: newName.trim() });
        showToast('Group renamed', 'success');
        loadExtrasGroupsTab();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  });

  list.querySelectorAll('.apc-btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete group "${btn.dataset.gname}" and all its extras?`)) return;
      try {
        await adminAction('deleteExtraGroup', { id: btn.dataset.gid });
        showToast('Group deleted', 'success');
        loadExtrasGroupsTab();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  });

  list.querySelectorAll('.extra-group-card').forEach(card => {
    const gid  = card.dataset.gid;
    const addBtn = card.querySelector(`#gc-${gid}-addbtn`);
    const form   = card.querySelector(`#gc-${gid}-form`);
    if (addBtn && form) {
      addBtn.addEventListener('click', () => {
        form.style.display = form.style.display === 'none' ? 'flex' : 'none';
      });
      card.querySelector('.gc-cancel-btn')?.addEventListener('click', () => { form.style.display = 'none'; });
      card.querySelector('.gc-save-btn')?.addEventListener('click', () => saveGroupExtra(gid, card));
    }
  });
}

async function loadGroupExtras(groupId) {
  const listEl  = document.getElementById(`gc-${groupId}-list`);
  const countEl = document.getElementById(`gc-${groupId}-count`);
  const addBtn  = document.getElementById(`gc-${groupId}-addbtn`);
  if (!listEl) return;
  listEl.innerHTML = '<p style="font-size:0.82rem;opacity:0.5;padding:8px 0">Loading…</p>';
  try {
    const { extras } = await adminAction('getExtras', { type: 'group', parentId: groupId });
    if (countEl) countEl.textContent = `Extras (${extras.length}/25)`;
    if (addBtn)  addBtn.disabled = extras.length >= 25;
    renderGroupExtrasList(extras, groupId, listEl);
  } catch (err) {
    listEl.innerHTML = `<p style="font-size:0.82rem;color:#C62828">Failed: ${escHtml(err.message)}</p>`;
  }
}

function renderGroupExtrasList(extras, groupId, listEl) {
  if (!extras.length) {
    listEl.innerHTML = '<p style="font-size:0.82rem;opacity:0.5;padding:8px 0">No extras yet.</p>';
    return;
  }
  listEl.innerHTML = extras.map((ex, idx) => `
    <div class="extra-item-row" data-id="${escHtml(ex.id)}" data-idx="${idx}" draggable="true">
      <span class="extra-drag-handle">⠿</span>
      <img class="extra-thumb" src="${escHtml(ex.imageUrl || '')}" alt="" onerror="this.style.display='none'">
      <div class="extra-info">
        <div class="extra-name">${escHtml(ex.name)}</div>
        <div class="extra-price">${ex.price === 0 ? 'Free' : 'JOD ' + Number(ex.price).toFixed(2)}</div>
      </div>
      <div class="extra-item-actions">
        <label class="toggle-switch extra-avail-toggle">
          <input type="checkbox" class="extra-avail-chk" data-id="${escHtml(ex.id)}" ${ex.available ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="btn-delete-extra" data-id="${escHtml(ex.id)}" data-name="${escHtml(ex.name)}">×</button>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.extra-avail-chk').forEach(chk => {
    chk.addEventListener('change', async () => {
      try {
        await adminAction('editExtra', { type: 'group', parentId: groupId, id: chk.dataset.id, available: chk.checked });
        showToast(chk.checked ? 'Extra shown' : 'Extra hidden', 'success');
      } catch (err) { chk.checked = !chk.checked; showToast('Error: ' + err.message, 'error'); }
    });
  });
  listEl.querySelectorAll('.btn-delete-extra').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete "${btn.dataset.name}"?`)) return;
      try {
        await adminAction('deleteExtra', { type: 'group', parentId: groupId, id: btn.dataset.id });
        showToast('Extra deleted', 'success');
        loadGroupExtras(groupId);
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  });
  _bindExtrasDrag(listEl, 'group', groupId);
}

async function saveGroupExtra(groupId, card) {
  const nameEl  = card.querySelector('.gc-new-name');
  const priceEl = card.querySelector('.gc-new-price');
  const imgEl   = card.querySelector('.gc-new-img');
  const availEl = card.querySelector('.gc-new-avail');
  const saveBtn = card.querySelector('.gc-save-btn');
  const name    = nameEl?.value.trim();
  if (!name) { showToast('Extra name is required', 'error'); return; }
  const price    = parseFloat(priceEl?.value) || 0;
  const available = availEl?.checked !== false;
  const imgFile  = imgEl?.files[0];
  saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spinner spinner-dark"></span>';
  let imageUrl = '';
  if (imgFile) {
    try { imageUrl = await _uploadExtraImage(imgFile, 'group_' + groupId); }
    catch (err) { showToast('Image upload failed: ' + err.message, 'error'); saveBtn.disabled = false; saveBtn.textContent = 'Save Extra'; return; }
  }
  try {
    await adminAction('addExtra', { type: 'group', parentId: groupId, name, price, imageUrl, available });
    showToast('Extra added', 'success');
    if (nameEl)  nameEl.value  = '';
    if (priceEl) priceEl.value = '0';
    if (imgEl)   imgEl.value   = '';
    const form = card.querySelector(`#gc-${groupId}-form`);
    if (form) form.style.display = 'none';
    loadGroupExtras(groupId);
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
  saveBtn.disabled = false; saveBtn.textContent = 'Save Extra';
}

/* ─── New group form ────────────────────────────────────────── */
document.getElementById('btn-new-group').addEventListener('click', () => {
  const form = document.getElementById('new-group-form');
  form.classList.toggle('visible');
  if (form.classList.contains('visible')) document.getElementById('new-group-name').focus();
});
document.getElementById('cancel-new-group').addEventListener('click', () => {
  document.getElementById('new-group-form').classList.remove('visible');
});
document.getElementById('save-new-group').addEventListener('click', async () => {
  const name = document.getElementById('new-group-name').value.trim();
  if (!name) { showToast('Group name is required', 'error'); return; }
  const btn = document.getElementById('save-new-group');
  btn.disabled = true; btn.innerHTML = '<span class="spinner spinner-dark"></span>';
  try {
    await adminAction('addExtraGroup', { name });
    showToast('Group created', 'success');
    document.getElementById('new-group-name').value = '';
    document.getElementById('new-group-form').classList.remove('visible');
    loadExtrasGroupsTab();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Save';
});
