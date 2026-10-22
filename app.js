// Focus — timer, Big 3, voice log. Syncs through Firebase; personal entries are encrypted on the device with your PIN.

const FB_VER = '10.12.2';
const firebaseConfig = {
  apiKey: "AIzaSyAAE0ZqAPkB1qDzMSmHieQ9iqoLYIMJCQw",
  authDomain: "focus-app-62fc8.firebaseapp.com",
  projectId: "focus-app-62fc8",
  storageBucket: "focus-app-62fc8.firebasestorage.app",
  messagingSenderId: "271763825319",
  appId: "1:271763825319:web:04533c81382c4c39f03182"
};

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const z = n => String(n).padStart(2, '0');
// The app's "day" rolls over at your chosen hour (default 4 AM), so late-night work counts as the same day.
const dayStartHour = () => store.get('dayStart', 4);
const dayKey = (d = new Date()) => { const s = new Date(d.getTime() - dayStartHour() * 3600000); return s.getFullYear() + '-' + z(s.getMonth() + 1) + '-' + z(s.getDate()); };
const fmtClock = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const settings = {
  readAloud: store.get('readAloud', true),
  workMin: store.get('workMin', 15),
  breakMin: store.get('breakMin', 15),
  stopTime: store.get('stopTime', '17:30'),
  checkinOn: store.get('checkinOn', true)
};
let space = store.get('space', 'work');
let today = dayKey();

/* ---------- Toast, speech, sound, alerts ---------- */
let toastT;
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3500); }

function speak(t) {
  if (!settings.readAloud || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.rate = 0.95; speechSynthesis.speak(u); } catch (e) {}
}

let actx = null;
function unlockAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (actx && actx.state === 'suspended') actx.resume();
}
function chime() {
  if (!actx) return;
  [660, 880, 660, 880, 660, 880].forEach((f, i) => {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.35;
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.34);
  });
}

let swReg = null;
async function notify(title, body) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if (swReg) await swReg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'focus', renotify: true });
    else new Notification(title, { body });
  } catch (e) {}
}
function alertUser(title, body, spoken) { chime(); speak(spoken || body); notify(title, body); }

/* ---------- Wake lock ---------- */
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); } } catch (e) {}
}

/* ---------- Timer ---------- */
const breakIdeas = ["Drink a glass of water.", "Stand up and stretch.", "Take a short walk.", "Take 5 slow, deep breaths.", "Look out a window. Rest your eyes.", "Have a healthy snack.", "Step outside for fresh air."];
const workIdeas = ["One small thing. Just start.", "Back to it. One step at a time.", "Pick the next small step.", "You've got this. Start small."];
const R = 50, C = 2 * Math.PI * R;
$('bar').style.strokeDasharray = C;

let T = store.get('timer', null) || { phase: 'work', running: false, endAt: 0, remaining: settings.workMin * 60, total: settings.workMin * 60, msg: 'Pick one small thing. Press Start.' };
let counts = store.get('counts', { day: today, n: 0 });
if (counts.day !== today) counts = { day: today, n: 0 };
let ideaI = Math.floor(Math.random() * 7), tick = null, nag = null;
const saveTimer = () => store.set('timer', T);

