# BonVoy — Cake & Dessert Delivery Website

Production website for **BonVoy** (`@bonvoy.jo`), a Jordanian cake and dessert delivery brand based in Alrabieh, Amman.

**Stack:** Vanilla HTML/CSS/JS · Netlify (hosting + serverless functions) · Firebase (Firestore, Auth, Storage)

---

## SETUP GUIDE

### 1. FIREBASE SETUP

**a.** Go to [console.firebase.google.com](https://console.firebase.google.com) → Create new project → Name it **bonvoy**

**b.** Enable **Firestore Database**
- Click "Create database" → Select "production mode"
- Region: **europe-west1** (Belgium — closest to Jordan)

**c.** Enable **Authentication**
- Build → Authentication → Get started → Sign-in method → Email/Password → Enable

**d.** Enable **Storage**
- Build → Storage → Get started → Next → Done

**e.** Add your web app and copy config
- Project settings (gear icon) → General → Your apps → Add app (web `</>`)
- Register app as "bonvoy"
- Copy the `firebaseConfig` object
- Paste it into `js/firebase-config.js`, replacing the `REPLACE_WITH_YOUR_*` placeholders

**f.** Generate Admin SDK service account key
- Project settings → Service accounts → Generate new private key
- Save the downloaded JSON file **securely** (NEVER commit it to git)
- You'll need `project_id`, `client_email`, and `private_key` from this file

**g.** Deploy Firestore security rules
```bash
npm install -g firebase-tools
firebase login
firebase init  # select Firestore + Storage
firebase deploy --only firestore:rules,storage
```

Or paste the contents of `firestore.rules` into the Firebase console (Firestore → Rules).

---

### 2. ADD YOUR FIRST ADMIN USER

- Firebase console → Authentication → Users → Add user
- Enter your email + a strong password (20+ characters recommended)
- This email **must** match the `ADMIN_EMAILS` environment variable below

---

### 3. NETLIFY ENVIRONMENT VARIABLES

In **Netlify dashboard** → Site settings → Environment variables, add:

| Variable | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | Your Firebase project ID (e.g. `bonvoy-abc12`) |
| `FIREBASE_CLIENT_EMAIL` | `client_email` from service account JSON |
| `FIREBASE_PRIVATE_KEY` | `private_key` from service account JSON — include the full `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines. Replace literal `\n` with actual newlines if needed. |
| `ADMIN_EMAILS` | Your admin email: `admin@youremail.com` (comma-separated for multiple) |

> **Security note:** The service account private key gives full admin access to your Firebase project. Never put it in code or commit it to git.

---

### 4. DEPLOY TO NETLIFY

**Option A — GitHub (recommended):**
1. Push this folder to a GitHub repo
2. Netlify dashboard → Add new site → Import from Git
3. Select your repo → Deploy site

**Option B — Netlify CLI:**
```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

**Option C — Drag & drop:**
Drag the `bonvoy` folder directly onto Netlify's deploy area.

---

### 5. FIRESTORE COMPOSITE INDEXES

Create these indexes in Firebase console → Firestore → Indexes → Composite:

| Collection | Fields | Order |
|---|---|---|
| `orders`   | `status` ASC, `createdAt` DESC | |
| `orders`   | `createdAt` DESC | |
| `products` | `available` ASC, `category` ASC, `createdAt` DESC | |

Or deploy the included `firestore.indexes.json`:
```bash
firebase deploy --only firestore:indexes
```

---

### 6. SEED INITIAL PRODUCTS

After deploying:

1. Open your site in a browser and log in via `/admin/dashboard.html`
2. Open browser developer console (F12)
3. Run:
```javascript
seedProducts()
```

This creates 8 placeholder products with orange placeholder images. Once you have real product photos, upload them via the admin Products tab.

> **Note:** The `seedProducts()` function is commented out in `js/main.js`. Uncomment it first, run once, then comment it back or remove it.

---

### 7. INITIALIZE FIRESTORE SETTINGS DOCUMENTS

After seeding products, you need to create the settings documents. In the Firebase console → Firestore → Start collection:

**Collection: `settings`, Document: `delivery_fees`**
```
Amman:  0.5
Salt:   2.5
Zarqa:  2.5
Jerash: 2.5
Irbid:  2.5
Madaba: 2.5
Balqaa: 2.5
```

**Collection: `settings`, Document: `store_info`**
```
name:      BonVoy
instagram: bonvoy.jo
phone:     07X-XXX-XXXX
hours:     11:00am - 5:00pm
address:   Alrabieh, Amman, Jordan
isOpen:    true
```

Alternatively, these can be set via the admin panel Settings tab once deployed.

---

### 8. CUSTOM DOMAIN (optional)

- Netlify dashboard → Domain settings → Add custom domain
- Point your domain's DNS to Netlify's servers
- SSL is automatic (Let's Encrypt)

---

## SECURITY CHECKLIST

Before going live, verify:

- [ ] Firebase config pasted into `js/firebase-config.js` (API key safe in client — security is in Firestore rules)
- [ ] `ADMIN_EMAILS` env var set with your email in Netlify
- [ ] `FIREBASE_PRIVATE_KEY` stored only in Netlify env vars, **not in code or git**
- [ ] Firestore security rules deployed — no public write possible
- [ ] Admin password is 20+ characters
- [ ] Update `firestore.rules` — replace `'YOUR_ADMIN_EMAIL_HERE'` with your actual email
- [ ] **Test:** Try to POST directly to Firestore from browser console → should get `permission-denied`
- [ ] **Test:** Call `/.netlify/functions/admin-action` without a token → should get `401`
- [ ] **Test:** Submit order with honeypot field filled → should return 200 but NOT create an order in Firestore
- [ ] **Test:** Submit order with a fake city → should get `400 { errors: { city: '...' } }`
- [ ] **Test:** Submit order with client-modified delivery fee → server recalculates correctly (check order in Firestore)
- [ ] Admin pages return `Cache-Control: no-store` and `X-Robots-Tag: noindex`

---

## PROJECT STRUCTURE

```
bonvoy/
├── index.html                  Customer site (SPA, 3 sections)
├── css/
│   ├── style.css               Customer styles + design system
│   └── admin.css               Admin panel styles
├── js/
│   ├── firebase-config.js      Firebase init (paste your config here)
│   ├── main.js                 Products, cart, fly animation, order form, GPS
│   └── admin.js                Auth guard + all admin operations
├── admin/
│   ├── login.html              Admin login (5-attempt lockout)
│   └── dashboard.html          Admin dashboard (Orders / Products / Settings)
├── netlify/
│   └── functions/
│       ├── submit-order.js     Validate + save new order (honeypot, rate limit, recalc fee)
│       ├── get-products.js     Public product fetch (5-min CDN cache)
│       └── admin-action.js     All admin writes (JWT auth + email allowlist)
├── assets/
│   └── logo.svg                BonVoy SVG wordmark
├── firestore.rules             Firestore security rules
├── firestore.indexes.json      Composite indexes
├── storage.rules               Firebase Storage rules (5MB, images only)
├── firebase.json               Firebase CLI config
├── netlify.toml                Headers, redirects, functions config
├── package.json                firebase-admin dependency for functions
└── README.md                   This file
```

---

## DELIVERY ZONES & FEES

| City | Fee |
|---|---|
| Amman | JOD 0.50 |
| Salt | JOD 2.50 |
| Zarqa | JOD 2.50 |
| Jerash | JOD 2.50 |
| Irbid | JOD 2.50 |
| Madaba | JOD 2.50 |
| Balqaa | JOD 2.50 |

Fees are stored in Firestore (`settings/delivery_fees`) and editable via the admin Settings tab. The server **always recalculates** the fee — the client-submitted value is ignored.

---

## OPERATING HOURS

Saturday–Thursday, 11:00am – 5:00pm (Fridays closed)

Toggle the store open/closed banner via the admin Settings tab.

---

## INSTAGRAM

[@bonvoy.jo](https://www.instagram.com/bonvoy.jo) · Sister brand: [@cakeh.jo](https://www.instagram.com/cakeh.jo)

---

## PERFORMANCE NOTES

- **Products:** Cached at CDN for 5 minutes and in `localStorage` for 5 minutes. 1000 users hitting the menu simultaneously = ~1 Firestore read.
- **Cart:** Entirely client-side (localStorage). No network calls until checkout.
- **Orders:** Submitted via Netlify Function. Rate limited to 5 per 10 minutes per IP.
- **Admin real-time:** Only the admin dashboard opens a Firestore `onSnapshot` connection. Customer site never holds a persistent connection.

---

*BonVoy — joy delivered · Alrabieh, Amman, Jordan · @bonvoy.jo*
