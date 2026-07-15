// device.js — link to the FutureMe bedside unit over Web Bluetooth.
//
// The hardware is the guarantee layer: a mains-powered speaker + mic that
// stores alarms and audio locally, so reminders fire even when the phone is
// dead, silenced, or in another room. Full GATT protocol spec lives in
// docs/DEVICE_PROTOCOL.md — the UUIDs and framing here match it.
//
// Browsers without Web Bluetooth (iOS Safari, Firefox) fall back to a
// simulated device so the whole flow stays demoable end-to-end.

const SERVICE_UUID        = 'f0ba0001-6c1f-4b3a-9c8e-2d7a1a5c9e01';
const CHAR_ALARM_META     = 'f0ba0002-6c1f-4b3a-9c8e-2d7a1a5c9e01'; // write: alarm header JSON
const CHAR_AUDIO_CHUNK    = 'f0ba0003-6c1f-4b3a-9c8e-2d7a1a5c9e01'; // write: audio payload chunks
const CHAR_EVENTS         = 'f0ba0004-6c1f-4b3a-9c8e-2d7a1a5c9e01'; // notify: acks & outcomes from device
const CHUNK_SIZE          = 480; // fits a 512-byte GATT write with headroom

export class DeviceLink extends EventTarget {
  constructor() {
    super();
    this.gatt = null;
    this.chars = {};
    this.simulated = false;
    this.connected = false;
  }

  get supportsRealHardware() {
    return !!navigator.bluetooth;
  }

  async connect() {
    if (this.supportsRealHardware) {
      try {
        await this.connectBluetooth();
        return;
      } catch (err) {
        // User cancelled the chooser → stay disconnected, don't fake it.
        if (err && err.name === 'NotFoundError') throw err;
        // Anything else (no adapter, flag off) → simulator.
      }
    }
    this.connectSimulator();
  }

  async connectBluetooth() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    });
    device.addEventListener('gattserverdisconnected', () => this.handleDisconnect());
    this.gatt = await device.gatt.connect();
    const service = await this.gatt.getPrimaryService(SERVICE_UUID);
    this.chars.meta = await service.getCharacteristic(CHAR_ALARM_META);
    this.chars.audio = await service.getCharacteristic(CHAR_AUDIO_CHUNK);
    this.chars.events = await service.getCharacteristic(CHAR_EVENTS);
    await this.chars.events.startNotifications();
    this.chars.events.addEventListener('characteristicvaluechanged', e => {
      this.handleDeviceEvent(new TextDecoder().decode(e.target.value));
    });
    this.simulated = false;
    this.connected = true;
    this.dispatchEvent(new CustomEvent('status', { detail: { connected: true, simulated: false } }));
  }

  connectSimulator() {
    this.simulated = true;
    this.connected = true;
    this.dispatchEvent(new CustomEvent('status', { detail: { connected: true, simulated: true } }));
  }

  handleDisconnect() {
    this.connected = false;
    this.gatt = null;
    this.chars = {};
    this.dispatchEvent(new CustomEvent('status', { detail: { connected: false, simulated: false } }));
  }

  disconnect() {
    if (this.gatt) this.gatt.disconnect();
    this.connected = false;
    this.simulated = false;
    this.dispatchEvent(new CustomEvent('status', { detail: { connected: false, simulated: false } }));
  }

  // Device tells us what happened at the bedside ("user pressed DONE at
  // 07:31") so outcomes get logged even for alarms the phone never saw fire.
  handleDeviceEvent(json) {
    try {
      const evt = JSON.parse(json); // {type:'resolved', alarmId, action, snoozes}
      this.dispatchEvent(new CustomEvent('deviceEvent', { detail: evt }));
    } catch { /* malformed frame from device; ignore */ }
  }

  // Push one alarm (header + audio) to the unit.
  async syncAlarm(alarm) {
    if (!this.connected) throw new Error('No device connected');

    if (this.simulated) {
      await new Promise(r => setTimeout(r, 400)); // pretend to transfer
      return true;
    }

    const audioBuf = new Uint8Array(await alarm.audio.arrayBuffer());
    const header = {
      op: 'alarm.put',
      id: alarm.id,
      fireAt: alarm.fireAt,          // unix ms; device keeps its own RTC
      transcript: alarm.transcript.slice(0, 200),
      audioBytes: audioBuf.length,
      audioMime: alarm.audio.type,
    };
    await this.chars.meta.writeValueWithResponse(new TextEncoder().encode(JSON.stringify(header)));

    for (let off = 0; off < audioBuf.length; off += CHUNK_SIZE) {
      await this.chars.audio.writeValueWithResponse(audioBuf.subarray(off, off + CHUNK_SIZE));
    }
    return true;
  }

  async removeAlarm(alarmId) {
    if (!this.connected || this.simulated) return;
    const frame = JSON.stringify({ op: 'alarm.delete', id: alarmId });
    await this.chars.meta.writeValueWithResponse(new TextEncoder().encode(frame));
  }
}