function fmt(s) { s = Math.max(0, Math.ceil(s)); return z(Math.floor(s / 60)) + ':' + z(s % 60); }
function drawTimer() {
  $('time').textContent = fmt(T.remaining);
  $('bar').style.strokeDashoffset = C * (1 - T.remaining / T.total);
  $('timerCard').className = 'card timer ' + (T.phase === 'work' ? 'work' : T.phase === 'break' ? 'rest' : 'ready');
  $('mode').textContent = T.phase === 'work' ? 'Work' : T.phase === 'break' ? 'Break' : "Break's over";
  $('flowBtn').hidden = T.phase !== 'break';
  $('startBtn').textContent = T.phase === 'ready' ? "I'm back" : T.running ? 'Pause' : (T.remaining < T.total ? 'Resume' : 'Start');
  $('msg').textContent = T.msg;
  document.title = T.running ? fmt(T.remaining) + ' ' + (T.phase === 'work' ? 'Work' : 'Break') : 'Focus';
  $('wVal').textContent = settings.workMin + ' min'; $('bVal').textContent = settings.breakMin + ' min';
  $('countNum').textContent = counts.n;
  const dots = $('dots'); dots.innerHTML = '';
  for (let i = 0; i < Math.min(counts.n, 24); i++) { const d = document.createElement('span'); d.className = 'dot'; dots.appendChild(d); }
}
function setPhase(p) {
  T.phase = p;
  T.total = (p === 'break' ? settings.breakMin : settings.workMin) * 60;
  T.remaining = T.total; T.endAt = Date.now() + T.total * 1000;
  ideaI++;
}
function finish() {
  if (T.phase === 'work') {
    counts.n++; store.set('counts', counts);
    setPhase('break'); T.running = true;
    const idea = breakIdeas[ideaI % breakIdeas.length];
    T.msg = 'Break time. ' + idea;
    alertUser('Break time', idea, 'Break time. ' + idea);
  } else {
    T.phase = 'ready'; T.running = false; T.remaining = 0; T.total = settings.breakMin * 60;
    T.msg = "Break's over. Tap I'm back when you're ready.";
    alertUser("Break's over", "Tap I'm back to start your next block.", "Break's over. Tap I'm back.");
    clearInterval(tick); startNag();
  }
  saveTimer();
}
function startNag() {
  clearInterval(nag);
  nag = setInterval(() => { if (T.phase === 'ready') alertUser('Still on break?', "Tap I'm back to start your next block.", "Still on break? Tap I'm back."); else clearInterval(nag); }, 3 * 60 * 1000);
}
function loop() {
  if (!T.running) return;
  T.remaining = (T.endAt - Date.now()) / 1000;
  if (T.remaining <= 0) finish();
  drawTimer();
}
function runTimer() {
  T.running = true; T.endAt = Date.now() + T.remaining * 1000;
  clearInterval(tick); tick = setInterval(loop, 500); keepAwake(); saveTimer(); drawTimer();
}
function startWork(msg) {
  clearInterval(nag); setPhase('work');
  T.msg = msg || workIdeas[ideaI % workIdeas.length];
  speak(T.msg); runTimer();
}
$('startBtn').addEventListener('click', () => {
  unlockAudio();
  if (T.phase === 'ready') return startWork();
  if (T.running) {
    T.running = false; clearInterval(tick); T.remaining = (T.endAt - Date.now()) / 1000;
    T.msg = 'Paused. Press Resume when ready.'; saveTimer(); drawTimer();
  } else {
    if (T.remaining >= T.total && T.phase === 'work') { T.msg = nowText() ? 'Working on: ' + nowText() : workIdeas[ideaI % workIdeas.length]; speak(T.msg); }
    else T.msg = T.phase === 'work' ? 'Back to it.' : 'Enjoy your break.';
    runTimer();
  }
});
$('flowBtn').addEventListener('click', () => { unlockAudio(); startWork("Nice flow! I'll remind you again in " + settings.workMin + " minutes."); });
$('resetBtn').addEventListener('click', () => {
  T.running = false; clearInterval(tick); clearInterval(nag);
  T.phase = 'work'; T.total = settings.workMin * 60; T.remaining = T.total; T.msg = 'Pick one small thing. Press Start.';
  saveTimer(); drawTimer();
});
function adjust(which, delta) {
  if (which === 'w') { settings.workMin = Math.min(60, Math.max(5, settings.workMin + delta)); store.set('workMin', settings.workMin); }
  else { settings.breakMin = Math.min(30, Math.max(1, settings.breakMin + delta)); store.set('breakMin', settings.breakMin); }
  if (!T.running && T.phase !== 'ready' && T.remaining >= T.total) { T.total = (T.phase === 'work' ? settings.workMin : settings.breakMin) * 60; T.remaining = T.total; saveTimer(); }
  drawTimer();
}
$('wMinus').onclick = () => adjust('w', -5); $('wPlus').onclick = () => adjust('w', 5);
$('bMinus').onclick = () => adjust('b', -1); $('bPlus').onclick = () => adjust('b', 1);

// Restore after reload
if (T.running) { if (Date.now() >= T.endAt) { T.remaining = 0; finish(); if (T.running) runTimer(); } else runTimer(); }
else if (T.phase === 'ready') startNag();
drawTimer();

