# BonVoy Website — Complete Project Summary
### For continuing in a new chat · Generated May 22, 2026

---

## 1. WHO IS THE CLIENT

**BonVoy** (`@bonvoy.jo`) is a Jordanian cake and dessert delivery brand based in **Alrabieh, Amman, Jordan**.

- Instagram: `@bonvoy.jo` → instagram.com/bonvoy.jo
- Sister brand / cake supplier: `@cakeh.jo`
- Followers: 132K on Instagram
- Operating hours: **11:00am – 5:00pm**
- Delivery zones: Amman (JOD 0.50), Salt, Zarqa, Jerash, Irbid, Madaba, Balqaa (all JOD 2.50)
- Products: Brownies, Cakes (custom + character), Cookies, Gift boxes
- Target market: Jordan-wide delivery, bilingual audience (Arabic speakers, English site)

---

## 2. WHAT WE ARE BUILDING

A **full production website** with two parts:

### Part A — Customer-Facing Website (`index.html`)
Single-page app with 3 sections:
- **Home** — Hero with space-themed animations (rocket, stars, planet)
- **Menu** — Product catalog with category filter tabs + add-to-cart
- **About** — Brand story, hours, Instagram link

### Part B — Admin Panel (`/admin/`)
Password-protected dashboard with 3 tabs:
- **Orders** — Real-time order list, status management, order detail modal
- **Products** — Add / edit / delete products with image upload
- **Settings** — Edit delivery fees per city, toggle store open/closed

---

## 3. DESIGN SYSTEM

### Colors (CSS custom properties)
```css
--color-primary:    #D4622A   /* orange — buttons, accents */
--color-primary-lt: #E8891A   /* hover states */
--color-bg:         #F5EFE0   /* cream — page background */
--color-dark:       #3D2010   /* headings */
--color-text:       #5C3D1E   /* body text */
--color-white:      #FFFFFF
--color-success:    #2E7D32
--color-error:      #C62828
--color-border:     rgba(61,32,16,0.15)
--shadow-card:      0 2px 16px rgba(61,32,16,0.10)
```

### Typography
- Font: **Poppins** (Google Fonts, weights 400 / 600 / 700)

### Theme
- **Space vibes**: floating rocket SVG, scattered star SVGs (✦ ✧ ★), planet SVG
- Animations: rocket floats (translateY -12px, 3s ease infinite), stars twinkle (opacity pulse, staggered)
- Space elements only in hero and about sections

### Component Tokens
```css
--radius-card:   16px
--radius-btn:    999px   /* pill buttons */
--radius-input:  12px
--transition:    0.2s cubic-bezier(0.4, 0, 0.2, 1)
```

### Reference sites the user pointed to
- **Cart animation + order form style**: https://weezyperfume.netlify.app/
  - Flying ghost image arc from product card to cart icon (getBoundingClientRect, cubic-bezier arc)
  - Cart badge bounce on add
- **Order form with smart location**: https://neo-website-chi.vercel.app/
  - GPS auto-detect current address
  - Toggle between GPS mode and manual entry

---

## 4. TECH STACK (FINAL DECISIONS)

| Layer | Technology | Reason |
|---|---|---|
| Frontend | Vanilla HTML / CSS / JS | No framework, like reference sites |
| Hosting | Netlify | CDN, functions, free tier, auto HTTPS |
| Functions | Netlify Functions (Node.js) | Rate limiting, validation, server-side writes |
| Database | Firebase Firestore | Auto-scales, real-time, free tier |
| Auth | Firebase Authentication | Email/password admin login |
| Storage | Firebase Storage | Product image uploads, CDN-served |
| Geocoding | OpenStreetMap Nominatim | Free, no API key needed |
| Font | Google Fonts (Poppins) | |

**Language: English only**

---

## 5. FILE STRUCTURE

```
bonvoy/
├── index.html                    ← customer site (SPA, 3 sections)
├── css/
│   ├── style.css                 ← customer styles
│   └── admin.css                 ← admin styles
├── js/
│   ├── firebase-config.js        ← Firebase init (compat CDN)
│   ├── main.js                   ← products, cart, animations, order form, GPS
│   └── admin.js                  ← auth guard, all admin operations
├── admin/
│   ├── login.html                ← admin login page
│   └── dashboard.html            ← admin dashboard (3 tabs)
├── netlify/
│   └── functions/
│       ├── submit-order.js       ← validate + save new order
│       ├── get-products.js       ← public product fetch (5-min CDN cache)
│       └── admin-action.js       ← all admin writes (requires auth JWT)
├── assets/
│   └── logo.svg                  ← BonVoy SVG wordmark (orange)
├── firestore.rules               ← Firestore security rules
├── firebase.json                 ← Firebase config (rules + storage)
├── netlify.toml                  ← headers, redirects, functions config
├── package.json                  ← firebase-admin ^12.0.0
└── README.md                     ← full setup guide
```

