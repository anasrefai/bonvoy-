'use strict';

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function getAdmin() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

const VALID_CATEGORIES = ['all','Brownies','Cakes','Cookies','Specials'];
const rateLimitMap = new Map();
const RATE_MAX = 120;
const RATE_WINDOW = 60 * 1000; // 1 minute

function checkRateLimit(ip) {
  const now    = Date.now();
  const bucket = rateLimitMap.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= RATE_MAX) return false;
  bucket.count++;
  return true;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ip = (event.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  if (!checkRateLimit(ip)) {
    return { statusCode: 429, body: JSON.stringify({ error: 'Rate limit exceeded' }), headers: { 'Retry-After': '60' } };
  }

  const category = (event.queryStringParameters?.category || 'all').trim();
  if (!VALID_CATEGORIES.includes(category)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid category' }) };
  }

  try {
    const db = getAdmin();
    let query = db.collection('products').where('available', '==', true);
    if (category !== 'all') query = query.where('category', '==', category);
    query = query.orderBy('createdAt', 'desc');

    const snap     = await query.get();
    const products = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString() }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'public, max-age=300',
      },
      body: JSON.stringify({ products }),
    };
  } catch (err) {
    console.error('get-products error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to fetch products' }) };
  }
};