/* ---------- Read-aloud toggle ---------- */
function drawReadAloud() { const b = $('readAloudBtn'); b.textContent = settings.readAloud ? '🔊 Read aloud: On' : '🔇 Read aloud: Off'; b.setAttribute('aria-pressed', String(settings.readAloud)); }
$('readAloudBtn').onclick = () => { settings.readAloud = !settings.readAloud; store.set('readAloud', settings.readAloud); drawReadAloud(); if (settings.readAloud) speak('Read aloud is on.'); else try { speechSynthesis.cancel(); } catch (e) {} };
drawReadAloud();

/* ---------- Voice dictation ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recBtn = null;
function stopDictation() { if (rec) { try { rec.stop(); } catch (e) {} } }
function startDictation(btn, target) {
  if (!SR) { toast('Voice typing is not available here. Use Wispr Flow or your keyboard mic.'); target.focus(); return; }
  if (rec) { const same = recBtn === btn; stopDictation(); if (same) return; }
  try { speechSynthesis.cancel(); } catch (e) {}
  rec = new SR(); recBtn = btn;
  rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
  const base = target.value ? target.value.replace(/\s*$/, ' ') : '';
  let finalText = '';
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' '; else interim += r[0].transcript;
    }
    target.value = (base + finalText + interim).replace(/\s+/g, ' ').trimStart();
    target.dispatchEvent(new Event('input'));
  };
  let heard = false;
  rec.onaudiostart = () => toast('Listening… start talking.');
  rec.onspeechstart = () => { heard = true; };
  rec.onerror = e => {
    const msgs = {
      'not-allowed': 'Microphone is blocked. Click the lock icon next to the address and allow the mic.',
      'service-not-allowed': 'This browser blocked voice typing. Use Wispr Flow in the box instead.',
      'audio-capture': 'No microphone found. Check that the right mic is plugged in and picked in Windows sound settings.',
      'network': 'Voice typing needs the internet. Check your connection, or use Wispr Flow.',
      'no-speech': "I didn't hear anything. Check your mic, or another app may be using it."
    };
    toast((msgs[e.error] || 'Voice typing stopped (' + e.error + '). Use Wispr Flow in the box instead.'));
  };
  rec.onend = () => { btn.classList.remove('listening'); btn.setAttribute('aria-label', 'Speak'); rec = null; recBtn = null; target.value = target.value.trim(); target.dispatchEvent(new Event('change')); };
  btn.classList.add('listening'); btn.setAttribute('aria-label', 'Stop listening');
  try { rec.start(); } catch (e) { btn.classList.remove('listening'); rec = null; }
}
document.addEventListener('click', e => {
  const b = e.target.closest('.mic'); if (!b) return;
  const t = $(b.dataset.target) || b.parentElement.querySelector('input,textarea');
  if (t) startDictation(b, t);
});

/* ---------- Firebase (loaded lazily so the timer works even if it can't load) ---------- */
let fb = null, auth = null, db = null, user = null;
let unsubPlan = null, unsubEntries = null;
async function initCloud() {
  try {
    const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
    const [a, au, fs] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
    fb = { ...a, ...au, ...fs };
    const app = fb.initializeApp(firebaseConfig);
    auth = fb.getAuth(app);
    try { db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) }); }
    catch (e) { db = fb.getFirestore(app); }
    fb.getRedirectResult(auth).catch(() => {});
    fb.onAuthStateChanged(auth, u => { user = u; onUser(); });
  } catch (e) {
    $('signInBanner').hidden = true;
    $('accountBox').textContent = 'Offline: sync will start when you are back online.';
    renderLogState();
  }
}
async function signIn() {
  if (!fb) { toast('Sync is still loading. Check your internet and try again.'); return; }
  const provider = new fb.GoogleAuthProvider();
  try { await fb.signInWithPopup(auth, provider); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) { try { await fb.signInWithRedirect(auth, provider); } catch (e2) { toast('Sign-in failed: ' + (e2.code || e2.message)); } }
    else if (e.code !== 'auth/popup-closed-by-user') toast('Sign-in failed: ' + (e.code || e.message));
  }
}
$('signInBtn').onclick = signIn;

