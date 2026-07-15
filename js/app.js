// app.js — glue. One-button capture → parse → arm → fire → learn.

import { VoiceCapture } from './recorder.js';
import { parseTimeFromText, hasReason, categorize } from './timeparse.js';
import { AlarmEngine } from './alarms.js';
import { DeviceLink } from './device.js';
import { store } from './store.js';
import { computeInsights, renderInsights } from './insights.js';

const $ = id => document.getElementById(id);

const engine = new AlarmEngine();
const device = new DeviceLink();
let capture = null;
let pending = null;        // {blob, transcript, fireAt} awaiting arm
let autoArmTimer = null;
let firingAlarm = null;
let audioUrl = null;

// ---------------------------------------------------------------- tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.view').forEach(v =>
      v.classList.toggle('active', v.id === 'view-' + tab.dataset.view));
    if (tab.dataset.view === 'insights') refreshInsights();
  });
});

// ---------------------------------------------------------------- capture
const micBtn = $('micBtn');
let recording = false;

async function startRecording() {
  if (recording || pending) return;
  recording = true;
  document.querySelector('.mic-wrap').classList.add('recording');
  $('captureHint').textContent = 'Listening… release when you\'re done.';
  $('liveTranscript').hidden = false;
  $('liveTranscript').textContent = '';
  capture = new VoiceCapture({
    onTranscript: t => { $('liveTranscript').textContent = t; },
  });
  try {
    await capture.start();
  } catch (err) {
    recording = false;
    document.querySelector('.mic-wrap').classList.remove('recording');
    $('captureHint').textContent = 'Mic blocked. Allow microphone access and try again.';
  }
}

async function stopRecording() {
  if (!recording) return;
  recording = false;
  document.querySelector('.mic-wrap').classList.remove('recording');
  const { blob, transcript, durationMs } = await capture.stop();
  $('liveTranscript').hidden = true;
  $('captureHint').innerHTML = 'Hold the button. Tell future-you <em>what</em>, <em>when</em>, and <em>why it matters</em>.';

  if (durationMs < 600 || blob.size === 0) return; // accidental tap

  const fireAt = parseTimeFromText(transcript);
  pending = { blob, transcript, fireAt };
  showConfirm();
}

// Hold-to-talk on touch & mouse; also works as tap-to-start/tap-to-stop.
micBtn.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (recording) stopRecording(); else startRecording();
});
micBtn.addEventListener('pointerup', e => {
  e.preventDefault();
  // Treat a long hold as push-to-talk: release ends it. A quick tap toggles.
  if (recording && capture && Date.now() - capture.startedAt > 900) stopRecording();
});

// ---------------------------------------------------------------- confirm card
function fmtTime(d) {
  const today = new Date(); const target = new Date(d);
  const sameDay = target.toDateString() === today.toDateString();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const isTomorrow = target.toDateString() === tomorrow.toDateString();
  const hm = target.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return hm + ' today';
  if (isTomorrow) return hm + ' tomorrow';
  return target.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + hm;
}

function fmtUntil(d) {
  const mins = Math.round((d - Date.now()) / 60000);
  if (mins < 60) return `in ${mins} min`;
  if (mins < 60 * 24) return `in ${Math.round(mins / 60 * 10) / 10} hrs`;
  return `in ${Math.round(mins / 1440)} days`;
}

function showConfirm() {
  $('confirmCard').hidden = false;
  $('confirmTranscript').textContent = pending.transcript ? `“${pending.transcript}”` : '(voice-only reminder — no transcript available)';
  if (pending.fireAt) {
    $('confirmTime').textContent = fmtTime(pending.fireAt);
    $('confirmCountdownNote').textContent = fmtUntil(pending.fireAt);
    $('timeChips').hidden = true;
    startAutoArm();
  } else {
    // Speech had no time in it (or no transcript). One more tap: pick a chip.
    $('confirmTime').textContent = 'When?';
    $('confirmCountdownNote').textContent = '';
    $('timeChips').hidden = false;
  }
}

