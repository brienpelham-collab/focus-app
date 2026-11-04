// Hourly check for the Focus app. Runs on GitHub Actions.
// For each signed-in user it reads their status and, when it fits their settings,
// sends a pop-up to their phone and computer:
//  - a nudge if they haven't used the app in an hour (inside their nudge hours),
//  - an end-of-day check-in at their check-in time.
// Needs the FIREBASE_SERVICE_ACCOUNT secret (the private key JSON from Firebase).
import admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) { console.error('FIREBASE_SERVICE_ACCOUNT secret is missing.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const fcm = admin.messaging();
const TEST = process.env.NUDGE_TEST === 'true'; // manual test run: send one test pop-up to everyone

const HOUR = 3600 * 1000;
const z = n => String(n).padStart(2, '0');
function localParts(tz, now) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
// Same "day" rule as the app: the day rolls over at dayStart (default 4 AM).
function dayKey(tz, now, dayStart) {
  const p = localParts(tz, new Date(now.getTime() - dayStart * HOUR));
  return p.y + '-' + z(p.mo) + '-' + z(p.d);
}

async function sendTo(uid, title, body, tag) {
  const snap = await db.collection('users').doc(uid).collection('tokens').get();
  const tokens = snap.docs.map(d => d.id);
  if (!tokens.length) return 0;
  const res = await fcm.sendEachForMulticast({
    tokens,
    data: { title, body, tag },
    webpush: { headers: { Urgency: 'high', TTL: '3600' } }
  });
  // Remove tokens for devices that are gone.
  await Promise.all(res.responses.map((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      return db.collection('users').doc(uid).collection('tokens').doc(tokens[i]).delete();
    }
  }));
  return res.successCount;
}

const now = new Date();
const users = await db.collection('users').listDocuments();
let sent = 0;
for (const u of users) {
  const statusRef = u.collection('meta').doc('status');
  const snap = await statusRef.get();
  if (!snap.exists) continue;
  const s = snap.data();
  const tz = s.tz || 'America/Los_Angeles';
  const t = localParts(tz, now);
  const today = dayKey(tz, now, s.dayStart ?? 4);
  const sameDay = s.focusDay === today;
  const focusMin = sameDay ? (s.focusMin || 0) : 0;
  const rest = sameDay && s.restDay === true;
  const goal = s.goalMin || 480;
  const hrs = Math.floor(focusMin / 60) + ' h ' + (focusMin % 60) + ' m';

  if (TEST) { sent += await sendTo(u.id, 'Focus test', 'Pop-ups work, even with the app closed.', 'focus-test'); continue; }

  // End-of-day check-in, once, in the hour after the check-in time.
  if (s.checkinOn !== false && s.eodDay !== today) {
    const [ch, cm] = String(s.stopTime || '20:00').split(':').map(Number);
    const mins = t.h * 60 + t.mi, start = ch * 60 + (cm || 0);
    if (mins >= start && mins < start + 60) {
      let big = '';
      const day = await u.collection('days').doc(today).get();
      if (day.exists) {
        const b3 = (day.data().big3 || []).filter(b => b && b.t && b.t.trim());
        if (b3.length) big = ' Big 3: ' + b3.filter(b => b.done).length + ' of ' + b3.length + ' done.';
      }
      sent += await sendTo(u.id, 'End of your workday', 'Did you get your Big 3 done?' + big + ' Focus today: ' + hrs + '.', 'focus-eod');
      await statusRef.set({ eodDay: today }, { merge: true });
      continue;
    }
  }

  // Hourly nudge.
  const startH = s.nudgeStart ?? 8, endH = s.nudgeEnd ?? 20;
  if (s.nudgeOn === false || rest || focusMin >= goal) continue;
  if (t.h < startH || t.h >= endH) continue;
  const last = Math.max(s.lastWork || 0, s.lastActive || 0, s.serverNudgeAt || 0);
  if (now.getTime() - last < 55 * 60 * 1000) continue;
  sent += await sendTo(u.id, 'Time for a focus block?', 'Just 5 minutes. Pick one small thing. Focus today: ' + hrs + '.', 'focus-nudge');
  await statusRef.set({ serverNudgeAt: now.getTime() }, { merge: true });
}
console.log('Checked ' + users.length + ' user(s). Pop-ups sent: ' + sent + '.');