function onUser() {
  $('signInBanner').hidden = !!user;
  const box = $('accountBox'); box.innerHTML = '';
  if (user) {
    const s = document.createElement('span'); s.textContent = 'Signed in as ' + (user.email || 'you') + '. Syncing.';
    const b = document.createElement('button'); b.className = 'secondary small'; b.textContent = 'Sign out';
    b.onclick = async () => { cryptoKey = null; await fb.signOut(auth); toast('Signed out.'); };
    box.append(s, b);
  } else {
    box.textContent = 'Not signed in. Your Big 3 is saved on this device only.';
  }
  lockMeta = undefined; cryptoKey = null;
  subscribePlan(); subscribeEntries(); renderLogState();
}
const userDoc = (...p) => fb.doc(db, 'users', user.uid, ...p);
const userCol = (...p) => fb.collection(db, 'users', user.uid, ...p);

/* ---------- Day plan: Big 3, right now, other tasks ---------- */
const emptyPlan = () => ({ big3: [{ t: '', done: false }, { t: '', done: false }, { t: '', done: false }], now: '', other: [] });
let plan = store.get('plan-' + today, null) || emptyPlan();
let planTimer = null, celebratedFor = store.get('celebrated', '');
function normalizePlan(p) {
  const e = emptyPlan(); p = p || {};
  const b = Array.isArray(p.big3) ? p.big3 : [];
  return { big3: [0, 1, 2].map(i => ({ t: (b[i] && b[i].t) || '', done: !!(b[i] && b[i].done) })), now: p.now || '', other: Array.isArray(p.other) ? p.other.map(o => ({ t: o.t || '', done: !!o.done })) : e.other };
}
function savePlan(day = today, p = plan) {
  store.set('plan-' + day, p);
  if (day !== today) { pushPlan(day, p); return; }
  clearTimeout(planTimer); planTimer = setTimeout(() => pushPlan(day, p), 600);
}
function pushPlan(day, p) { if (user && db) fb.setDoc(userDoc('days', day), { ...p, updatedAt: Date.now() }).catch(() => {}); }
function subscribePlan() {
  if (unsubPlan) { unsubPlan(); unsubPlan = null; }
  plan = normalizePlan(store.get('plan-' + today, null)); renderPlan();
  if (!user) return;
  unsubPlan = fb.onSnapshot(userDoc('days', today), snap => {
    if (snap.metadata.hasPendingWrites) return;
    if (snap.exists()) { plan = normalizePlan(snap.data()); store.set('plan-' + today, plan); renderPlan(); }
    else if (plan.big3.some(b => b.t) || plan.now || plan.other.length) pushPlan(today, plan);
  }, () => {});
}
const nowText = () => plan.now.trim();

