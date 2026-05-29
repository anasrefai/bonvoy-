'use strict';

const admin = require('firebase-admin');
const FieldValue = admin.firestore.FieldValue;

function initFirebase() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }
  return { db: admin.firestore(), auth: admin.auth() };
}

function respond(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function stripHTML(str) { return String(str).replace(/<[^>]*>/g, '').trim(); }

const CITIES = ['Amman','Salt','Zarqa','Jerash','Irbid','Madaba','Balqaa'];
const CATEGORIES = ['Brownies','Cakes','Cookies','Specials'];
const STATUSES   = ['pending','confirmed','delivered','cancelled'];

/* ─── Auth guard ────────────────────────────────────────────── */
async function verifyAdmin(event, authInstance) {
  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/, '');
  if (!token) throw { code: 401, message: 'No token provided' };

  let decoded;
  try { decoded = await authInstance.verifyIdToken(token); }
  catch (_) { throw { code: 401, message: 'Invalid or expired token' }; }

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
  if (!adminEmails.includes((decoded.email || '').toLowerCase())) {
    throw { code: 403, message: 'Access denied' };
  }
  return decoded;
}

/* ─── Action handlers ───────────────────────────────────────── */
async function addProduct(db, payload) {
  const { name, category, description, price, imageUrl, available,
          hasExtras, extrasLabel, extrasRequired, extrasMultiple, extrasGroupId } = payload;
  if (!name || !CATEGORIES.includes(category) || typeof price !== 'number') {
    throw { code: 400, message: 'Invalid product data' };
  }
  const doc = await db.collection('products').add({
    name:           stripHTML(String(name)).substring(0, 80),
    category,
    description:    stripHTML(String(description || '')).substring(0, 300),
    price:          parseFloat(Math.max(0.01, Math.min(999.99, price)).toFixed(3)),
    imageUrl:       String(imageUrl || ''),
    available:      available !== false,
    hasExtras:      hasExtras === true,
    extrasLabel:    stripHTML(String(extrasLabel || '')).substring(0, 80),
    extrasRequired: extrasRequired === true,
    extrasMultiple: extrasMultiple === true,
    extrasGroupId:  extrasGroupId ? String(extrasGroupId) : null,
    createdAt:      FieldValue.serverTimestamp(),
    updatedAt:      FieldValue.serverTimestamp(),
  });
  return { id: doc.id };
}

async function editProduct(db, payload) {
  const { id, ...updates } = payload;
  if (!id) throw { code: 400, message: 'Product ID required' };
  const allowed = {};
  if (updates.name           !== undefined) allowed.name           = stripHTML(String(updates.name)).substring(0, 80);
  if (updates.category       !== undefined && CATEGORIES.includes(updates.category)) allowed.category = updates.category;
  if (updates.description    !== undefined) allowed.description    = stripHTML(String(updates.description)).substring(0, 300);
  if (updates.price          !== undefined) allowed.price          = parseFloat(Math.max(0.01, Math.min(999.99, updates.price)).toFixed(3));
  if (updates.imageUrl       !== undefined) allowed.imageUrl       = String(updates.imageUrl);
  if (updates.available      !== undefined) allowed.available      = Boolean(updates.available);
  if (updates.hasExtras      !== undefined) allowed.hasExtras      = Boolean(updates.hasExtras);
  if (updates.extrasLabel    !== undefined) allowed.extrasLabel    = stripHTML(String(updates.extrasLabel)).substring(0, 80);
  if (updates.extrasRequired !== undefined) allowed.extrasRequired = Boolean(updates.extrasRequired);
  if (updates.extrasMultiple !== undefined) allowed.extrasMultiple = Boolean(updates.extrasMultiple);
  if (updates.extrasGroupId  !== undefined) allowed.extrasGroupId  = updates.extrasGroupId ? String(updates.extrasGroupId) : null;
  allowed.updatedAt = FieldValue.serverTimestamp();
  await db.collection('products').doc(id).update(allowed);
  return { id };
}

async function deleteProduct(db, payload) {
  const { id } = payload;
  if (!id) throw { code: 400, message: 'Product ID required' };
  await db.collection('products').doc(id).delete();
  return { id };
}

async function updateOrderStatus(db, payload) {
  const { id, status } = payload;
  if (!id || !STATUSES.includes(status)) throw { code: 400, message: 'Invalid order or status' };
  await db.collection('orders').doc(id).update({ status, updatedAt: FieldValue.serverTimestamp() });
  return { id, status };
}

