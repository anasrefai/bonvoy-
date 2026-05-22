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
function bindTabs() {
  const allNavItems = document.querySelectorAll('.nav-item, .bottom-nav-item');
  allNavItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      allNavItems.forEach(i => i.classList.toggle('active', i.dataset.tab === tab));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));

      if (tab === 'orders') markOrdersSeen();
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

  const payload = { status: status || undefined, city: city || undefined, search: search || undefined, limit: 20 };
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

    const itemsList = (o.items || []).map(i =>
      `<div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:4px">
         <span>${escHtml(i.name)} × ${i.qty}</span>
         <span>JOD ${(i.price * i.qty).toFixed(2)}</span>
       </div>`
    ).join('');

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
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:0.9rem;margin-top:8px">
        <span>Total</span><span>JOD ${Number(o.total).toFixed(2)}</span>
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
    const snap = await db.collection('products').orderBy('createdAt','desc').get();
    const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
    await db.collection('settings').doc('store_info').set({ isOpen }, { merge: true });
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
