'use strict';

const admin  = require('firebase-admin');
const crypto = require('crypto');

/* ─── Firebase Admin init (lazy singleton) ─────────────────── */
function getAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }
  return {
    db:         admin.firestore(),
    FieldValue: admin.firestore.FieldValue,
  };
}

/* ─── Constants ────────────────────────────────────────────── */
const ALLOWED_ORIGINS = new Set([
  'https://bonvoy-cookie.netlify.app',
  'http://localhost:8888',
  'http://localhost:3000',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean),
]);
const CITIES = ['Amman','Salt','Zarqa','Jerash','Irbid','Madaba','Balqaa'];
const NAME_RE  = /^[؀-ۿa-zA-Z\s'\-]{2,80}$/;
const PHONE_RE = /^(07[789]\d{7}|(\+9627[789]\d{7}))$/;

/* ─── Firestore-backed rate limit ──────────────────────────── */
const RATE_MAX    = 5;
const RATE_WINDOW = 10 * 60 * 1000; // 10 minutes in ms

async function checkRateLimit(db, ipHash) {
  const ref = db.collection('rateLimits').doc(ipHash);
  const now = Date.now();

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);

    if (!snap.exists || snap.data().resetAt.toMillis() <= now) {
      // New IP or expired window — reset counter
      txn.set(ref, { count: 1, resetAt: new Date(now + RATE_WINDOW) });
      return true;
    }

    const { count } = snap.data();
    if (count >= RATE_MAX) return false;

    txn.update(ref, { count: count + 1 });
    return true;
  });
}

/* ─── Helpers ──────────────────────────────────────────────── */
function stripHTML(str) { return String(str).replace(/<[^>]*>/g, '').trim(); }
function sha256(str)    { return crypto.createHash('sha256').update(str).digest('hex'); }