function renderPlan() {
  const wrap = $('big3'); const focused = document.activeElement;
  if (!wrap.children.length) {
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div'); row.className = 'b3row';
      const chk = document.createElement('button'); chk.className = 'check'; chk.dataset.i = i;
      const inp = document.createElement('input'); inp.type = 'text'; inp.id = 'big3-' + i; inp.placeholder = 'Must-do #' + (i + 1); inp.autocomplete = 'off';
      const mic = document.createElement('button'); mic.className = 'mic'; mic.dataset.target = inp.id; mic.textContent = '🎤'; mic.setAttribute('aria-label', 'Speak');
      inp.addEventListener('input', () => { plan.big3[i].t = inp.value; savePlan(); });
      chk.addEventListener('click', () => {
        if (!plan.big3[i].t.trim()) { toast('Add the task first.'); inp.focus(); return; }
        plan.big3[i].done = !plan.big3[i].done; savePlan(); renderPlan();
        if (plan.big3[i].done) { unlockAudio(); speak('Done. Nice work.'); checkCelebrate(); }
      });
      row.append(chk, inp, mic); wrap.appendChild(row);
    }
  }
  [...wrap.children].forEach((row, i) => {
    const b = plan.big3[i]; const inp = row.querySelector('input'); const chk = row.querySelector('.check');
    if (inp !== focused && inp.value !== b.t) inp.value = b.t;
    row.classList.toggle('done', b.done); chk.classList.toggle('done', b.done);
    chk.textContent = b.done ? '✓' : ''; chk.setAttribute('aria-label', (b.done ? 'Mark not done: ' : 'Mark done: ') + (b.t || 'must-do ' + (i + 1)));
  });
  const ni = $('nowInput'); if (ni !== focused && ni.value !== plan.now) ni.value = plan.now;
  const ul = $('otherList'); ul.innerHTML = '';
  plan.other.forEach((o, i) => {
    const li = document.createElement('li'); if (o.done) li.className = 'done';
    const chk = document.createElement('button'); chk.className = 'check' + (o.done ? ' done' : ''); chk.textContent = o.done ? '✓' : ''; chk.setAttribute('aria-label', (o.done ? 'Mark not done: ' : 'Mark done: ') + o.t);
    chk.onclick = () => { o.done = !o.done; savePlan(); renderPlan(); };
    const s = document.createElement('span'); s.textContent = o.t;
    const del = document.createElement('button'); del.className = 'linkbtn'; del.textContent = 'Remove';
    del.onclick = () => { plan.other.splice(i, 1); savePlan(); renderPlan(); };
    li.append(chk, s, del); ul.appendChild(li);
  });
}
function checkCelebrate() {
  if (plan.big3.every(b => b.t.trim() && b.done) && celebratedFor !== today) {
    celebratedFor = today; store.set('celebrated', today);
    const c = $('celebrate'); c.hidden = false; chime(); speak('All three done! Amazing work today.');
    setTimeout(() => c.hidden = true, 3500);
  }
}
$('nowInput').addEventListener('input', e => { plan.now = e.target.value; savePlan(); });
function addOther() { const i = $('otherInput'); const t = i.value.trim(); if (!t) return; plan.other.push({ t, done: false }); i.value = ''; savePlan(); renderPlan(); }
$('addOther').onclick = addOther;
$('otherInput').addEventListener('keydown', e => { if (e.key === 'Enter') addOther(); });

/* ---------- Encryption for personal entries ---------- */
let cryptoKey = null, lockMeta; // undefined = not loaded, null = no PIN set yet
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pin, saltB64) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function enc(key, text) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)); return { iv: b64(iv), ct: b64(ct) }; }
async function dec(key, o) { const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct)); return new TextDecoder().decode(pt); }
async function loadLockMeta() {
  if (lockMeta !== undefined || !user) return;
  try { const s = await fb.getDoc(userDoc('meta', 'lock')); lockMeta = s.exists() ? s.data() : null; }
  catch (e) { lockMeta = undefined; throw e; }
}