// The zero-extra-clicks path: parsed a time → arms itself in 5s unless touched.
function startAutoArm() {
  let left = 5;
  $('autoArmCount').textContent = `(${left})`;
  clearInterval(autoArmTimer);
  autoArmTimer = setInterval(() => {
    left--;
    if (left <= 0) { arm(); return; }
    $('autoArmCount').textContent = `(${left})`;
  }, 1000);
}
function cancelAutoArm() {
  clearInterval(autoArmTimer);
  $('autoArmCount').textContent = '';
}

$('editTimeBtn').addEventListener('click', () => {
  cancelAutoArm();
  $('timeChips').hidden = false;
});

$('timeChips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip || chip.id === 'customTime') return;
  cancelAutoArm();
  const now = new Date();
  if (chip.dataset.mins) {
    pending.fireAt = new Date(now.getTime() + parseInt(chip.dataset.mins, 10) * 60000);
  } else if (chip.dataset.preset === 'tonight') {
    pending.fireAt = new Date(now); pending.fireAt.setHours(21, 0, 0, 0);
    if (pending.fireAt <= now) pending.fireAt.setDate(pending.fireAt.getDate() + 1);
  } else if (chip.dataset.preset === 'tomorrow') {
    pending.fireAt = new Date(now); pending.fireAt.setDate(now.getDate() + 1);
    pending.fireAt.setHours(7, 0, 0, 0);
  }
  $('confirmTime').textContent = fmtTime(pending.fireAt);
  $('confirmCountdownNote').textContent = fmtUntil(pending.fireAt);
});

$('customTime').addEventListener('change', e => {
  cancelAutoArm();
  const d = new Date(e.target.value);
  if (!isNaN(d) && d > new Date()) {
    pending.fireAt = d;
    $('confirmTime').textContent = fmtTime(d);
    $('confirmCountdownNote').textContent = fmtUntil(d);
  }
});

$('armBtn').addEventListener('click', arm);
$('discardBtn').addEventListener('click', () => { cancelAutoArm(); hideConfirm(); });

function hideConfirm() {
  pending = null;
  $('confirmCard').hidden = true;
  $('timeChips').hidden = true;
}

async function arm() {
  cancelAutoArm();
  if (!pending || !pending.fireAt) { $('timeChips').hidden = false; return; }
  const alarm = await engine.add({
    blob: pending.blob,
    transcript: pending.transcript,
    fireAt: pending.fireAt,
    category: categorize(pending.transcript),
    hasReason: hasReason(pending.transcript),
  });
  hideConfirm();
  AlarmEngine.requestNotificationPermission();
  if (device.connected) syncToDevice(alarm);
  $('captureHint').innerHTML = `Armed for <em>${fmtTime(new Date(alarm.fireAt))}</em>. Future-you will hear it.`;
  setTimeout(() => {
    $('captureHint').innerHTML = 'Hold the button. Tell future-you <em>what</em>, <em>when</em>, and <em>why it matters</em>.';
  }, 4000);
}

// ---------------------------------------------------------------- alarm list
async function refreshList() {
  const alarms = await engine.armed();
  const ul = $('alarmList');
  ul.innerHTML = '';
  $('alarmsEmpty').hidden = alarms.length > 0;
  $('armedCount').hidden = alarms.length === 0;
  $('armedCount').textContent = alarms.length;
  for (const a of alarms) {
    const li = document.createElement('li');
    li.className = 'alarm-item';
    li.innerHTML = `
      <div class="time">${fmtTime(new Date(a.fireAt)).replace(' today', '')}</div>
      <div class="meta">
        <div class="cat">${a.category}${a.syncedToDevice ? ' <span class="synced">· on device</span>' : ''}</div>
        <div class="transcript"></div>
      </div>
      <button class="play" title="Preview">▶</button>
      <button class="del" title="Delete">✕</button>`;
    li.querySelector('.transcript').textContent = a.transcript;
    li.querySelector('.play').addEventListener('click', () => previewAudio(a));
    li.querySelector('.del').addEventListener('click', async () => {
      await engine.remove(a.id);
      if (device.connected) device.removeAlarm(a.id).catch(() => {});
    });
    ul.appendChild(li);
  }
}

