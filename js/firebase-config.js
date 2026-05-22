// Firebase Client SDK — compat version loaded via CDN in HTML files.
// Firebase API keys are safe to be in client code.
// Security comes from Firestore rules + Netlify Functions.
// NEVER put your Admin SDK service account key here.

const firebaseConfig = {
  apiKey:            "AIzaSyABKp1CWCR7tok5oPFjLXardP9DYFfvcJA",
  authDomain:        "bonvoy-d2b12.firebaseapp.com",
  projectId:         "bonvoy-d2b12",
  storageBucket:     "bonvoy-d2b12.firebasestorage.app",
  messagingSenderId: "238360679519",
  appId:             "1:238360679519:web:e2201e7798d29949b737ea"
};

firebase.initializeApp(firebaseConfig);
const db      = firebase.firestore();
const auth    = firebase.auth();
const storage = firebase.storage();