---

## 6. BACKEND ARCHITECTURE

### Core Rule — ZERO DIRECT CLIENT WRITES
The browser **never** writes directly to Firestore. All write operations go through Netlify Functions using the Firebase Admin SDK. The Admin SDK bypasses Firestore rules, so security lives entirely in the function code.

### Three Netlify Functions

#### `submit-order.js` — POST `/.netlify/functions/submit-order`
Security steps (abort with 4xx on failure):
1. Check honeypot field — if `_hp !== ""` return 200 silently (fool bots)
2. Rate limit — max 5 orders per 10 min per IP (sha256-hashed)
3. CORS check — only allowed origins
4. Validate all fields (see validation spec in Section 10)
5. Sanitize — strip HTML tags, trim strings
6. **Server-side fee recalculation** — fetch from Firestore, never trust client fee
7. Write to Firestore orders collection via Admin SDK
8. Return 201 `{ orderId, total }`

#### `get-products.js` — GET `/.netlify/functions/get-products?category=all`
- Read from Firestore products where `available == true`
- Optional category filter
- Response header: `Cache-Control: public, max-age=300` (5-min CDN cache)
- Rate limit: 120 req/min/IP

#### `admin-action.js` — POST `/.netlify/functions/admin-action`
- Header: `Authorization: Bearer <firebase-id-token>`
- Verify JWT server-side with Admin SDK
- Check token email is in `ADMIN_EMAILS` env var
- Actions: `addProduct`, `editProduct`, `deleteProduct`, `updateOrderStatus`, `updateDeliveryFee`, `getOrders`, `getOrderById`

### Environment Variables (set in Netlify dashboard, NEVER in code)
```
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY      ← service account key (include full PEM)
ADMIN_EMAILS              ← comma-separated admin emails
```

---

## 7. FIRESTORE DATA MODEL

### Collection: `products`
```
id (auto), name (str), category (str), description (str),
price (number), imageUrl (str), available (bool),
createdAt (timestamp), updatedAt (timestamp)
```
Index: `(available ASC, category ASC, createdAt DESC)`

### Collection: `orders`
```
id (auto), customerName (str), phone (str), city (str),
address (str), locationMode ("gps"|"manual"),
coordinates ({ lat, lon } | null), items (array of objects),
subtotal (number), deliveryFee (number), total (number),
deliveryDate (str), notes (str),
status ("pending"|"confirmed"|"delivered"|"cancelled"),
createdAt (timestamp), updatedAt (timestamp), ipHash (str)
```
Indexes: `(status ASC, createdAt DESC)` and `(createdAt DESC)`

### Collection: `settings`
Document: `delivery_fees`
```
Amman: 0.5, Salt: 2.5, Zarqa: 2.5, Jerash: 2.5,
Irbid: 2.5, Madaba: 2.5, Balqaa: 2.5
```
Document: `store_info`
```
name, instagram, phone, hours, address, isOpen (bool)
```

### Collection: `rate_limits`
```
{ ipHash } → { count (number), windowStart (timestamp) }
TTL: auto-delete after 1 hour
```

---

