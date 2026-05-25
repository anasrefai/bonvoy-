/* ═══════════════════════════════════════════════════════════════
   BonVoy — Product Detail Modal + Extras
   Handles: card clicks, modal open/close, extras loading/selection,
            add-to-cart with extras, cart extras display override,
            fetch intercept to inject extras into order submission.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ─── Fetch intercept (installed immediately, before DOMContentLoaded)
       so it is in place when main.js calls loadProducts on DOMContentLoaded ─ */
(function () {
  var _origFetch = window.fetch;
  window.fetch = function (url, options) {
    if (typeof url === 'string' && url.includes('submit-order') &&
        options && options.method === 'POST' && options.body) {
      try {
        var body = JSON.parse(options.body);
        var cart = _getCart();
        var hasExtras = cart.some(function (c) { return c.extras && c.extras.length; });
        if (hasExtras) {
          body.items = body.items.map(function (item) {
            var ci = cart.find(function (c) { return c.id === item.id; });
            var extras = ci ? (ci.extras || []) : [];
            return {
              id:          ci ? (ci.productId || item.id) : item.id,
              name:        item.name,
              qty:         item.qty,
              price:       ci ? (ci.basePrice !== undefined ? ci.basePrice : item.price) : item.price,
              extras:      extras,
              extrasTotal: parseFloat((extras.reduce(function (s, ex) { return s + (ex.price || 0); }, 0) * item.qty).toFixed(3)),
            };
          });
          options = Object.assign({}, options, { body: JSON.stringify(body) });
        }
      } catch (_) {}
    }
    return _origFetch.call(window, url, options);
  };
})();

/* ─── Helpers ───────────────────────────────────────────────── */
function _getCart() {
  try { return JSON.parse(localStorage.getItem('bonvoy_cart')) || []; } catch (_) { return []; }
}
function _saveCart(cart) { localStorage.setItem('bonvoy_cart', JSON.stringify(cart)); }