/* ---------- PIN pad ---------- */
let pin = '', pinMode = 'unlock', firstPin = '', pinResolve = null;
function drawPin() { $('pinDots').innerHTML = '<span></span>'.repeat(pin.length); }
function buildPad() {
  const pad = $('pinPad'); if (pad.children.length) return;
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].forEach(k => {
    const b = document.createElement('button'); b.textContent = k; if (k === 'OK') b.className = 'ok';
    b.setAttribute('aria-label', k === '⌫' ? 'Delete' : k);
    b.onclick = () => { if (k === '⌫') pin = pin.slice(0, -1); else if (k === 'OK') submitPin(); else if (pin.length < 8) pin += k; drawPin(); };
    pad.appendChild(b);
  });
}
function openPin(mode) {
  buildPad(); pinMode = mode; pin = ''; firstPin = ''; drawPin();
  if (mode === 'set') { $('pinTitle').textContent = 'Create a PIN'; $('pinMsg').textContent = 'Pick 4 to 8 numbers. Write it down somewhere safe. If you forget it, your personal notes cannot be recovered.'; }
  else { $('pinTitle').textContent = 'Enter your PIN'; $('pinMsg').textContent = 'Unlock your personal space.'; }
  $('pinOverlay').hidden = false;
  return new Promise(r => pinResolve = r);
}
function closePin(ok) { $('pinOverlay').hidden = true; pin = ''; if (pinResolve) { pinResolve(ok); pinResolve = null; } }
function pinError(t) { $('pinMsg').textContent = t; const box = document.querySelector('.pinbox'); box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); pin = ''; drawPin(); }
async function submitPin() {
  if (pin.length < 4) return pinError('Use at least 4 numbers.');
  if (pinMode === 'set') {
    if (!firstPin) { firstPin = pin; pin = ''; drawPin(); $('pinTitle').textContent = 'Enter it again'; $('pinMsg').textContent = 'Type the same PIN to confirm.'; return; }
    if (pin !== firstPin) { firstPin = ''; $('pinTitle').textContent = 'Create a PIN'; return pinError("Those didn't match. Start again."); }
    $('pinMsg').textContent = 'Setting up your lock…';
    try {
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      const key = await deriveKey(pin, salt);
      const check = await enc(key, 'focus-ok');
      lockMeta = { salt, check, v: 1 };
      await fb.setDoc(userDoc('meta', 'lock'), lockMeta);
      cryptoKey = key; closePin(true); toast('Personal space locked with your PIN.');
    } catch (e) { pinError('Could not save your PIN. Check your connection and try again.'); }
  } else {
    $('pinMsg').textContent = 'Checking…';
    try { const key = await deriveKey(pin, lockMeta.salt); if (await dec(key, lockMeta.check) !== 'focus-ok') throw 0; cryptoKey = key; closePin(true); }
    catch (e) { pinError("That PIN didn't match. Try again."); }
  }
}
$('pinCancel').onclick = () => closePin(false);
document.addEventListener('keydown', e => {
  if ($('pinOverlay').hidden) return;
  if (/^[0-9]$/.test(e.key) && pin.length < 8) { pin += e.key; drawPin(); }
  else if (e.key === 'Backspace') { pin = pin.slice(0, -1); drawPin(); }
  else if (e.key === 'Enter') submitPin();
  else if (e.key === 'Escape') closePin(false);
});
async function unlockPersonal() {
  if (!user) { toast('Sign in first to use your personal space.'); return false; }
  if (cryptoKey) return true;
  try { await loadLockMeta(); } catch (e) { toast('Could not reach your account. Check your connection.'); return false; }
  const ok = await openPin(lockMeta ? 'unlock' : 'set');
  renderLogState();
  return ok;
}
function lockNow() { cryptoKey = null; decrypted.clear(); renderLogState(); toast('Personal space locked.'); }
$('lockBtn').onclick = lockNow;
$('unlockBtn').onclick = unlockPersonal;

/* ---------- Spaces ---------- */
function drawSpace() {
  $('spaceWork').classList.toggle('on', space === 'work'); $('spaceWork').setAttribute('aria-pressed', String(space === 'work'));
  $('spacePersonal').classList.toggle('on', space === 'personal'); $('spacePersonal').setAttribute('aria-pressed', String(space === 'personal'));
  $('logCard').classList.toggle('personal', space === 'personal');
  $('logTitle').textContent = space === 'work' ? 'Work log' : 'Personal log';
}
$('spaceWork').onclick = () => { space = 'work'; store.set('space', space); drawSpace(); renderLogState(); };
$('spacePersonal').onclick = async () => { space = 'personal'; store.set('space', space); drawSpace(); renderLogState(); if (user && !cryptoKey) await unlockPersonal(); };

/* ---------- Log ---------- */
let kind = 'did', entries = [];
const decrypted = new Map();
function setKind(k) { kind = k; $('kindDid').classList.toggle('on', k === 'did'); $('kindIdea').classList.toggle('on', k === 'idea'); $('kindDid').setAttribute('aria-pressed', String(k === 'did')); $('kindIdea').setAttribute('aria-pressed', String(k === 'idea')); }
$('kindDid').onclick = () => setKind('did'); $('kindIdea').onclick = () => setKind('idea');

