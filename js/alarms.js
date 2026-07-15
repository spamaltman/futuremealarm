// alarms.js — the scheduler. Alarms must fire without future-you doing
// anything, so we layer every mechanism the platform gives us:
//   1. in-app timer (app open in foreground/background tab)
//   2. system notifications via the service worker (app closed, phone on)
//   3. the physical bedside device (phone dead/silenced — see device.js)

import { store, uid } from './store.js';

const SNOOZE_MS = 5 * 60 * 1000;

export class AlarmEngine extends EventTarget {
  constructor() {
    super();
    this.timer = null;
  }

  start() {
    // A 1s tick is cheap and means alarms are never late by more than a beat.
    this.timer = setInterval(() => this.check(), 1000);
    this.check();
  }

  async check() {
    const now = Date.now();
    const alarms = await store.allAlarms();
    for (const a of alarms) {
      if (a.status === 'armed' && a.fireAt <= now) {
        a.status = 'firing';
        a.firedAt = now;
        await store.putAlarm(a);
        this.dispatchEvent(new CustomEvent('fire', { detail: a }));
        this.notify(a);
      }
    }
  }

  async add({ blob, transcript, fireAt, category, hasReason }) {
    const alarm = {
      id: uid(),
      fireAt: fireAt.getTime(),
      transcript: transcript || '(voice only)',
      category,
      hasReason,
      audio: blob,
      createdAt: Date.now(),
      status: 'armed',
      snoozes: 0,
      syncedToDevice: false,
    };
    await store.putAlarm(alarm);
    this.dispatchEvent(new CustomEvent('change'));
    return alarm;
  }

  async snooze(id) {
    const a = await store.getAlarm(id);
    if (!a) return;
    a.status = 'armed';
    a.snoozes += 1;
    a.fireAt = Date.now() + SNOOZE_MS;
    await store.putAlarm(a);
    this.dispatchEvent(new CustomEvent('change'));
    return a;
  }

  // Resolve an alarm and write the outcome row that powers Insights.
  // action: 'done' (they acted) | 'missed' (dismissed without acting / expired)
  async resolve(id, action, { resolvedOn = 'app' } = {}) {
    const a = await store.getAlarm(id);
    if (!a) return;
    const now = Date.now();
    await store.putOutcome({
      id: uid(),
      alarmId: a.id,
      category: a.category,
      hasReason: a.hasReason,
      hourOfDay: new Date(a.fireAt).getHours(),
      scheduledFor: a.fireAt,
      resolvedAt: now,
      action,
      snoozes: a.snoozes,
      secondsToAck: a.firedAt ? Math.round((now - a.firedAt) / 1000) : null,
      resolvedOn,
    });
    await store.deleteAlarm(a.id);
    this.dispatchEvent(new CustomEvent('change'));
  }

  async remove(id) {
    await store.deleteAlarm(id);
    this.dispatchEvent(new CustomEvent('change'));
  }

  async armed() {
    const alarms = await store.allAlarms();
    return alarms.filter(a => a.status === 'armed').sort((x, y) => x.fireAt - y.fireAt);
  }

  async firing() {
    const alarms = await store.allAlarms();
    return alarms.filter(a => a.status === 'firing').sort((x, y) => x.fireAt - y.fireAt);
  }

  // Best-effort system notification so a closed tab still yells.
  async notify(alarm) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const opts = {
        body: alarm.transcript,
        tag: alarm.id,
        requireInteraction: true,
        vibrate: [400, 150, 400, 150, 800],
      };
      if (reg) reg.showNotification('⏰ Message from past you', opts);
      else new Notification('⏰ Message from past you', opts);
    } catch { /* notifications are a bonus layer, never fatal */ }
  }

  static async requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch {}
    }
  }
}
