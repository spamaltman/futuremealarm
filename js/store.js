// store.js — IndexedDB persistence. Audio blobs live here too, so reminders
// survive refreshes, restarts, and days of being ignored.

const DB_NAME = 'futureme';
const DB_VERSION = 1;

let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        // alarms: {id, fireAt, transcript, category, hasReason, audio(Blob),
        //          createdAt, status:'armed'|'firing'|'done', snoozes, syncedToDevice}
        d.createObjectStore('alarms', { keyPath: 'id' });
        // outcomes: one row per resolved alarm — the analytics raw material.
        // {id, alarmId, category, hasReason, hourOfDay, scheduledFor, resolvedAt,
        //  action:'done'|'missed', snoozes, secondsToAck, resolvedOn:'app'|'device'}
        d.createObjectStore('outcomes', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
  }));
}

export const store = {
  async putAlarm(alarm) { return tx('alarms', 'readwrite', s => s.put(alarm)); },
  async deleteAlarm(id) { return tx('alarms', 'readwrite', s => s.delete(id)); },
  async getAlarm(id) {
    const d = await db();
    return new Promise((res, rej) => {
      const r = d.transaction('alarms').objectStore('alarms').get(id);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async allAlarms() {
    const d = await db();
    return new Promise((res, rej) => {
      const r = d.transaction('alarms').objectStore('alarms').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  },
  async putOutcome(o) { return tx('outcomes', 'readwrite', s => s.put(o)); },
  async allOutcomes() {
    const d = await db();
    return new Promise((res, rej) => {
      const r = d.transaction('outcomes').objectStore('outcomes').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  },
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