## 8. FIRESTORE SECURITY RULES

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /products/{id} {
      allow read: if resource.data.available == true;
      allow write: if false;
    }

    match /orders/{id} {
      // Authenticated admins can read (for onSnapshot real-time)
      allow read: if request.auth != null
                  && request.auth.token.email in ['YOUR_ADMIN_EMAIL'];
      allow write: if false; // function-only via Admin SDK
    }

    match /settings/{doc} {
      allow read: if true;
      allow write: if false;
    }

    match /rate_limits/{id} {
      allow read, write: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## 9. NETLIFY.TOML (complete)

```toml
[build]
  functions = "netlify/functions"
  publish = "."

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from = "/admin"
  to = "/admin/dashboard.html"
  status = 301

[[redirects]]
  from = "/admin/*"
  to = "/admin/:splat"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "geolocation=(self), camera=(), microphone=()"
    Strict-Transport-Security = "max-age=31536000; includeSubDomains"

[[headers]]
  for = "/admin/*"
  [headers.values]
    Cache-Control = "no-store, no-cache, must-revalidate"
    X-Robots-Tag = "noindex, nofollow"

[[headers]]
  for = "/*.js"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.css"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

---

## 10. INPUT VALIDATION SPEC

Applied both client-side (UX) and server-side (security):

| Field | Rule |
|---|---|
| name | `/^[\u0600-\u06FFa-zA-Z\s'\-]{2,80}$/` |
| phone | `/^(07[789]\d{7}|(\+9627[789]\d{7}))$/` |
| city | Must be one of: Amman, Salt, Zarqa, Jerash, Irbid, Madaba, Balqaa |
| address | String 5–300 chars after HTML strip |
| deliveryDate | Valid ISO date, min today, max today + 30 days |
| price | Number 0.01–999.99 |
| qty | Integer 1–99 |
| items array | Length 1–50 |
| notes | String 0–500 chars (optional) |

---

## 11. CUSTOMER SITE DETAILED SPEC

### Navbar
- Sticky, cream bg + box-shadow on scroll
- Logo (left) · Home | Menu | About links (smooth scroll) · Cart icon with badge
- Hamburger on mobile

### Hero Section
- Full-viewport-height (desktop), auto (mobile)
- Headline: "Cakes & Sweets, Delivered to Your Door 🚀"
- Subtext: "Same-day delivery · Amman & all Jordan"
- CTA: "Order Now" → smooth scroll to menu
- Floating rocket SVG (top right, animated), scattered stars (randomized JS positions), planet SVG (bottom left)

### Menu Section
- Category tabs: All | Brownies | Cakes | Cookies | Specials
- Client-side filtering (no re-fetch on tab change)
- Grid: 3 cols (≥1024px), 2 cols (≥640px), 1 col (mobile)
- Skeleton loaders (CSS pulse) while fetching
- Product card: image, category badge, name, description, price, "Add to Cart" button

### Add-to-Cart Animation (exact mechanic from weezyperfume.netlify.app)
1. `getBoundingClientRect()` on product image and cart icon
2. Create ghost `<img>` (60×60px, border-radius 50%), position fixed at image start
3. Append to `document.body`, trigger reflow
4. Apply CSS transition: `transform: translate(deltaX, deltaY) scale(0.1)` + `opacity: 0`
5. Timing: `transition: transform 0.65s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.65s ease`
6. On `transitionend`: remove ghost from DOM
7. Increment badge count + bounce animation

### Cart State
- Key: `bonvoy_cart` in localStorage
- Structure: `[{ id, name, price, imageUrl, qty }, ...]`
- Functions: `addToCart`, `removeFromCart`, `updateQty`, `clearCart`, `getCart`, `getCartTotal`
- Restored from localStorage on page load

### Cart Sidebar
- Slides in from right (`translateX(100%) → translateX(0)`, transition 0.3s)
- Lists items with image, name, qty +/-, price, remove button
- Summary: Subtotal | Delivery fee | Total
- CTA: "Proceed to Order" → opens Order Form Modal
- Empty state: rocket SVG + "Your cart is empty"

### Order Form Modal (from neo-website-chi.vercel.app style)

Fields in order:
1. Full Name
2. Phone Number (Jordanian format)
3. City (select dropdown, triggers delivery fee update)
4. **Delivery Address — dual-mode smart field:**

**Mode A — GPS (default):**
- Button: "📍 Detect My Location"
- On click: `navigator.geolocation.getCurrentPosition()` with options `{ enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }`
- On success: fetch Nominatim reverse geocode:
  ```
  GET https://nominatim.openstreetmap.org/reverse
    ?format=json&lat={lat}&lon={lon}&accept-language=en&zoom=18&addressdetails=1
  Headers: { 'User-Agent': 'BonVoy-Delivery/1.0' }
  ```
- Build address from: `road, house_number, neighbourhood, suburb`
- Auto-select city if matched in response (Arabic + English fuzzy match)
- City match map:
  - "Amman" / "عمان" → Amman
  - "Salt" / "السلط" → Salt
  - "Zarqa" / "الزرقاء" → Zarqa
  - "Jerash" / "جرش" → Jerash
  - "Irbid" / "اربد" → Irbid
  - "Madaba" / "مادبا" → Madaba
  - "Balqaa" / "البلقاء" → Balqaa
- Cache result: `window._detectedLocation = { lat, lon, address }`
- Show green-bordered confirmation box with detected address
- Link: "✏️ Enter a different address instead" → switch to Mode B
- On geolocation denied/error: auto-switch to Mode B with error message

**Mode B — Manual:**
- Textarea (4 rows), placeholder: "Street name, building, area…"
- Button: "📍 Use my current location instead" → switch back to Mode A
- Animated height transition between modes

5. Preferred Delivery Date (date picker, min=today, max=today+30 days)
6. Special Notes (textarea, optional)

**Honeypot field:**
```html
<input type="text" name="_hp" id="hp-field"
  style="position:absolute;left:-9999px;opacity:0;height:0;" autocomplete="off">
```
If value is not empty on submit: do nothing silently.

**Submit flow:**
1. Check honeypot
2. Validate all fields, show inline errors
3. Disable button + show spinner
4. POST to `/.netlify/functions/submit-order`
5. On 201 → Success screen (animated rocket + order ID + phone confirmation)
6. On 429 → "Too many orders, please wait"
7. On 400 → show field errors from response
8. On network error → "Connection issue, please try again"
9. On success: clear cart, close modal

---

## 12. ADMIN PANEL DETAILED SPEC

### Login Page (`admin/login.html`)
- Centered card, cream background, BonVoy logo
- Email + Password fields
- After 5 failed attempts: 30-second lockout with visible countdown
- On success: store token, redirect to dashboard

### Auth Guard (top of every admin page)
```javascript
firebase.auth().onAuthStateChanged(user => {
  if (!user) { window.location.href = '/admin/login.html'; return; }
  user.getIdToken().then(token => {
    window._adminToken = token;
    initDashboard();
  });
});
// Auto-refresh token every 55 minutes
setInterval(() => {
  firebase.auth().currentUser?.getIdToken(true)
    .then(t => { window._adminToken = t; });
}, 55 * 60 * 1000);
```

### All Admin API Calls
```javascript
fetch('/.netlify/functions/admin-action', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + window._adminToken
  },
  body: JSON.stringify({ action, payload })
})
```

### Dashboard Layout
- Top bar: logo + "Admin Panel" + admin email + Logout
- Sidebar (desktop) / bottom nav (mobile): Orders | Products | Settings

### Orders Tab
Stats cards: orders today, pending count (pulsing if > 0), today's revenue, all-time revenue

Filters: search by name/phone, filter by status, filter by city, date range

Table columns: # | Customer | Phone | City | Items | Total | Date | Status | Action

Status badges: pending (orange), confirmed (blue), delivered (green), cancelled (red)

Row click → detail modal with:
- All order fields
- Google Maps link if GPS: `https://maps.google.com/?q={lat},{lon}`
- Status change dropdown

Real-time: `onSnapshot` on orders collection for instant new order alerts

Unread badge: compare `createdAt` to last-seen timestamp in localStorage

Pagination: 20 orders per page, "Load more" button

### Products Tab
- Add / Edit / Delete via product modal
- Available toggle per card (immediate update)
- Product modal fields: Name, Category (select), Description, Price, Image upload (5MB max, preview), Available checkbox
- Image upload: Firebase Storage path `products/{timestamp}_{filename}`, get download URL
- Delete: confirm dialog → animate card out

### Settings Tab
- Delivery fees editable table → save via `admin-action updateDeliveryFee`
- `isOpen` toggle → shows/hides "We're open" banner on customer site

---

## 13. PERFORMANCE & SCALABILITY

| Concern | Solution |
|---|---|
| 1000+ concurrent users | Netlify CDN serves static files from 100+ global PoPs |
| Menu load spike | 5-min CDN cache on get-products function |
| Database overload | Firestore auto-scales, no connection limits |
| Order flood / DDoS | Rate limiting: 5 orders/10min/IP in function |
| Repeat visitors | 5-min localStorage cache for products |
| Admin real-time | Only admin uses onSnapshot — customers never hold persistent connections |
| Image delivery | Firebase Storage CDN URLs served globally |

Performance targets:
- FCP < 1.5s
- Products load < 500ms (cache) / < 1.5s (network)
- Cart interactions: instant (no network)
- Order submit feedback: < 200ms (spinner shown immediately)

Optimizations to implement:
- `<link rel="preconnect">` for Google Fonts and Firebase
- `loading="lazy"` + explicit width/height on all images
- `defer` on all script tags
- Single minified CSS file
- Skeleton loaders for product cards

---

## 14. SEED PRODUCTS (placeholder data)

| # | Name | Category | Price | Description |
|---|---|---|---|---|
| 1 | Nutella Brownie Box | Brownies | JOD 4.50 | Rich fudgy brownie loaded with Nutella, 6 pieces |
| 2 | Lotus Brownie | Brownies | JOD 5.00 | Biscoff-swirled brownie, crispy caramelized edges |
| 3 | Cookie Dough Brownie | Brownies | JOD 5.50 | Fudgy brownie topped with unbaked cookie dough |
| 4 | Birthday Cake | Cakes | JOD 18.00 | Custom 1kg cake, message of your choice included |
| 5 | Spiderman Cake | Cakes | JOD 22.00 | Character fondant cake, serves 8–10 people |
| 6 | Batman Cake | Cakes | JOD 22.00 | Yellow & black character cake, serves 8–10 people |
| 7 | Choc Chip Cookie | Cookies | JOD 2.50 | Soft & gooey American-style, pack of 4 |
| 8 | BonVoy Gift Box | Specials | JOD 12.00 | Assorted brownies & cookies in branded orange box |

Placeholder image URL pattern: `https://placehold.co/400x300/D4622A/FFFFFF?text={name}`

---

## 15. FIREBASE SETUP STEPS (for README)

1. console.firebase.google.com → New project "bonvoy"
2. Firestore → production mode, region: **europe-west1**
3. Authentication → Email/Password sign-in enabled
4. Storage → default bucket
5. Copy web app config → paste into `js/firebase-config.js`
6. Project Settings → Service Accounts → Generate new private key → save as JSON (never commit)
7. Deploy rules: `firebase deploy --only firestore:rules,storage`
8. Add first admin user: Authentication → Add user → email + strong password
9. Netlify env vars: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `ADMIN_EMAILS`
10. Connect GitHub repo to Netlify (or drag & drop folder)
11. Create Firestore composite indexes (see Section 7)
12. Run `seedProducts()` from browser console once when logged in as admin

---

## 16. SECURITY CHECKLIST

- [ ] Firebase config in `firebase-config.js` (API key safe in client — security is in rules)
- [ ] Service account key ONLY in Netlify env vars, never in repo
- [ ] `ADMIN_EMAILS` env var set with your email
- [ ] Firestore rules deployed — no public write possible
- [ ] Admin password: 20+ characters
- [ ] Test: POST directly to Firestore → should get permission-denied
- [ ] Test: Call admin-action without token → should get 401
- [ ] Test: Submit order with honeypot filled → order NOT created in Firestore
- [ ] Test: Submit order with fake city → should get 400 validation error
- [ ] Test: Submit order with fake delivery fee → server recalculates correctly
- [ ] `/admin/*` pages: Cache-Control: no-store and X-Robots-Tag: noindex

---

## 17. BUILD ORDER FOR CLAUDE CODE

Build in this exact sequence (do not skip or reorder):

1. `package.json` + `netlify.toml` + `firestore.rules` + `firebase.json`
2. `js/firebase-config.js` (placeholder values + comments)
3. `css/style.css` (full design system, all components)
4. `assets/logo.svg` (BonVoy wordmark in orange)
5. `index.html` (complete structure + all 3 sections)
6. `js/main.js` (products loading, cart logic, fly animation, order form, GPS location)
7. `netlify/functions/submit-order.js`
8. `netlify/functions/get-products.js`
9. `netlify/functions/admin-action.js`
10. `css/admin.css`
11. `admin/login.html`
12. `admin/dashboard.html` (all 3 tabs complete)
13. `js/admin.js` (auth guard + all admin operations)
14. `README.md` (complete setup guide)

**Every file must be fully implemented — no stubs, no TODOs left in code.**

---

## 18. WHAT STILL NEEDS TO HAPPEN (NEXT STEPS)

When you open the new chat, tell Claude Code:

> "I am building the BonVoy website. Here is the full project summary: [paste this file]. Please start building from Section 17 Build Order. Begin with step 1."

Things the user still needs to provide / decide:
- [ ] Real product photos (uploaded via admin panel after build)
- [ ] Firebase project credentials (created during setup)
- [ ] Admin email and password (set during Firebase setup)
- [ ] Whether they want email notifications when a new order arrives (not yet planned — could add via Netlify Function + SendGrid/Resend free tier)
- [ ] Whether they want a WhatsApp notification for new orders (could add wa.me API link in order success + admin notification)
- [ ] Custom domain (configured in Netlify dashboard after deploy)

---

*End of summary — BonVoy project, conversation May 22, 2026*