async function saveStoreStatus(db, payload) {
  const { isOpen } = payload;
  if (typeof isOpen !== 'boolean') throw { code: 400, message: 'isOpen must be a boolean' };
  await db.collection('settings').doc('store_info').set(
    { isOpen, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  return { success: true, isOpen };
}

async function updateDeliveryFee(db, payload) {
  const { fees } = payload;
  if (!fees || typeof fees !== 'object') throw { code: 400, message: 'Invalid fees object' };
  const validated = {};
  for (const city of CITIES) {
    if (fees[city] !== undefined) {
      const f = parseFloat(fees[city]);
      if (!isFinite(f) || f < 0 || f > 100) throw { code: 400, message: `Invalid fee for ${city}` };
      validated[city] = f;
    }
  }
  await db.collection('settings').doc('delivery_fees').set(validated, { merge: true });
  return { updated: Object.keys(validated) };
}

async function getAdminProducts(db) {
  const snap = await db.collection('products').orderBy('createdAt', 'desc').get();
  const products = snap.docs.map(d => ({
    id: d.id,
    ...d.data(),
    createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
    updatedAt: d.data().updatedAt?.toDate?.()?.toISOString() || null,
  }));
  return { products };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function getOrders(db, payload) {
  const { status, city, search, limit: limitN = 20, startAfter, dateFrom, dateTo } = payload || {};

  // Validate date range inputs
  if (dateFrom && !DATE_RE.test(dateFrom)) throw { code: 400, message: 'Invalid date format' };
  if (dateTo   && !DATE_RE.test(dateTo))   throw { code: 400, message: 'Invalid date format' };
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw { code: 400, message: 'dateFrom must be before or equal to dateTo' };
  }

  let query = db.collection('orders').orderBy('createdAt', 'desc');
  if (status && STATUSES.includes(status)) query = query.where('status', '==', status);
  if (city   && CITIES.includes(city))     query = query.where('city', '==', city);

  // NOTE: Combining deliveryDate filter with status/city filter may
  // require a composite Firestore index. Deploy indexes if queries fail.
  if (dateFrom) query = query.where('deliveryDate', '>=', dateFrom);
  if (dateTo)   query = query.where('deliveryDate', '<=', dateTo);

  if (startAfter) {
    const cursor = await db.collection('orders').doc(startAfter).get();
    if (cursor.exists) query = query.startAfter(cursor);
  }
  query = query.limit(Math.min(Number(limitN) || 20, 50));
  const snap = await query.get();
  let orders = snap.docs.map(d => ({
    id: d.id, ...d.data(),
    createdAt: d.data().createdAt?.toDate?.()?.toISOString(),
    updatedAt: d.data().updatedAt?.toDate?.()?.toISOString(),
  }));
  if (search) {
    const q = search.toLowerCase();
    orders = orders.filter(o => o.customerName?.toLowerCase().includes(q) || o.phone?.includes(q));
  }
  return { orders, lastId: snap.docs[snap.docs.length - 1]?.id || null };
}

async function getOrderById(db, payload) {
  const { id } = payload;
  if (!id) throw { code: 400, message: 'Order ID required' };
  const snap = await db.collection('orders').doc(id).get();
  if (!snap.exists) throw { code: 404, message: 'Order not found' };
  return {
    id: snap.id, ...snap.data(),
    createdAt: snap.data().createdAt?.toDate?.()?.toISOString(),
    updatedAt: snap.data().updatedAt?.toDate?.()?.toISOString(),
  };
}

/* ─── Extras helpers ────────────────────────────────────────── */
function extrasCollRef(db, type, parentId) {
  if (!parentId) throw { code: 400, message: 'parentId required' };
  if (type === 'group') return db.collection('extraGroups').doc(parentId).collection('extras');
  return db.collection('products').doc(parentId).collection('extras');
}

async function getExtras(db, payload) {
  const { type = 'product', parentId } = payload;
  const ref = extrasCollRef(db, type, parentId);
  const snap = await ref.orderBy('order', 'asc').get();
  return { extras: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
}

async function addExtra(db, payload) {
  const { type = 'product', parentId, name, price, imageUrl, available, order: ord } = payload;
  if (!name) throw { code: 400, message: 'Extra name required' };
  const ref = extrasCollRef(db, type, parentId);
  // Auto-order: find max
  const snap = await ref.orderBy('order', 'desc').limit(1).get();
  const nextOrder = snap.empty ? 0 : (snap.docs[0].data().order || 0) + 1;
  if (nextOrder >= 25) throw { code: 400, message: 'Maximum 25 extras reached' };
  const doc = await ref.add({
    name:      stripHTML(String(name)).substring(0, 80),
    price:     parseFloat(Math.max(0, Math.min(100, parseFloat(price) || 0)).toFixed(3)),
    imageUrl:  String(imageUrl || ''),
    available: available !== false,
    order:     ord !== undefined ? ord : nextOrder,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: doc.id };
}

async function editExtra(db, payload) {
  const { type = 'product', parentId, id, ...updates } = payload;
  if (!id) throw { code: 400, message: 'Extra ID required' };
  const ref = extrasCollRef(db, type, parentId).doc(id);
  const allowed = {};
  if (updates.name      !== undefined) allowed.name      = stripHTML(String(updates.name)).substring(0, 80);
  if (updates.price     !== undefined) allowed.price     = parseFloat(Math.max(0, Math.min(100, parseFloat(updates.price) || 0)).toFixed(3));
  if (updates.imageUrl  !== undefined) allowed.imageUrl  = String(updates.imageUrl);
  if (updates.available !== undefined) allowed.available = Boolean(updates.available);
  if (updates.order     !== undefined) allowed.order     = parseInt(updates.order, 10);
  await ref.update(allowed);
  return { id };
}

async function deleteExtra(db, payload) {
  const { type = 'product', parentId, id } = payload;
  if (!id) throw { code: 400, message: 'Extra ID required' };
  await extrasCollRef(db, type, parentId).doc(id).delete();
  return { id };
}

async function reorderExtras(db, payload) {
  const { type = 'product', parentId, ids } = payload;
  if (!Array.isArray(ids)) throw { code: 400, message: 'ids array required' };
  const ref = extrasCollRef(db, type, parentId);
  const batch = db.batch();
  ids.forEach((id, i) => { batch.update(ref.doc(id), { order: i }); });
  await batch.commit();
  return { updated: ids.length };
}

async function getExtraGroups(db) {
  const snap = await db.collection('extraGroups').orderBy('createdAt', 'desc').get();
  return { groups: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
}

async function addExtraGroup(db, payload) {
  const { name } = payload;
  if (!name) throw { code: 400, message: 'Group name required' };
  const doc = await db.collection('extraGroups').add({
    name: stripHTML(String(name)).substring(0, 80),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: doc.id };
}

async function editExtraGroup(db, payload) {
  const { id, name } = payload;
  if (!id) throw { code: 400, message: 'Group ID required' };
  await db.collection('extraGroups').doc(id).update({
    name: stripHTML(String(name || '')).substring(0, 80),
  });
  return { id };
}

async function deleteExtraGroup(db, payload) {
  const { id } = payload;
  if (!id) throw { code: 400, message: 'Group ID required' };
  // Delete all extras in the group first
  const extrasSnap = await db.collection('extraGroups').doc(id).collection('extras').get();
  const batch = db.batch();
  extrasSnap.docs.forEach(d => batch.delete(d.ref));
  batch.delete(db.collection('extraGroups').doc(id));
  await batch.commit();
  return { id };
}

/* ─── Stats ─────────────────────────────────────────────────── */
async function getStats(db) {
  const statsRef = db.collection('stats').doc('revenue');
  const snap = await statsRef.get();

  if (snap.exists && snap.data().totalRevenue !== undefined) {
    return { totalRevenue: snap.data().totalRevenue };
  }

  // First call: paginate through ALL orders to build the initial counter
  let total = 0;
  let lastDoc = null;
  do {
    let q = db.collection('orders').orderBy('createdAt', 'asc').limit(500);
    if (lastDoc) q = q.startAfter(lastDoc);
    const batch = await q.get();
    if (batch.empty) break;
    batch.docs.forEach(d => { total += (d.data().total || 0); });
    lastDoc = batch.docs[batch.docs.length - 1];
    if (batch.size < 500) break;
  } while (true);

  total = parseFloat(total.toFixed(3));
  await statsRef.set({ totalRevenue: total, backfilledAt: FieldValue.serverTimestamp() });
  return { totalRevenue: total };
}

/* ─── Main handler ──────────────────────────────────────────── */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let db, auth;
  try {
    ({ db, auth } = initFirebase());
  } catch (err) {
    console.error('Firebase init error:', err);
    return respond(500, { error: 'Server configuration error' });
  }

  try {
    await verifyAdmin(event, auth);
  } catch (err) {
    return respond(err.code || 401, { error: err.message });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return respond(400, { error: 'Invalid JSON' }); }

  const { action, payload } = body;

  try {
    let result;
    switch (action) {
      case 'addProduct':        result = await addProduct(db, payload); break;
      case 'editProduct':       result = await editProduct(db, payload); break;
      case 'deleteProduct':     result = await deleteProduct(db, payload); break;
      case 'updateOrderStatus': result = await updateOrderStatus(db, payload); break;
      case 'saveStoreStatus':   result = await saveStoreStatus(db, payload); break;
      case 'updateDeliveryFee': result = await updateDeliveryFee(db, payload); break;
      case 'getAdminProducts':  result = await getAdminProducts(db); break;
      case 'getOrders':         result = await getOrders(db, payload); break;
      case 'getOrderById':      result = await getOrderById(db, payload); break;
      case 'getExtras':         result = await getExtras(db, payload); break;
      case 'addExtra':          result = await addExtra(db, payload); break;
      case 'editExtra':         result = await editExtra(db, payload); break;
      case 'deleteExtra':       result = await deleteExtra(db, payload); break;
      case 'reorderExtras':     result = await reorderExtras(db, payload); break;
      case 'getExtraGroups':    result = await getExtraGroups(db); break;
      case 'addExtraGroup':     result = await addExtraGroup(db, payload); break;
      case 'editExtraGroup':    result = await editExtraGroup(db, payload); break;
      case 'deleteExtraGroup':  result = await deleteExtraGroup(db, payload); break;
      case 'getStats':          result = await getStats(db); break;
      default: return respond(400, { error: 'Unknown action' });
    }
    return respond(200, { ok: true, data: result });
  } catch (err) {
    if (err.code) return respond(err.code, { error: err.message });
    console.error('admin-action error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};
