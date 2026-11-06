# SteadyPoint — handoff note (Nov 5, 2026)

React Native 0.81.6 app (old architecture; upgraded from 0.75.4 in the
Fifty-fourth follow-up — do not go past 0.81.x, see README) (repo root), on iOS and — since the Fifty-second
follow-up — being brought up on Android, that reads an M5StickC Plus over BLE
and gives tremor biofeedback: live intensity, sonification (pitch follows
intensity or frequency, volume follows intensity), sessions, analytics.
`README.md` logs every change round in detail ("…follow-up" sections, the
newest just above "Roadmap"); code comments are tagged with the same round
names (e.g. `FIFTIETH follow-up`).

## How we work

- Each round: assess first when a change is complex; implement only what
  was approved; deliver the **full project zip** (excluding WAVs and
  `ios/SteadyPointCLI.xcodeproj/project.pbxproj`, files at the zip's top
  level — no wrapping folder) plus a list of changed files.
- James copies files into a local test directory and a separate TestFlight
  directory, builds from the command line / Xcode (always open
  `ios/SteadyPointCLI.xcworkspace`, never the `.xcodeproj`). Android is
  built from the same local test directory: `npm install`, then
  `npx react-native run-android` with the Samsung test phone on USB
  (Android Studio + JDK 17 installed; WAVs already in
  `android/app/src/main/assets/custom/`).
- Run `tests/` (`cd tests && npm install && npm test`) after changes; add
  checks for new behaviour. See `tests/README.md`.

## Current use case (drives recent work)

A friend uses long **Continuous sessions** to find tremor triggers: he
tweaks calibration mid-session (Edit Calibration Settings) so sound plays
only when the tremor is inside a chosen frequency band and intensity
window, then goes about his day waiting for audio nudges. The **tremor
map** on the Recording screen shows the settings box, the in-band reading
(filled dot), the actual/dominant reading (hollow dot) and a 60 s trail.

## Device-tested OK (recent rounds)

- 51st: crash fix with sound on (long sound-on sessions passed on iOS).
- 52nd: Android round 1 (samples, back guard, log share, app ID/name).
- 54th: RN 0.81.6 on both platforms (iOS regression list passed, TestFlight
  build made; Android release APK path documented).
- 55th: Android session foreground service + notification; "Calibrate" label.
- 57th: Edit Calibration during a session as a screen (Android + iOS).

## Waiting on device testing

1. **Android audio recovery (58th)** — during a sound-on session: connect a
   Bluetooth speaker, disconnect it, plug/unplug headphones → sound
   continues on the new output each time (logcat "SteadyPoint audio:
   output changed; stream reopened"); a phone call (incoming and outgoing)
   and a video call → SteadyPoint goes quiet and the guide track pauses,
   both resume after hanging up; music/podcasts from another app keep
   playing alongside SteadyPoint (mixing); after End Session, a call ending
   doesn't bring sound back; guide track pick/play/stop on Android.

1b. **Guide-track names + Android version (59th)** — on Android, pick and play
   a guide track with "#" in its name (e.g. "Cello Suite #1….m4a"); it plays
   and shows its original name; a pinned session saved earlier with a "#"
   name now plays; iOS guide tracks still play. Settings shows "SteadyPoint
   Version <steadypointVersionName> (<steadypointVersionCode>)" from
   android/gradle.properties (set them to match iOS).

2. **Tremor map, strict band edges, upper limit, Frequency default (50th)**
   — test list given in chat: rest; in-band shake; slow sway; 3.5 Hz with a
   4–8 Hz band (should now be silent); above band; sway + in-band shake;
   widen band / upper limit / noise floor / filtering off mid-session;
   trail clusters fading after 60 s; Intensity mode; sound off; dark mode;
   new session starts with an empty trail.
   Note: Settings > Sonification > Pitch follows defaults to Frequency only
   on fresh installs; the map and numbers show in both modes.
   (Not explicitly confirmed after later rounds.)

## Android plan (agreed)

Round 1 done (52nd) and device-tested OK. Android icon done (53rd).
RN 0.81.6 upgrade (Phase 2) done (54th) and device-tested on both platforms.
Session foreground service (55th) and session calibration screen (57th)
device-tested OK. Android audio recovery (58th) — waiting on device testing.
Guide-track file names + Android version in Settings (59th) — waiting on
device testing. Phase 3 complete after that; next is Phase 4 (Play release;
personal Play account; Android version numbers to match iOS — set in
android/gradle.properties since the 59th).
Google Play: the user is creating a **personal** developer account (needs a
closed test with 12+ testers for 14 days before going public). Play lists
medical apps as organization-only, so the listing and health declaration
should present SteadyPoint as wellness/biofeedback, not diagnosis.

## Ideas discussed, not started (ask before doing)

- Save actual and in-band frequency per reading with each session →
  whole-session map in Session Detail, with stretches marked where readings
  fell inside the box; and a session "typical frequency" (median) instead
  of the current saved "Dominant freq" (= last reading at intensity ≥ 8,
  older method, can be below the band and is shown without band context).
- Flag a saved dominant frequency outside the band ("1.8 Hz · below band").
- Trail length option on the map (1 min / 5 min / whole session, density
  shading for long spans).
- Call the hollow dot "dominant" and draw a guide line to the frequency
  axis with its value.
- "Include this" / drag the box edges on the map to widen settings.
- Label edge-spill or harmonic in-band readings.
- Deferred earlier: built-in test signal; frequency debug logging.

## Things to know

- React Native 0.81.6, old architecture (`newArchEnabled=false`,
  `RCT_NEW_ARCH_ENABLED=0`, Info.plist `RCTNewArchEnabled=false`). 0.81 is
  the last version allowing it. Navigation goes through
  `src/navigation/go.js` (React Navigation 7, v6 behaviour).
- Audio library is pinned at react-native-audio-api 0.4.18 (patched).
  react-native-sound 0.11.2 is also patched (RN 0.81 resolveAssetSource).
  Don't use `cancelScheduledValues()` (crashes). Newer versions are a major
  API upgrade.
- Flags: `REST_FADE_ENABLED` (audio.js), `STRICT_BAND_EDGES`,
  `MAP_TRAIL_SEC` (liveSession.js), `SONIFICATION_DEBUG_LOGGING` (audio.js,
  off).
- Muting (edge spill / upper limit) sends level 0 to the sound
  (`soundLevel`), so it fades over 0.5 s like any rest; readings and saved
  sessions are unaffected.
- Sessions store g traces (`rmsTraceG` in-band, `rmsAllTraceG` all motion)
  plus calibration segments; intensity is re-scored at display time on the
  current full scale/noise floor; band changes can't be re-scored (marked
  on charts; Analytics compares same-band sessions only).
