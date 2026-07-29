/* Physica — accounts + cross-device sync (Firebase).
   Signed out: the site behaves exactly as before (favorites & notes in this browser only).
   Signed in: favorites & notes live in the account and sync across every device. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

/* ---- config (apiKey is a public identifier; security is enforced by Firestore rules) ---- */
const firebaseConfig = {
  apiKey: "AIzaSyDqdhi8AAnjNyOR0sWkdr5_fC1_wmy4F-o",
  authDomain: "physica-69f62.firebaseapp.com",
  projectId: "physica-69f62",
  storageBucket: "physica-69f62.firebasestorage.app",
  messagingSenderId: "335856818743",
  appId: "1:335856818743:web:6979546a0e3cbb60aabdb2"
};

const KF = 'physica.favorites', KN = 'physica.notes';
let app, auth, db;
try {
  app  = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db   = getFirestore(app);
  setPersistence(auth, browserLocalPersistence).catch(function(){});
} catch (e) {
  console.warn('[physica] Firebase failed to init:', e && (e.message || e));
}

/* =========================================================================
   DATA BRIDGE — localStorage <-> Firestore
   ========================================================================= */
const origSet = Storage.prototype.setItem;
let applying = false;          // true while we write remote data into localStorage
let currentUser = null;
let unsub = null;
let pushTimer = null;

function readLocal(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
function writeLocal(k, v) {
  applying = true;
  try { origSet.call(localStorage, k, JSON.stringify(v)); } finally { applying = false; }
}
function fireChange() { try { window.dispatchEvent(new Event('physica:change')); } catch (e) {} }

/* Intercept every localStorage write. When a signed-in user changes favorites/notes
   (star toggle, note edit, restore, clear) we debounce-push the whole set to their account. */
Storage.prototype.setItem = function (key, value) {
  origSet.call(this, key, value);
  if (this === window.localStorage && !applying && (key === KF || key === KN)) schedulePush();
};

function schedulePush() {
  if (!currentUser || !db) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 600);
}
async function pushNow() {
  if (!currentUser || !db) return;
  try {
    await setDoc(doc(db, 'users', currentUser.uid), {
      favorites: readLocal(KF, []),
      notes: readLocal(KN, {}),
      updatedAt: serverTimestamp()
    });
  } catch (e) { console.warn('[physica] sync up failed:', e && (e.code || e.message)); }
}

/* Live remote -> local. Skip our own pending writes so we never loop. */
function subscribe(uid) {
  if (unsub) { unsub(); unsub = null; }
  unsub = onSnapshot(doc(db, 'users', uid),
    function (snap) {
      if (snap.metadata && snap.metadata.hasPendingWrites) return;
      if (!snap.exists()) return;
      const d = snap.data() || {};
      writeLocal(KF, Array.isArray(d.favorites) ? d.favorites : []);
      writeLocal(KN, (d.notes && typeof d.notes === 'object') ? d.notes : {});
      fireChange();
    },
    function (err) { console.warn('[physica] sync listener error:', err && (err.code || err.message)); }
  );
}

/* On login, union this browser's data with the account so nothing is ever lost. */
async function mergeOnLogin(uid) {
  const ref = doc(db, 'users', uid);
  let cloudFav = [], cloudNotes = {};
  try {
    const s = await getDoc(ref);
    if (s.exists()) {
      const d = s.data() || {};
      if (Array.isArray(d.favorites)) cloudFav = d.favorites;
      if (d.notes && typeof d.notes === 'object') cloudNotes = d.notes;
    }
  } catch (e) { console.warn('[physica] initial read failed:', e && (e.code || e.message)); }

  const localFav = readLocal(KF, []), localNotes = readLocal(KN, {});
  const mergedFav = Array.from(new Set(cloudFav.concat(localFav)));
  const mergedNotes = Object.assign({}, cloudNotes, localNotes); // local edits win on conflict

  writeLocal(KF, mergedFav);
  writeLocal(KN, mergedNotes);
  fireChange();
  try {
    await setDoc(ref, { favorites: mergedFav, notes: mergedNotes, updatedAt: serverTimestamp() });
  } catch (e) { console.warn('[physica] merge write failed:', e && (e.code || e.message)); }
}

/* =========================================================================
   AUTH STATE
   ========================================================================= */
