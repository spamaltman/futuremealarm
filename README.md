# FutureMe Alarm

**A normal alarm tells you when to act. This tells you what you're doing, why
it matters, and what to do next — in your own voice.**

Built for people with poor executive function, for whom out-of-sight is
out-of-mind: you set an alarm for 7:00 and at 7:00 you have no idea why past-you
cared, so you sleep through it. FutureMe replaces the beep with a recording of
you: *"Get up. Interview at 9. You want this job. Shower first."*

## The loop

1. **Capture (one button).** Hold the mic button and talk. The app records your
   voice and live-transcribes it, pulls the fire time straight out of your
   speech ("tomorrow at 7:30", "in 20 minutes", "friday at 6pm"), and
   auto-arms in 5 seconds. If you didn't say a time, one tap on a chip sets it.
   Adding a reminder is deliberately as close to zero-click as speech allows.
2. **Deliver (no initiative required).** At fire time your recording plays on
   loop until you respond — through the app, a system notification, and the
   **bedside device**, which stores alarms and audio locally and fires even if
   the phone is dead or silenced. Future-you never has to remember to check
   anything.
3. **Learn.** Every alarm resolution is logged: acted-on vs missed, snooze
   count, time-to-acknowledge, topic (wake/meds/appointment/…), whether the
   recording included a *reason*, and whether it was resolved on the phone or
   the device. The Insights tab turns this into answers: what you keep asking
   of yourself, which hours defeat you, and whether telling future-you *why*
   actually improves follow-through (spoiler: measure it and see).

## Run it

Static PWA — no build step, no dependencies.

```bash
cd futuremealarm
python3 -m http.server 8000
# open http://localhost:8000
```

Mic capture and service workers require a secure context: `localhost` works;
on a phone, serve over HTTPS (or use a tunnel) and "Add to Home Screen".

Best experienced in Chrome/Edge (Web Speech transcription + Web Bluetooth).
Everywhere else, recording/alarms/insights still work; transcription falls
back to chip-based time picking and the device link runs in simulator mode.

## Layout

```
index.html            app shell (capture / armed / insights + firing overlay)
css/styles.css
js/app.js             controller: capture → confirm → arm → fire → log
js/recorder.js        MediaRecorder + Web Speech live transcription
js/timeparse.js       natural-language fire-time extraction, reason & topic detection
js/alarms.js          scheduler, snooze, outcome logging, notifications
js/device.js          Web Bluetooth link to bedside unit (+ simulator fallback)
js/store.js           IndexedDB (alarms incl. audio blobs, outcomes)
js/insights.js        analytics over the outcomes log
sw.js                 offline cache + notification click-through
docs/DEVICE_PROTOCOL.md  BLE GATT spec for the physical device
```

## The physical device

The web platform can't promise a sound at 7:00 AM from a dead phone — the
bedside unit can. It's a BLE speaker/mic with its own clock and storage; armed
alarms (audio included) sync to it automatically on connect, DONE/SNOOZE
presses on the hardware flow back into the analytics. The full protocol —
UUIDs, framing, firmware firing contract (looping playback, volume ramp,
missed-alarm timeout) — is specified in
[docs/DEVICE_PROTOCOL.md](docs/DEVICE_PROTOCOL.md). Without hardware present,
`js/device.js` falls back to a simulator so the entire flow is demoable.

## Privacy

Everything — recordings, transcripts, outcomes — lives in IndexedDB on your
device and on your bedside unit. Nothing is uploaded anywhere.