function respond(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

/* ─── Handler ──────────────────────────────────────────────── */
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  // CORS check
  const origin = event.headers['origin'] || '';
  if (!ALLOWED_ORIGINS.has(origin)) {
    if (origin && !origin.includes('localhost')) {
      return respond(403, { error: 'Forbidden' });
    }
  }
  const corsHeaders = origin ? { 'Access-Control-Allow-Origin': origin } : {};

  // IP extraction
  const ip = (event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown').split(',')[0].trim();
  const ipHash = sha256(ip);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return respond(400, { error: 'Invalid JSON' }, corsHeaders); }

  // 1. Honeypot
  if ((body._hp || '') !== '') return respond(200, { ok: true }, corsHeaders);

  // 2. Initialize Firestore (needed for rate limit and order write)
  let db, FieldValue;
  try { ({ db, FieldValue } = getAdmin()); }
  catch (err) {
    console.error('Firebase init error:', err);
    return respond(500, { error: 'Server configuration error' }, corsHeaders);
  }

  // 3. Rate limit (Firestore-backed, survives cold starts)
  try {
    const allowed = await checkRateLimit(db, ipHash);
    if (!allowed) {
      return respond(429, { error: 'Too many orders. Please wait before trying again.' }, {
        ...corsHeaders, 'Retry-After': '600',
      });
    }
  } catch (err) {
    // If rate limit check fails, log and allow through — don't block real orders
    console.error('Rate limit check error:', err);
  }

  // 4. Validate
  const errors = {};
  const name = stripHTML(String(body.name || ''));
  if (!NAME_RE.test(name)) errors.name = 'Name must be 2–80 characters, letters only';

  const phone = stripHTML(String(body.phone || ''));
  if (!PHONE_RE.test(phone)) errors.phone = 'Enter a valid Jordanian number';

  const city = String(body.city || '');
  if (!CITIES.includes(city)) errors.city = 'Invalid city';

  let address = stripHTML(String(body.address || ''));
  if (address.length < 5 || address.length > 300) errors.address = 'Address must be 5–300 characters';

  const deliveryDate = String(body.deliveryDate || '');
  const dateObj = new Date(deliveryDate);
  const today   = new Date(); today.setHours(0,0,0,0);
  const max30   = new Date(); max30.setDate(max30.getDate() + 30); max30.setHours(23,59,59,999);
  if (isNaN(dateObj.getTime()) || dateObj < today || dateObj > max30) {
    errors.date = 'Delivery date must be today or within 30 days';
  }

  const items = body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    errors.items = 'Cart must have 1–50 items';
  } else {
    outer: for (const item of items) {
      if (!item.id || typeof item.name !== 'string' ||
          !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99 ||
          typeof item.price !== 'number' || item.price < 0.01 || item.price > 999) {
        errors.items = 'Invalid item in cart'; break;
      }
      if (item.extras !== undefined) {
        if (!Array.isArray(item.extras) || item.extras.length > 25) {
          errors.items = 'Invalid extras'; break;
        }
        for (const ex of item.extras) {
          if (typeof ex.name !== 'string' || ex.name.length > 80 ||
              typeof ex.price !== 'number' || ex.price < 0 || ex.price > 100) {
            errors.items = 'Invalid extras data'; break outer;
          }
        }
      }
    }
  }

  const notes = stripHTML(String(body.notes || '')).substring(0, 500);

  const locationMode = body.locationMode === 'gps' ? 'gps' : 'manual';
  let coordinates = null;
  if (locationMode === 'gps' && body.coordinates) {
    const lat = parseFloat(body.coordinates.lat);
    const lon = parseFloat(body.coordinates.lon);
    if (isFinite(lat) && isFinite(lon)) coordinates = { lat, lon };
  }

  if (Object.keys(errors).length > 0) return respond(400, { errors }, corsHeaders);

  // 5. Server-side fee recalculation
  let deliveryFee = 2.50; // fallback
  try {
    const feeSnap = await db.collection('settings').doc('delivery_fees').get();
    if (feeSnap.exists && feeSnap.data()[city] !== undefined) {
      deliveryFee = parseFloat(feeSnap.data()[city]);
    }
  } catch (_) {}

  const subtotal = items.reduce((sum, i) => {
    const extrasPerUnit = (i.extras || []).reduce((s, ex) => s + (ex.price || 0), 0);
    return sum + (i.price + extrasPerUnit) * i.qty;
  }, 0);
  const extrasGrandTotal = items.reduce((sum, i) =>
    sum + (i.extras || []).reduce((s, ex) => s + (ex.price || 0), 0) * i.qty, 0);
  const total = parseFloat((subtotal + deliveryFee).toFixed(3));

  // 6. Write to Firestore
  const doc = await db.collection('orders').add({
    customerName:  name,
    phone,
    city,
    address,
    locationMode,
    coordinates,
    items: items.map(i => {
      const extras = (i.extras || []).map(ex => ({
        name:  stripHTML(String(ex.name)).substring(0, 80),
        price: parseFloat(Math.max(0, Math.min(100, ex.price || 0)).toFixed(3)),
      }));
      const extrasTotal = parseFloat((extras.reduce((s, ex) => s + ex.price, 0) * i.qty).toFixed(3));
      return {
        id:          String(i.id),
        name:        stripHTML(String(i.name)),
        qty:         i.qty,
        price:       i.price,
        extras,
        extrasTotal,
      };
    }),
    subtotal:         parseFloat(subtotal.toFixed(3)),
    extrasGrandTotal: parseFloat(extrasGrandTotal.toFixed(3)),
    deliveryFee,
    total,
    deliveryDate,
    notes,
    status:    'pending',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ipHash,
  });

  // Increment running all-time revenue counter (fire-and-forget)
  db.collection('stats').doc('revenue').set(
    { totalRevenue: FieldValue.increment(total) },
    { merge: true }
  ).catch(err => console.error('Stats increment error:', err));

  return respond(201, { orderId: doc.id, total, estimatedFee: deliveryFee }, corsHeaders);
};