if (auth) {
  onAuthStateChanged(auth, async function (user) {
    currentUser = user || null;
    paintChip();
    if (user) {
      await mergeOnLogin(user.uid);
      subscribe(user.uid);
    } else if (unsub) { unsub(); unsub = null; }
  });
}

/* =========================================================================
   UI — floating chip + modal (works on every page regardless of its nav)
   ========================================================================= */
const CSS = `
#pxa-top{position:fixed;top:14px;right:16px;z-index:9997;display:flex;align-items:center;gap:8px}
#pxa-chip{display:flex;align-items:center;gap:8px;
  background:rgba(18,22,40,.86);color:#eef1fb;border:1px solid rgba(150,170,230,.35);
  font:600 13px Inter,system-ui,sans-serif;padding:8px 13px;border-radius:99px;cursor:pointer;
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 8px 24px -14px rgba(0,0,0,.85)}
#pxa-chip:hover{border-color:rgba(124,196,255,.6)}
#pxa-chip .pxa-av{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font:700 12px Inter,sans-serif;color:#08111e;background:linear-gradient(135deg,#8fd0ff,#b89bff);
  background-size:cover;background-position:center;overflow:hidden;flex:0 0 auto}
.pxa-sw{position:relative}
.pxa-sw-btn{display:flex;align-items:center;gap:7px;background:rgba(18,22,40,.86);color:#eef1fb;
  border:1px solid rgba(150,170,230,.35);font:600 13px Inter,system-ui,sans-serif;padding:8px 12px;border-radius:99px;
  cursor:pointer;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 8px 24px -14px rgba(0,0,0,.85)}
.pxa-sw-btn:hover{border-color:rgba(124,196,255,.6)}
.pxa-sw-btn svg{display:block;flex:0 0 auto}
.pxa-sw-chev{font-size:10px;color:#9aa6cc;transition:transform .15s}
.pxa-sw.open .pxa-sw-chev{transform:rotate(180deg)}
.pxa-sw-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:188px;background:#141a2e;
  border:1px solid rgba(150,170,230,.28);border-radius:13px;box-shadow:0 20px 50px -14px rgba(0,0,0,.78);
  padding:6px;display:none;z-index:10000}
.pxa-sw.open .pxa-sw-menu{display:block}
.pxa-sw-menu a{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;text-decoration:none;
  color:#eef1fb;font-size:14px;font-weight:500}
.pxa-sw-menu a:hover{background:rgba(140,160,220,.12)}
.pxa-sw-ic{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;font-size:13px;flex:none;line-height:1}
.pxa-sw-cur{font-weight:700}
.pxa-sw-tick{margin-left:auto;color:#7cc4ff;font-size:13px}
.pxa-copy{display:flex;align-items:center;gap:7px;background:rgba(18,22,40,.86);color:#eef1fb;
  border:1px solid rgba(150,170,230,.35);font:600 13px Inter,system-ui,sans-serif;padding:8px 12px;border-radius:99px;
  cursor:pointer;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 8px 24px -14px rgba(0,0,0,.85)}
.pxa-copy:hover{border-color:rgba(124,196,255,.6)}
.pxa-copy svg{display:block;flex:0 0 auto}
@media (max-width:600px){.pxa-copy span{display:none}}
@media (max-width:520px){.pxa-sw-btn span:not(.pxa-sw-chev){display:none}}
#pxa-ov{position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;
  background:rgba(4,7,14,.62);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
#pxa-ov.on{display:flex}
#pxa-modal{width:min(400px,94vw);background:rgba(14,18,32,.98);border:1px solid rgba(150,170,230,.28);
  border-radius:18px;box-shadow:0 40px 120px -30px rgba(0,0,0,.9);padding:26px 26px 24px;
  font-family:Inter,system-ui,sans-serif;color:#eef1fb;position:relative}
#pxa-modal h2{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:24px;margin:0 0 4px}
#pxa-modal .pxa-sub{font-size:13px;color:#9aa6cc;line-height:1.55;margin:0 0 18px}
#pxa-modal label{display:block;font-size:12px;color:#9aa6cc;margin:12px 0 5px;font-weight:500}
#pxa-modal input{width:100%;box-sizing:border-box;background:rgba(8,11,20,.7);border:1px solid rgba(150,170,230,.28);
  color:#eef1fb;font:14px Inter,sans-serif;padding:11px 13px;border-radius:10px;outline:none}
#pxa-modal input:focus{border-color:rgba(124,196,255,.65)}
#pxa-modal .pxa-primary{width:100%;margin-top:18px;background:linear-gradient(135deg,#7cc4ff,#b89bff);color:#08111e;
  border:0;font:700 14px Inter,sans-serif;padding:12px;border-radius:11px;cursor:pointer}
#pxa-modal .pxa-primary:disabled{opacity:.55;cursor:default}
#pxa-modal .pxa-or{display:flex;align-items:center;gap:12px;color:#6b76a0;font-size:11.5px;margin:16px 0}
#pxa-modal .pxa-or::before,#pxa-modal .pxa-or::after{content:"";flex:1;height:1px;background:rgba(150,170,230,.2)}
#pxa-modal .pxa-google{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;
  background:#fff;color:#1f2430;border:0;font:600 14px Inter,sans-serif;padding:11px;border-radius:11px;cursor:pointer}
#pxa-modal .pxa-google:hover{background:#f1f3f7}
#pxa-modal .pxa-foot{margin-top:16px;font-size:12.5px;color:#9aa6cc;text-align:center;line-height:1.7}
#pxa-modal .pxa-link{color:#7cc4ff;cursor:pointer;background:0;border:0;font:inherit;padding:0}
#pxa-modal .pxa-link:hover{text-decoration:underline}
#pxa-modal .pxa-msg{margin-top:14px;font-size:12.5px;line-height:1.5;padding:9px 12px;border-radius:9px;display:none}
#pxa-modal .pxa-msg.err{display:block;background:rgba(255,138,91,.12);border:1px solid rgba(255,138,91,.4);color:#ffb59a}
#pxa-modal .pxa-msg.ok{display:block;background:rgba(98,210,162,.12);border:1px solid rgba(98,210,162,.4);color:#9fe3c6}
#pxa-x{position:absolute;top:14px;right:15px;background:0;border:0;color:#6b76a0;font-size:22px;line-height:1;cursor:pointer}
#pxa-x:hover{color:#eef1fb}
#pxa-acct{font-size:13.5px;color:#cfd6ee;line-height:1.6}
#pxa-acct b{color:#eef1fb}
#pxa-modal .pxa-signout{width:100%;margin-top:18px;background:rgba(255,138,91,.1);border:1px solid rgba(255,138,91,.4);
  color:#ffb59a;font:600 13.5px Inter,sans-serif;padding:11px;border-radius:11px;cursor:pointer}
#pxa-modal .pxa-signout:hover{background:rgba(255,138,91,.16)}
`;