function subscribeEntries() {
  if (unsubEntries) { unsubEntries(); unsubEntries = null; }
  entries = []; decrypted.clear();
  if (!user) { renderLog(); return; }
  unsubEntries = fb.onSnapshot(fb.query(userCol('entries'), fb.where('day', '==', today)), snap => {
    entries = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderLog();
  }, () => {});
}
function renderLogState() {
  const needSignIn = !user, locked = space === 'personal' && !cryptoKey && !!user;
  $('logNeedsSignIn').hidden = !needSignIn;
  $('logLocked').hidden = !locked;
  $('logBody').hidden = needSignIn || locked;
  $('lockBtn').hidden = !(space === 'personal' && cryptoKey);
  renderLog();
}
async function renderLog() {
  const list = $('logList'); list.innerHTML = '';
  const mine = entries.filter(e => e.space === space).sort((a, b) => b.ts - a.ts);
  $('logEmpty').hidden = mine.length > 0;
  for (const e of mine) {
    const li = document.createElement('li'); li.className = e.kind;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.append(Object.assign(document.createElement('span'), { textContent: fmtClock(e.ts) }), Object.assign(document.createElement('span'), { textContent: e.kind === 'idea' ? '💡 Idea' : '✅ I did' }));
    const del = document.createElement('button'); del.className = 'linkbtn'; del.textContent = 'Remove';
    del.onclick = () => {
      if (del.dataset.armed) { fb.deleteDoc(userDoc('entries', e.id)).catch(() => toast('Could not remove it. Try again.')); }
      else { del.dataset.armed = '1'; del.textContent = 'Tap again to remove'; setTimeout(() => { delete del.dataset.armed; del.textContent = 'Remove'; }, 4000); }
    };
    meta.appendChild(del);
    const text = document.createElement('div'); text.className = 'text';
    if (e.space === 'personal') {
      if (decrypted.has(e.id)) text.textContent = decrypted.get(e.id);
      else if (cryptoKey) { text.textContent = '…'; dec(cryptoKey, e).then(t => { decrypted.set(e.id, t); text.textContent = t; }).catch(() => text.textContent = '🔒 Could not unlock this entry.'); }
      else text.textContent = '🔒 Locked';
    } else text.textContent = e.text;
    li.append(meta, text); list.appendChild(li);
  }
}
$('saveLog').onclick = async () => {
  stopDictation();
  const t = $('logText').value.trim();
  if (!t) { toast('Say or type something first.'); return; }
  if (!user) { toast('Sign in to save to your log.'); return; }
  const data = { space, kind, day: today, ts: Date.now(), createdAt: fb.serverTimestamp() };
  try {
    if (space === 'personal') { if (!cryptoKey && !(await unlockPersonal())) return; Object.assign(data, await enc(cryptoKey, t)); }
    else data.text = t;
    fb.addDoc(userCol('entries'), data).catch(() => toast('Saved on this device. It will sync when you are online.'));
    $('logText').value = ''; toast(kind === 'idea' ? 'Idea saved.' : 'Saved.'); speak(kind === 'idea' ? 'Idea saved.' : 'Saved.');
  } catch (e) { toast('Could not save. Try again.'); }
};