function previewAudio(alarm) {
  const player = $('player');
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(alarm.audio);
  player.src = audioUrl;
  player.loop = false;
  player.play().catch(() => {});
}

engine.addEventListener('change', refreshList);

// ---------------------------------------------------------------- firing
engine.addEventListener('fire', e => presentFiring(e.detail));

function presentFiring(alarm) {
  if (firingAlarm) return; // one at a time; the next stays 'firing' in DB and shows on resolve
  firingAlarm = alarm;
  $('firingTranscript').textContent = alarm.transcript;
  $('firing').hidden = false;
  const player = $('player');
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(alarm.audio);
  player.src = audioUrl;
  player.loop = true;
  player.play().catch(() => {
    // Autoplay may be blocked until a gesture; the replay button covers it.
  });
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 800]);
}

async function closeFiring() {
  $('firing').hidden = true;
  const player = $('player');
  player.pause();
  player.loop = false;
  firingAlarm = null;
  // If another alarm fired while this one was on screen, show it now.
  const queued = await engine.firing();
  if (queued.length) presentFiring(queued[0]);
}

$('doneBtn').addEventListener('click', async () => {
  await engine.resolve(firingAlarm.id, 'done');
  closeFiring();
});
$('snoozeBtn').addEventListener('click', async () => {
  await engine.snooze(firingAlarm.id);
  closeFiring();
});
$('replayBtn').addEventListener('click', () => { $('player').play().catch(() => {}); });

// ---------------------------------------------------------------- device
const deviceBtn = $('deviceBtn');
deviceBtn.addEventListener('click', async () => {
  if (device.connected) { device.disconnect(); return; }
  $('deviceLabel').textContent = 'Connecting…';
  $('deviceDot').className = 'dot dot-sync';
  try {
    await device.connect();
  } catch {
    $('deviceLabel').textContent = 'No device';
    $('deviceDot').className = 'dot dot-off';
  }
});

device.addEventListener('status', async e => {
  const { connected, simulated } = e.detail;
  $('deviceDot').className = 'dot ' + (connected ? 'dot-on' : 'dot-off');
  $('deviceLabel').textContent = connected ? (simulated ? 'Device (sim)' : 'Device linked') : 'No device';
  if (connected) {
    // Push everything armed so the hardware can fire without the phone.
    for (const a of await engine.armed()) {
      if (!a.syncedToDevice) syncToDevice(a);
    }
  }
});

async function syncToDevice(alarm) {
  $('deviceDot').className = 'dot dot-sync';
  try {
    await device.syncAlarm(alarm);
    alarm.syncedToDevice = true;
    await store.putAlarm(alarm);
    refreshList();
  } catch { /* stays unsynced; retried on next connect */ }
  $('deviceDot').className = 'dot ' + (device.connected ? 'dot-on' : 'dot-off');
}

// Bedside unit resolved an alarm itself → log the outcome here too.
device.addEventListener('deviceEvent', async e => {
  const evt = e.detail;
  if (evt.type === 'resolved' && evt.alarmId) {
    await engine.resolve(evt.alarmId, evt.action === 'done' ? 'done' : 'missed', { resolvedOn: 'device' });
  }
});

// ---------------------------------------------------------------- insights
async function refreshInsights() {
  renderInsights($('insightsBody'), computeInsights(await store.allOutcomes()));
}

// ---------------------------------------------------------------- boot
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
engine.start();
refreshList();
// Anything that was mid-fire when the app was closed comes back immediately.
engine.firing().then(list => { if (list.length) presentFiring(list[0]); });