let chip, ov, modal, mode = 'signin';

function friendly(e) {
  const c = e && e.code || '';
  const map = {
    'auth/invalid-email': "That doesn't look like a valid email address.",
    'auth/missing-password': "Please enter your password.",
    'auth/user-not-found': "Email or password is incorrect.",
    'auth/wrong-password': "Email or password is incorrect.",
    'auth/invalid-credential': "Email or password is incorrect.",
    'auth/email-already-in-use': "An account with this email already exists — try signing in instead.",
    'auth/weak-password': "Password should be at least 6 characters.",
    'auth/popup-closed-by-user': "Sign-in window was closed before finishing.",
    'auth/cancelled-popup-request': "Sign-in was cancelled.",
    'auth/popup-blocked': "Your browser blocked the popup — allow popups for this site and try again.",
    'auth/unauthorized-domain': "This site isn't authorized for sign-in yet. (Add its domain in Firebase → Authentication → Settings.)",
    'auth/network-request-failed': "Network error — check your connection and try again.",
    'auth/too-many-requests': "Too many attempts. Please wait a moment and try again."
  };
  return map[c] || (e && e.message) || "Something went wrong. Please try again.";
}

function el(tag, attrs, html) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (html != null) n.innerHTML = html;
  return n;
}

/* Cross-product "labs" switcher — added to the top-right cluster on every page.
   Skipped when the page already has an inline switcher (the hub's #psw). */
