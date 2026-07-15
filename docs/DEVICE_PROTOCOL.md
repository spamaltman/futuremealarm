# FutureMe Bedside Device — BLE Protocol v0.1

The bedside unit is the guarantee layer of the product: a mains-powered
speaker + microphone with its own real-time clock and local storage. Once an
alarm is synced, it fires **even if the phone is dead, silenced, or in another
room**. The app is where reminders are captured; the device is where they are
delivered.

## Hardware assumptions

- BLE peripheral (e.g. ESP32-S3 / nRF52840 class), speaker, push buttons
  (**DONE**, **SNOOZE**), far-field mic (future: on-device capture), RTC with
  battery backup, ≥16 MB flash for audio.
- Audio playback of Opus-in-WebM or AAC-in-MP4 (the two containers the app's
  `MediaRecorder` produces).

## GATT layout

Service UUID: `f0ba0001-6c1f-4b3a-9c8e-2d7a1a5c9e01`

| Characteristic | UUID | Properties | Purpose |
|---|---|---|---|
| Alarm Meta   | `f0ba0002-…9e01` | write (with response) | JSON control frames |
| Audio Chunk  | `f0ba0003-…9e01` | write (with response) | raw audio payload, ≤480 B per write |
| Events       | `f0ba0004-…9e01` | notify | JSON events device → app |

## Control frames (app → device, Alarm Meta characteristic)

UTF-8 JSON, one frame per write.

### `alarm.put` — announce an incoming alarm

```json
{
  "op": "alarm.put",
  "id": "m3k9f2ab",
  "fireAt": 1783512000000,
  "transcript": "Wake up, interview at 9…",
  "audioBytes": 51234,
  "audioMime": "audio/webm;codecs=opus"
}
```

After this frame, the app writes `ceil(audioBytes / 480)` sequential chunks to
Audio Chunk. The device reassembles by arrival order (BLE write-with-response
guarantees ordering) and stores `{meta, audio}` keyed by `id`, replacing any
existing alarm with the same id (this is how snoozes/edits re-sync).

### `alarm.delete`

```json
{ "op": "alarm.delete", "id": "m3k9f2ab" }
```

### `time.set` (recommended on every connect)

```json
{ "op": "time.set", "unixMs": 1783512000000 }
```

## Events (device → app, Events characteristic)

### `resolved` — user handled an alarm at the bedside

```json
{ "type": "resolved", "alarmId": "m3k9f2ab", "action": "done", "snoozes": 2 }
```

`action` is `"done"` (DONE button) or `"missed"` (played to exhaustion —
default 10 minutes of looping — with no interaction). The app logs this into
the same outcomes store as app-side resolutions, so Insights sees bedside
behavior too. Events that occur while disconnected are queued on-device and
replayed on next connect.

## Firing behavior (device firmware contract)

1. At `fireAt`, play the stored recording **on loop**, ramping volume from 40%
   to 100% over 30 s.
2. SNOOZE button: stop, re-arm `fireAt = now + 5 min`, increment `snoozes`.
3. DONE button: stop, delete local alarm, queue `resolved/done` event.
4. No interaction after 10 min: stop, queue `resolved/missed`.
5. Device never requires the phone to be present to do any of the above.

## Simulator

Browsers without Web Bluetooth (iOS Safari, Firefox) get a simulated device in
`js/device.js` — same states and sync flow, no radio — so the full product
loop is demoable anywhere.
