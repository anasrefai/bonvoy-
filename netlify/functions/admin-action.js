'use strict';

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue }     = require('firebase-admin/firestore');
const { getAuth }                      = require('firebase-admin/auth');

function initFirebase() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  return { db: getFirestore(), auth: getAuth() };
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
  const { name, category, description, price, imageUrl, available } = payload;
  if (!name || !CATEGORIES.includes(category) || typeof price !== 'number') {
    throw { code: 400, message: 'Invalid product data' };
  }
  const doc = await db.collection('products').add({
    name:        stripHTML(String(name)).substring(0, 80),
    category,
    description: stripHTML(String(description || '')).substring(0, 300),
    price:       parseFloat(Math.max(0.01, Math.min(999.99, price)).toFixed(3)),
    imageUrl:    String(imageUrl || ''),
    available:   available !== false,
    createdAt:   FieldValue.serverTimestamp(),
    updatedAt:   FieldValue.serverTimestamp(),
  });
  return { id: doc.id };
}

async function editProduct(db, payload) {
  const { id, ...updates } = payload;
  if (!id) throw { code: 400, message: 'Product ID required' };
  const allowed = {};
  if (updates.name        !== undefined) allowed.name        = stripHTML(String(updates.name)).substring(0, 80);
  if (updates.category    !== undefined && CATEGORIES.includes(updates.category)) allowed.category = updates.category;
  if (updates.description !== undefined) allowed.description = stripHTML(String(updates.description)).substring(0, 300);
  if (updates.price       !== undefined) allowed.price       = parseFloat(Math.max(0.01, Math.min(999.99, updates.price)).toFixed(3));
  if (updates.imageUrl    !== undefined) allowed.imageUrl    = String(updates.imageUrl);
  if (updates.available   !== undefined) allowed.available   = Boolean(updates.available);
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

async function getOrders(db, payload) {
  const { status, city, search, limit: limitN = 20, startAfter } = payload || {};
  let query = db.collection('orders').orderBy('createdAt', 'desc');
  if (status && STATUSES.includes(status)) query = query.where('status', '==', status);
  if (city   && CITIES.includes(city))     query = query.where('city', '==', city);
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

/* ─── Main handler ──────────────────────────────────────────── */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  const { db, auth } = initFirebase();

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
      case 'updateDeliveryFee': result = await updateDeliveryFee(db, payload); break;
      case 'getOrders':         result = await getOrders(db, payload); break;
      case 'getOrderById':      result = await getOrderById(db, payload); break;
      default: return respond(400, { error: 'Unknown action' });
    }
    return respond(200, { ok: true, data: result });
  } catch (err) {
    if (err.code) return respond(err.code, { error: err.message });
    console.error('admin-action error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};
