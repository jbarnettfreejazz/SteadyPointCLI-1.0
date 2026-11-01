# SteadyPoint — handoff note (Oct 31, 2026)

React Native 0.75.4 app (repo root), on iOS and — since the Fifty-second
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

## Waiting on device testing

1. **Crash fix (51st)** — app crashed after 0.5–1.5 min with sound on:
   a thread race in react-native-audio-api 0.4.18 `AudioParam` (JS thread
   schedules while the audio thread pops the event deque). Fixed by a
   mutex (audio thread try-locks) in `patches/react-native-audio-api+0.4.18.patch`
   (combined with the earlier AudioPlayer patch). Applying it needs
   `rm -rf node_modules/react-native-audio-api && npm install`, then
   `grep -c "SteadyPoint patch" node_modules/react-native-audio-api/common/cpp/audioapi/core/AudioParam.cpp`
   → 8, then Clean Build Folder. Applied in the local directory; James was
   archiving the TestFlight build (hit the `.xcodeproj` vs `.xcworkspace`
   modulemap error — open the workspace). Confirm multi-minute sound
   sessions no longer crash.
2. **Tremor map, strict band edges, upper limit, Frequency default (50th)**
   — test list given in chat: rest; in-band shake; slow sway; 3.5 Hz with a
   4–8 Hz band (should now be silent); above band; sway + in-band shake;
   widen band / upper limit / noise floor / filtering off mid-session;
   trail clusters fading after 60 s; Intensity mode; sound off; dark mode;
   new session starts with an empty trail.
   Note: Settings > Sonification > Pitch follows defaults to Frequency only
   on fresh installs; the map and numbers show in both modes.
3. **Android round 1 (52nd)** — on the Samsung: sample voices (cello,
   viola, violin) audible from the first session; connect works (Metro
   log shows `[ble] MTU …`) and calibration readings look normal; back button does
   nothing on Recording, works on Summary and elsewhere; Share calibration
   log opens the share sheet with the log text; app shows as
   "SteadyPoint". Plus a general first pass (wizard incl. Use default values — now reachable by
   scrolling on the Samsung, timed and
   continuous sessions, guide track, analytics, resume after disconnect).

## Android plan (agreed)

Round 1 done (52nd). Next, ask before each: foreground service for long
continuous sessions with the screen off / other apps (small native module,
no new library); audio output change + audio focus recovery (patch to the
library's Android Oboe player); then the RN upgrade Google Play requires
(target API 36, 16 KB pages — also affects iOS and the 0.4.18 pin).
Google Play Console account not created yet; organization vs personal
account still to decide (Play lists medical apps as organization-only).

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

- Audio library is pinned at react-native-audio-api 0.4.18 (patched).
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