function _esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _extrasKey(extras) {
  return (extras || []).map(function (e) { return e.name; }).sort().join('|');
}
function _makeCartId(productId, extras) {
  var key = _extrasKey(extras);
  if (!key) return productId;
  // stable 12-char suffix from key
  var hash = 0;
  for (var i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return productId + '__' + Math.abs(hash).toString(36);
}

/* ─── Product fetch cache ───────────────────────────────────── */
var _productCache = {};

function _fetchProduct(productId, cb) {
  if (_productCache[productId]) { cb(_productCache[productId]); return; }
  db.collection('products').doc(productId).get()
    .then(function (snap) {
      if (!snap.exists) { cb(null); return; }
      var p = Object.assign({ id: snap.id }, snap.data());
      _productCache[productId] = p;
      cb(p);
    })
    .catch(function () { cb(null); });
}

/* ─── Add to cart with extras ───────────────────────────────── */
function _addToCartWithExtras(product, extras) {
  var extrasUnit = (extras || []).reduce(function (s, ex) { return s + (ex.price || 0); }, 0);
  var combined   = parseFloat((product.price + extrasUnit).toFixed(3));
  var cartId     = _makeCartId(product.id, extras);
  var cart       = _getCart();
  var existing   = cart.find(function (c) { return c.id === cartId; });
  if (existing) {
    existing.qty = Math.min(existing.qty + 1, 99);
  } else {
    cart.push({
      id:        cartId,
      productId: product.id,
      name:      product.name,
      price:     combined,
      basePrice: product.price,
      imageUrl:  product.imageUrl,
      qty:       1,
      extras:    extras || [],
    });
  }
  _saveCart(cart);
  if (typeof updateCartUI === 'function') updateCartUI();
}

/* ─── Fly-to-cart animation ─────────────────────────────────── */
function _flyAnimation(srcEl, imageUrl) {
  var cartBtn = document.getElementById('cart-btn');
  if (!srcEl || !cartBtn) return;
  var sr = srcEl.getBoundingClientRect();
  var cr = cartBtn.getBoundingClientRect();
  var ghost = document.createElement('img');
  ghost.src = imageUrl;
  ghost.style.cssText = [
    'position:fixed',
    'left:' + (sr.left + sr.width / 2 - 30) + 'px',
    'top:'  + (sr.top  + sr.height/ 2 - 30) + 'px',
    'width:60px;height:60px',
    'border-radius:50%;object-fit:cover',
    'pointer-events:none;z-index:9999',
    'transition:transform 0.65s cubic-bezier(0.25,0.46,0.45,0.94),opacity 0.65s ease',
  ].join(';');
  document.body.appendChild(ghost);
  ghost.offsetHeight;
  ghost.style.transform = 'translate(' +
    ((cr.left + cr.width/2) - (sr.left + sr.width/2)) + 'px,' +
    ((cr.top  + cr.height/2)- (sr.top  + sr.height/2)) + 'px) scale(0.1)';
  ghost.style.opacity = '0';
  ghost.addEventListener('transitionend', function () {
    ghost.remove();
    var badge = document.getElementById('cart-badge');
    if (badge) {
      badge.classList.remove('bounce'); void badge.offsetWidth;
      badge.classList.add('bounce');
      setTimeout(function () { badge.classList.remove('bounce'); }, 400);
    }
  }, { once: true });
}

/* ─── Modal state ───────────────────────────────────────────── */
var _pmProduct  = null;
var _pmExtras   = [];
var _pmSelected = [];

/* ─── Open / close modal ────────────────────────────────────── */
function _openPM(product) {
  _pmProduct  = product;
  _pmExtras   = [];
  _pmSelected = [];

  document.getElementById('pm-img').src      = product.imageUrl || '';
  document.getElementById('pm-img').alt      = product.name     || '';
  document.getElementById('pm-category').textContent = product.category    || '';
  document.getElementById('pm-name').textContent     = product.name        || '';
  document.getElementById('pm-desc').textContent     = product.description || '';
  document.getElementById('pm-price').textContent    = 'JOD ' + Number(product.price).toFixed(2);

  var extrasSection = document.getElementById('pm-extras-section');
  var addBtn        = document.getElementById('pm-add-btn');
  var hint          = document.getElementById('pm-required-hint');

  if (product.hasExtras) {
    extrasSection.style.display = 'block';
    document.getElementById('pm-extras-label-text').textContent =
      product.extrasLabel || 'Customize your order';
    document.getElementById('pm-extras-list').innerHTML =
      '<div class="pm-spinner">Loading options…</div>';
    addBtn.disabled = !!product.extrasRequired;
    hint.style.display = product.extrasRequired ? 'block' : 'none';
    _loadExtras(product);
  } else {
    extrasSection.style.display = 'none';
    addBtn.disabled = false;
    hint.style.display = 'none';
  }

  document.getElementById('pm-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function _closePM() {
  document.getElementById('pm-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* ─── Load extras from Firestore ────────────────────────────── */
function _loadExtras(product) {
  var ref = product.extrasGroupId
    ? db.collection('extraGroups').doc(product.extrasGroupId).collection('extras')
    : db.collection('products').doc(product.id).collection('extras');

  ref.where('available', '==', true).orderBy('order', 'asc').limit(25).get()
    .then(function (snap) {
      _pmExtras = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      _renderExtras(product);
    })
    .catch(function () {
      document.getElementById('pm-extras-list').innerHTML =
        '<div class="pm-spinner">Could not load options.</div>';
    });
}

function _renderExtras(product) {
  var listEl    = document.getElementById('pm-extras-list');
  var inputType = product.extrasMultiple ? 'checkbox' : 'radio';
  var iname     = 'pm-ex-' + _esc(product.id);
  var blankImg  = 'data:image/svg+xml,%3Csvg xmlns%3D\'http://www.w3.org/2000/svg\' width%3D\'48\' height%3D\'48\'%3E%3Crect width%3D\'48\' height%3D\'48\' rx%3D\'24\' fill%3D\'%23e8dece\'/%3E%3C/svg%3E';

  if (!_pmExtras.length) {
    listEl.innerHTML = '<div class="pm-spinner">No options available.</div>';
    return;
  }

  listEl.innerHTML = _pmExtras.map(function (ex, i) {
    var priceStr   = (ex.price === 0) ? 'Free' : '+JOD ' + Number(ex.price).toFixed(2);
    var priceClass = (ex.price === 0) ? 'pm-extra-price-tag free' : 'pm-extra-price-tag';
    return '<label class="pm-extra-row" data-idx="' + i + '">' +
      '<input class="pm-extra-check" type="' + inputType + '" name="' + iname + '" value="' + i + '">' +
      '<img class="pm-extra-img" src="' + _esc(ex.imageUrl || blankImg) + '" alt="" width="48" height="48">' +
      '<span class="pm-extra-name">' + _esc(ex.name) + '</span>' +
      '<span class="' + priceClass + '">' + _esc(priceStr) + '</span>' +
    '</label>';
  }).join('');

  listEl.querySelectorAll('.pm-extra-check').forEach(function (inp) {
    inp.addEventListener('change', function () { _onExtrasChange(product); });
  });
  listEl.querySelectorAll('.pm-extra-row').forEach(function (row) {
    row.addEventListener('click', function (e) {
      if (e.target.tagName === 'INPUT') return;
      var inp = row.querySelector('.pm-extra-check');
      if (!inp) return;
      inp.checked = (inp.type === 'checkbox') ? !inp.checked : true;
      inp.dispatchEvent(new Event('change'));
    });
  });
}

function _onExtrasChange(product) {
  _pmSelected = [];
  document.querySelectorAll('.pm-extra-check:checked').forEach(function (inp) {
    var idx = parseInt(inp.value, 10);
    if (!isNaN(idx) && _pmExtras[idx]) _pmSelected.push(_pmExtras[idx]);
  });
  document.querySelectorAll('.pm-extra-row').forEach(function (row) {
    var inp = row.querySelector('.pm-extra-check');
    row.classList.toggle('selected', !!(inp && inp.checked));
  });
  var addBtn = document.getElementById('pm-add-btn');
  var hint   = document.getElementById('pm-required-hint');
  if (product.extrasRequired && !_pmSelected.length) {
    addBtn.disabled = true; hint.style.display = 'block';
  } else {
    addBtn.disabled = false; hint.style.display = 'none';
  }
  // Update price display
  var extrasTotal = _pmSelected.reduce(function (s, ex) { return s + (ex.price || 0); }, 0);
  document.getElementById('pm-price').textContent =
    'JOD ' + ((_pmProduct ? _pmProduct.price : 0) + extrasTotal).toFixed(2);
}

/* ─── Add to cart from modal ────────────────────────────────── */
function _pmAddToCart() {
  if (!_pmProduct) return;
  var extras = _pmSelected.map(function (ex) {
    return { name: ex.name, price: ex.price || 0 };
  });
  _addToCartWithExtras(_pmProduct, extras);
  _flyAnimation(document.getElementById('pm-img'), _pmProduct.imageUrl);
  _closePM();
}

/* ─── Bind card clicks ──────────────────────────────────────── */
function _bindCards(grid) {
  grid.querySelectorAll('.product-card').forEach(function (card) {
    if (card._pmBound) return;
    card._pmBound = true;

    var btnAdd = card.querySelector('.btn-add');
    if (!btnAdd) return;
    var productId = btnAdd.dataset.id;

    // Intercept btn-add click (capture phase, before main.js bubble handler)
    btnAdd.addEventListener('click', function (e) {
      e.stopImmediatePropagation();
      _fetchProduct(productId, function (product) {
        if (!product) return;
        if (product.hasExtras) {
          _openPM(product);
        } else {
          // No extras: add directly then fly
          var imgEl = card.querySelector('.card-img-wrap img');
          _addToCartWithExtras(product, []);
          _flyAnimation(imgEl, product.imageUrl || '');
        }
      });
    }, true);

    // Click on image or name → view modal (info + add btn, no extras config)
    ['card-img-wrap', 'card-name'].forEach(function (cls) {
      var el = card.querySelector('.' + cls);
      if (el) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', function () {
          _fetchProduct(productId, function (product) {
            if (product) _openPM(product);
          });
        });
      }
    });
  });
}

/* ─── Cart extras display override ─────────────────────────── */
function _installCartOverride() {
  var _orig = window.updateCartUI;
  if (!_orig) return;
  window.updateCartUI = function () {
    _orig.call(this);
    _getCart().forEach(function (item) {
      if (!item.extras || !item.extras.length) return;
      var el = document.querySelector('.cart-item[data-id="' + _esc(item.id) + '"]');
      if (!el) return;
      var info = el.querySelector('.cart-item-info');
      if (!info || info.querySelector('.cart-item-extras')) return;
      var div = document.createElement('div');
      div.className = 'cart-item-extras';
      div.textContent = item.extras.map(function (ex) { return ex.name; }).join(', ');
      var actions = info.querySelector('.cart-item-actions');
      if (actions) info.insertBefore(div, actions); else info.appendChild(div);
    });
  };
  window.updateCartUI();
}

/* ─── Init ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  var overlay = document.getElementById('pm-overlay');
  var closeBtn = document.getElementById('pm-close');
  var addBtn   = document.getElementById('pm-add-btn');

  if (closeBtn) closeBtn.addEventListener('click', _closePM);
  if (overlay)  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) _closePM();
  });
  if (addBtn) addBtn.addEventListener('click', _pmAddToCart);

  // Cart extras display
  _installCartOverride();

  // Bind cards — initial + re-bind when grid re-renders
  var grid = document.getElementById('product-grid');
  if (grid) {
    _bindCards(grid);
    new MutationObserver(function () {
      setTimeout(function () { _bindCards(grid); }, 50);
    }).observe(grid, { childList: true });
  }
});