/* ---------- Backup ---------- */
$('backupBtn').onclick = async () => {
  if (!user) { toast('Sign in first.'); return; }
  try {
    const snap = await fb.getDocs(userCol('entries'));
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.ts - b.ts);
    const lines = ['Focus log, downloaded ' + new Date().toLocaleString(), ''];
    let lockedCount = 0;
    for (const e of all) {
      let t = e.text;
      if (e.space === 'personal') { if (cryptoKey) { try { t = await dec(cryptoKey, e); } catch (x) { t = '[could not unlock]'; } } else { t = '[locked: unlock Personal to include]'; lockedCount++; } }
      lines.push(`${e.day}  ${fmtClock(e.ts)}  ${e.space === 'personal' ? 'Personal' : 'Work'}  ${e.kind === 'idea' ? 'Idea' : 'I did'}: ${t}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'focus-log-' + today + '.txt';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(lockedCount ? `Downloaded. ${lockedCount} personal entries stayed locked.` : 'Downloaded your log.');
  } catch (e) { toast('Could not download. Check your connection.'); }
};

/* ---------- Print today's sheet ---------- */
$('printBtn').onclick = () => {
  const s = $('printSheet'); s.innerHTML = '';
  const add = (tag, text, cls) => { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; s.appendChild(el); return el; };
  add('h1', 'My day');
  add('div', new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
  add('h2', "Today's Big 3");
  plan.big3.forEach((b, i) => { const r = add('div', '', 'pbox'); r.append(Object.assign(document.createElement('span'), { className: 'sq' }), document.createTextNode(b.t || 'Must-do #' + (i + 1) + ': ________________')); });
  if (plan.other.length) { add('h2', 'Other tasks'); plan.other.forEach(o => { const r = add('div', '', 'pbox'); r.append(Object.assign(document.createElement('span'), { className: 'sq' }), document.createTextNode(o.t)); }); }
  add('h2', 'Notes');
  for (let i = 0; i < 5; i++) add('div', '', 'line');
  window.print();
};

/* ---------- Check-in reminder and day start ---------- */
$('stopTime').value = settings.stopTime;
$('stopTime').addEventListener('change', e => { settings.stopTime = e.target.value || '17:30'; store.set('stopTime', settings.stopTime); store.set('stopShown', ''); });
function drawCheckin() { const b = $('checkinBtn'); b.textContent = settings.checkinOn ? 'On' : 'Off'; b.setAttribute('aria-pressed', String(settings.checkinOn)); $('stopTime').disabled = !settings.checkinOn; }
$('checkinBtn').onclick = () => { settings.checkinOn = !settings.checkinOn; store.set('checkinOn', settings.checkinOn); drawCheckin(); };
drawCheckin();
const ds = $('dayStart');
for (let h = 0; h <= 8; h++) { const o = document.createElement('option'); o.value = h; o.textContent = h === 0 ? '12 AM (midnight)' : h + ' AM'; ds.appendChild(o); }
ds.value = String(dayStartHour());
ds.addEventListener('change', () => { store.set('dayStart', Number(ds.value)); toast('Your day now starts at ' + ds.options[ds.selectedIndex].text + '.'); clock(); });
function checkStop() {
  if (!settings.checkinOn || store.get('stopShown', '') === today) return;
  const [h, m] = settings.stopTime.split(':').map(Number); const n = new Date();
  const st = dayStartHour() * 60, rel = x => ((x - st) % 1440 + 1440) % 1440;
  if (rel(n.getHours() * 60 + n.getMinutes()) >= rel(h * 60 + m)) {
    store.set('stopShown', today);
    $('stopBanner').hidden = false;
    const when = n.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    alertUser('Check-in time', "It's " + when + ". How's your Big 3? Keep working if you want.", "It's " + when + ". Check-in time. How is your Big 3 going? You can keep working if you want.");
  }
}
$('closeStop').onclick = () => $('stopBanner').hidden = true;
$('moveBtn').onclick = () => {
  const left = plan.big3.filter(b => b.t.trim() && !b.done).map(b => b.t);
  if (!left.length) { toast('All done. Nothing to move!'); $('stopBanner').hidden = true; return; }
  const tk = dayKey(new Date(Date.now() + 24 * 3600000));
  const next = normalizePlan(store.get('plan-' + tk, null));
  for (const item of left) {
    const slot = next.big3.find(b => !b.t.trim());
    if (slot) slot.t = item; else next.other.push({ t: item, done: false });
  }
  savePlan(tk, next);
  $('stopBanner').hidden = true; toast(`Moved ${left.length} to tomorrow.`);
};

/* ---------- Clock, day change ---------- */
function clock() {
  const n = new Date();
  $('clockTime').textContent = n.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('clockDay').textContent = n.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const k = dayKey(n);
  if (k !== today) { today = k; counts = { day: today, n: 0 }; store.set('counts', counts); subscribePlan(); subscribeEntries(); drawTimer(); }
  if (n.getSeconds() % 20 === 0) checkStop();
}
clock(); setInterval(clock, 1000); checkStop();

/* ---------- Auto-lock personal after 15 minutes away ---------- */
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else {
    if (cryptoKey && hiddenAt && Date.now() - hiddenAt > 15 * 60 * 1000) { cryptoKey = null; decrypted.clear(); renderLogState(); }
    if (T.running) { keepAwake(); loop(); }
    clock();
  }
});

/* ---------- Alerts permission ---------- */
function drawAlerts() {
  const b = $('alertsBtn');
  if (!('Notification' in window)) { b.textContent = 'Not available'; b.disabled = true; return; }
  b.textContent = Notification.permission === 'granted' ? 'Alerts on' : Notification.permission === 'denied' ? 'Blocked in browser settings' : 'Turn on alerts';
  b.disabled = Notification.permission !== 'default';
}
$('alertsBtn').onclick = async () => { try { await Notification.requestPermission(); } catch (e) {} drawAlerts(); };
drawAlerts();

/* ---------- Install + offline ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('installBtn').hidden = false; });
$('installBtn').onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => {}); deferredPrompt = null; $('installBtn').hidden = true; };
window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; toast('Installed!'); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(r => swReg = r).catch(() => {});

drawSpace(); renderPlan(); renderLogState();
initCloud();