function buildLabSwitcher() {
  const wrap = el('div', { id: 'pxa-sw', class: 'pxa-sw' },
    '<button type="button" class="pxa-sw-btn" aria-haspopup="true" aria-expanded="false" aria-label="Switch labs">'
    + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="6" stroke="currentColor" stroke-width="1.6"/><path d="M7 16.5 L12 7.5 L17 16.5" stroke="#7cc4ff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>'
    + '<span>Physica</span><span class="pxa-sw-chev">▾</span></button>'
    + '<div class="pxa-sw-menu" role="menu">'
    + '<a role="menuitem" href="https://knovay.com/"><span class="pxa-sw-ic" style="background:rgba(120,140,230,.16);color:#9db4ff">⌂</span> Knovay home</a>'
    + '<a role="menuitem" href="https://geoproof.knovay.com/"><span class="pxa-sw-ic" style="background:rgba(124,196,255,.16);color:#7cc4ff">△</span> GeoProof</a>'
    + '<a role="menuitem" class="pxa-sw-cur" aria-current="page" href="https://physica.knovay.com/"><span class="pxa-sw-ic" style="background:rgba(184,155,255,.16);color:#b89bff">⚛</span> Physica <span class="pxa-sw-tick">✓</span></a>'
    + '<a role="menuitem" href="https://calculo.knovay.com/"><span class="pxa-sw-ic" style="background:rgba(92,214,176,.16);color:#5cd6b0">∫</span> Calculo</a>'
    + '</div>');
  const btn = wrap.querySelector('.pxa-sw-btn');
  btn.addEventListener('click', function (e) { e.stopPropagation(); const o = wrap.classList.toggle('open'); btn.setAttribute('aria-expanded', o ? 'true' : 'false'); });
  document.addEventListener('click', function (e) { if (wrap.classList.contains('open') && !wrap.contains(e.target)) { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && wrap.classList.contains('open')) { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  return wrap;
}

/* ---- copy-link-to-setup: share a simulator at its current settings ----
   Encodes the page's control values into ?setup= and restores them on load.
   Only appears on pages that actually have tunable controls (the simulators). */
function pxaOwnUI(c) { return c.closest && (c.closest('#pxa-ov') || c.closest('#pxa-top') || c.closest('#kv-report-ov')); }
function collectState() {
  var out = {};
  document.querySelectorAll('input[id], select[id]').forEach(function (c) {
    if (pxaOwnUI(c)) return;                       // skip our own account / switcher / report inputs
    var t = (c.type || '').toLowerCase();
    if (t === 'checkbox') out[c.id] = c.checked ? 1 : 0;
    else if (t === 'radio') { if (c.checked) out[c.id] = c.value; }
    else out[c.id] = c.value;
  });
  // segmented preset controls (Physica house style: <div class="seg" id="..."> with the active <button class="on">)
  var seg = {};
  document.querySelectorAll('.seg[id]').forEach(function (g) {
    if (pxaOwnUI(g)) return;
    var btns = Array.prototype.slice.call(g.querySelectorAll('button'));
    var i = -1; btns.forEach(function (b, k) { if (b.classList.contains('on')) i = k; });
    if (i >= 0) seg[g.id] = i;
  });
  if (Object.keys(seg).length) out.__seg = seg;
  return out;
}
function applyState(obj) {
  Object.keys(obj).forEach(function (id) {
    if (id === '__seg') return;
    var c = document.getElementById(id);
    if (!c || pxaOwnUI(c)) return;
    var t = (c.type || '').toLowerCase();
    if (t === 'checkbox') c.checked = (obj[id] == 1);
    else if (t === 'radio') c.checked = (String(c.value) === String(obj[id]));
    else c.value = obj[id];
    try { c.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    try { c.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
  });
  if (obj.__seg) Object.keys(obj.__seg).forEach(function (gid) {   // restore preset buttons by clicking the right one
    var g = document.getElementById(gid); if (!g) return;
    var btns = g.querySelectorAll('button'); var i = obj.__seg[gid];
    if (btns[i] && !btns[i].classList.contains('on')) { try { btns[i].click(); } catch (e) {} }
  });
}
function applyStateFromURL() {
  try {
    var raw = new URLSearchParams(location.search).get('setup');
    if (!raw) return;
    var obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') applyState(obj);
  } catch (e) {}
}
function fallbackCopy(text, ok) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    if (ok) ok();
  } catch (e) {}
}
function buildCopyLink() {
  var b = el('button', { type: 'button', class: 'pxa-copy', 'aria-label': 'Copy a link to this setup' },
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 13a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.5 1.5M14 11a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.5-1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Copy link</span>');
  b.addEventListener('click', function () {
    var url = location.origin + location.pathname + '?setup=' + encodeURIComponent(JSON.stringify(collectState()));
    function ok() { var t = b.querySelector('span'); if (t) { var old = t.textContent; t.textContent = 'Copied ✓'; setTimeout(function () { t.textContent = old; }, 1600); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, function () { fallbackCopy(url, ok); });
    else fallbackCopy(url, ok);
  });
  return b;
}

function buildUI() {
  if (document.getElementById('pxa-chip')) return;
  document.head.appendChild(el('style', null, CSS));

  const top = el('div', { id: 'pxa-top' });
  const hasControls = document.querySelector('input[type=range], input[type=number], select');
  if (hasControls) top.appendChild(buildCopyLink());                        // simulators only
  if (!document.getElementById('psw')) top.appendChild(buildLabSwitcher());  // hub already has an inline switcher

  chip = el('button', { id: 'pxa-chip', 'aria-label': 'Account' });
  chip.addEventListener('click', openModal);
  top.appendChild(chip);
  document.body.appendChild(top);

  if (hasControls) {
    if (document.readyState === 'complete') setTimeout(applyStateFromURL, 90);
    else window.addEventListener('load', function () { setTimeout(applyStateFromURL, 90); });
  }

  ov = el('div', { id: 'pxa-ov' });
  modal = el('div', { id: 'pxa-modal' });
  ov.appendChild(modal);
  ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  document.body.appendChild(ov);

  paintChip();
  initVisitCounter();
}

/* =========================================================================
   VISIT COUNTER — global, server-side (Firestore stats/site.visits)
   Displays live in #visitCount if present (hub). Counts once per browser session.
   ========================================================================= */
function initVisitCounter() {
  var el = document.getElementById('visitCount');
  if (!el || !db) return;
  try { var cv = parseInt(localStorage.getItem('physica.vc') || '', 10);   // instant paint from cache (no "—" flash on repeat visits)
        if (!isNaN(cv)) { el.textContent = cv.toLocaleString(); var l0 = document.getElementById('visitLine'); if (l0) l0.style.visibility = 'visible'; } } catch (e) {}
  var ref = doc(db, 'stats', 'site');
  // Live display — ticks up as other visitors arrive.
  onSnapshot(ref,
    function (s) {
      var v = (s.exists() && typeof s.data().visits === 'number') ? s.data().visits : 0;
      try { localStorage.setItem('physica.vc', String(v)); } catch (e) {}
      el.textContent = v.toLocaleString();
      var line = document.getElementById('visitLine'); if (line) line.style.visibility = 'visible';
    },
    function (e) { console.warn('[physica] visit counter read:', e && (e.code || e.message)); }
  );
  // Count this visit once per browser session.
  try {
    if (!sessionStorage.getItem('physica.counted')) {
      sessionStorage.setItem('physica.counted', '1');
      setDoc(ref, { visits: increment(1) }, { merge: true })
        .catch(function (e) { console.warn('[physica] visit counter write:', e && (e.code || e.message)); });
    }
  } catch (e) { /* sessionStorage unavailable — skip counting, still displays */ }
}

function paintChip() {
  if (!chip) return;
  if (currentUser) {
    const label = currentUser.displayName || (currentUser.email || 'Account').split('@')[0];
    const av = currentUser.photoURL
      ? '<span class="pxa-av" style="background-image:url(' + currentUser.photoURL + ')"></span>'
      : '<span class="pxa-av">' + (label[0] || '?').toUpperCase() + '</span>';
    chip.innerHTML = av + '<span>' + escapeHtml(label) + '</span>';
  } else {
    chip.innerHTML = '<span class="pxa-av">↪</span><span>Sign in</span>';
  }
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

function openModal() { renderModal(); ov.classList.add('on'); }
function closeModal() { if (ov) ov.classList.remove('on'); }

function renderModal() {
  if (!auth) {
    modal.innerHTML = '<button id="pxa-x" aria-label="Close">&times;</button>'
      + '<h2>Sign-in unavailable</h2><p class="pxa-sub">Accounts could not load. Please refresh and try again.</p>';
    modal.querySelector('#pxa-x').addEventListener('click', closeModal);
    return;
  }
  if (currentUser) return renderAccount();

  const signup = mode === 'signup';
  modal.innerHTML =
    '<button id="pxa-x" aria-label="Close">&times;</button>'
    + '<h2>' + (signup ? 'Create your account' : 'Welcome back') + '</h2>'
    + '<p class="pxa-sub">' + (signup
        ? 'Save your favorites and private notes to your account and pick them up on any device.'
        : 'Sign in to sync your favorites and notes across every device.') + '</p>'
    + '<label for="pxa-email">Email</label><input id="pxa-email" type="email" autocomplete="email" placeholder="you@example.com">'
    + '<label for="pxa-pass">Password</label><input id="pxa-pass" type="password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" placeholder="' + (signup ? 'At least 6 characters' : 'Your password') + '">'
    + (signup ? '' : '<div style="text-align:right;margin-top:7px"><button class="pxa-link" id="pxa-forgot">Forgot password?</button></div>')
    + '<button class="pxa-primary" id="pxa-go">' + (signup ? 'Create account' : 'Sign in') + '</button>'
    + '<div class="pxa-or">or</div>'
    + '<button class="pxa-google" id="pxa-google">' + googleSVG() + 'Continue with Google</button>'
    + '<div class="pxa-msg" id="pxa-msg"></div>'
    + '<div class="pxa-foot">' + (signup
        ? 'Already have an account? <button class="pxa-link" id="pxa-toggle">Sign in</button>'
        : 'New to Physica? <button class="pxa-link" id="pxa-toggle">Create an account</button>') + '</div>';

  modal.querySelector('#pxa-x').addEventListener('click', closeModal);
  modal.querySelector('#pxa-toggle').addEventListener('click', function () { mode = signup ? 'signin' : 'signup'; renderModal(); });
  modal.querySelector('#pxa-go').addEventListener('click', emailSubmit);
  modal.querySelector('#pxa-google').addEventListener('click', googleSubmit);
  const forgot = modal.querySelector('#pxa-forgot');
  if (forgot) forgot.addEventListener('click', forgotPass);
  modal.querySelector('#pxa-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') emailSubmit(); });
  setTimeout(function () { const em = modal.querySelector('#pxa-email'); if (em) em.focus(); }, 60);
}

function renderAccount() {
  const u = currentUser;
  modal.innerHTML =
    '<button id="pxa-x" aria-label="Close">&times;</button>'
    + '<h2>Your account</h2>'
    + '<p id="pxa-acct">Signed in as <b>' + escapeHtml(u.email || u.displayName || 'your account') + '</b>.<br>'
    + 'Your favorites and notes sync automatically across every device you sign in on.</p>'
    + '<div class="pxa-msg ok" style="display:block">✓ Syncing is on for this browser.</div>'
    + '<button class="pxa-signout" id="pxa-out">Sign out</button>';
  modal.querySelector('#pxa-x').addEventListener('click', closeModal);
  modal.querySelector('#pxa-out').addEventListener('click', function () {
    signOut(auth).then(closeModal).catch(function (e) { msg(friendly(e), 'err'); });
  });
}

function msg(text, kind) {
  const m = modal.querySelector('#pxa-msg');
  if (!m) return;
  m.className = 'pxa-msg ' + (kind || 'err');
  m.textContent = text;
}
function busy(on) {
  const b = modal.querySelector('#pxa-go'); if (b) { b.disabled = on; b.textContent = on ? 'Please wait…' : (mode === 'signup' ? 'Create account' : 'Sign in'); }
}

async function emailSubmit() {
  const email = (modal.querySelector('#pxa-email') || {}).value || '';
  const pass = (modal.querySelector('#pxa-pass') || {}).value || '';
  if (!email.trim()) return msg('Please enter your email.', 'err');
  if (!pass) return msg('Please enter your password.', 'err');
  busy(true);
  try {
    if (mode === 'signup') await createUserWithEmailAndPassword(auth, email.trim(), pass);
    else await signInWithEmailAndPassword(auth, email.trim(), pass);
    closeModal();
  } catch (e) { msg(friendly(e), 'err'); }
  finally { busy(false); }
}

async function googleSubmit() {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    closeModal();
  } catch (e) { msg(friendly(e), 'err'); }
}

async function forgotPass() {
  const email = (modal.querySelector('#pxa-email') || {}).value || '';
  if (!email.trim()) return msg('Enter your email above, then tap “Forgot password?” again.', 'err');
  try {
    await sendPasswordResetEmail(auth, email.trim());
    msg('Password reset link sent to ' + email.trim() + '. Check your inbox.', 'ok');
  } catch (e) { msg(friendly(e), 'err'); }
}

function googleSVG() {
  return '<svg width="17" height="17" viewBox="0 0 48 48" style="flex:0 0 auto">'
    + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
    + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
    + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
    + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>'
    + '</svg>';
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
else buildUI();
