# SteadyPointCLI

Bare React Native CLI port of `steadypoint_v5_demomode_url.html`, so the
tremor-monitoring app can run natively on iPhone (Web Bluetooth doesn't
exist on iOS Safari, so a web build can never work there — this is why
we're building this as a native app instead).

## Status

**What works end-to-end right now:**
- Project scaffold (bare RN CLI, plain JavaScript, RN 0.75.4)
- Global state: Context + `useReducer` (`src/state/`) replacing the
  original's ~30 mutable globals + manual `render()` calls
- BLE service (`src/services/ble.js`) using `react-native-ble-plx` —
  same Nordic UART UUIDs as the original, so **no app-side changes
  needed** as long as the on-device firmware keeps the same protocol,
  regardless of which physical M5Stick model it's running on. The
  "connected" text on Home is not hardcoded to a device model — it
  shows whatever name the connected device actually advertises over
  BLE (currently "TremorMonitor", per the firmware's own advertised
  name — change that in the firmware, not here, for a different label)
- DSP utilities (`src/utils/dsp.js`) — `mean`, `std`, `rmsOf`, FFT,
  `dominantFreq` — ported line-for-line, no logic changes
- Live session store (`src/state/liveSession.js`) — mirrors
  `pushPacket`/`updateLiveMetrics` timing (packets buffered as they
  arrive, metrics recomputed every 300ms, elapsed timer every 1000ms)
  as a separate ref-based store so BLE's ~50Hz packet rate doesn't
  flood React's reconciler
- Persistence (`src/services/persistence.js`) — AsyncStorage replaces
  `localStorage` for settings/sessions/analytics/pinned sessions
- Session scoring logic (`src/services/sessionLogic.js`) —
  `startSession`/`endSession` ported faithfully, including the
  auto-pin-to-Home behavior and the score formula
- **Audio sonification — sample-based string trio, dual velocity
  layers** (`src/services/audio.js`) — three bowed-string voices
  (Cello/Viola/Violin, one per axis), using real recorded string
  samples instead of synthesized oscillators. Samples are from VSCO 2
  Community Edition (Versilian Studios), CC0-licensed (public domain)
  — verified directly against the LICENSE file in the source repo
  before use, since this project is intended for real distribution.
  See `src/assets/AUDIO_SOURCES.md` for exactly which files and where
  they came from. Each voice now plays **two** recordings of its note
  simultaneously — a soft/gentle bow and a loud/aggressive bow — and
  crossfades between them as movement intensity rises
  (`setIntensity()`), rather than just turning the volume up on one
  recording. This is a genuine timbre change, not just a volume
  change, matching how a real player sounds different bowing harder.
  Each layer is decoded once, looped (skipping the bow-attack
  transient and any tail-off — only the middle "sustain" portion
  loops), and pitch-shifted live via `StretcherNode` rather than by
  changing playback speed. Bundled into the native iOS/Android builds
  via `react-native.config.js` + `npx react-native-asset` (the
  standard RN mechanism for linking raw, non-JS asset files) — re-run
  that command if the files in `src/assets/audio/` ever change.
  **Unverified, worth checking on-device**: this library's note-naming
  convention appears to be shifted an octave from standard (a cello
  sample labeled "C1" can't be standard C1, since that's below a real
  cello's range) — the `REFERENCE_FREQ` constants are a best guess
  based on that, and pitch may need correcting by an octave or so once
  actually heard; that's a one-line constant change, not a redesign.
  Pitch still follows axis position and volume still follows how much
  that position *changed* since the last update — same mechanism as
  before (silence when steady, no explicit threshold needed). Update
  cadence is currently back to **per-packet** (~50Hz) as an experiment
  to address reported "throbbing/pulsating," on the theory that the
  previous ~300ms throttle (needed for an earlier oscillator-based
  engine) may not apply to this engine's different node type
  (`StretcherNode` vs raw `OscillatorNode` automation) — if pitch/
  volume freezing or stalling reappears under real movement, that
  confirms the same limitation extends here too, and this should
  revert to the throttled cadence (see comments in
  `src/state/liveSession.js`). Pitch is also quantized to a shared
  pentatonic scale across all three voices (see `quantizeToScale()`),
  so independent axis movement still tends to land on consonant
  combinations
- **Per-axis sound mute** — the Recording screen now shows a Cello/Viola/
  Violin mute toggle row (matching the X/Y/Z axis mapping used
  throughout) whenever sonification is on. Mute state lives in
  `audio.js` (`setVoiceMuted()`), not the UI/reducer, so it takes
  effect immediately regardless of update cadence and forces that
  voice silent right away rather than waiting for the next natural
  update. Resets to all-unmuted at the start of every new session
- **Guide-track playback** (`src/services/guideTrackPlayer.js`): plays
  the selected guide audio file during a session using
  `react-native-sound` (native `AVAudioPlayer`/`MediaPlayer`), not the
  `AudioContext` used for sonification. Guide-audio filenames are
  stored (not full absolute paths) and resolved fresh at playback
  time via `RNFS.DocumentDirectoryPath` — an absolute path would go
  stale on every app reinstall, since iOS gives each install a new
  container UUID even though the file itself is still there under the
  new one. Runs independently of the sonification toggle — a
  visual-only session with a guide file selected still plays the
  guide track, matching the original. **Untested interaction worth
  watching for**: both this and the sonification manage iOS's single
  shared audio session (`Sound.setCategory('Playback')` here;
  `react-native-audio-api` manages its own internally) — hasn't been
  verified on-device that they coexist cleanly when both are active
  in the same session
- **Visual polish**: `ScoreRing` and `Sparkline` components
  (`src/components/`) ported from the original's SVG markup via
  `react-native-svg` — used on Home (today's baseline + 7-day bar
  chart), Recording (live X/Y/Z waveform), and Summary (animated score
  ring + stats grid)
- **Custom Session Types** (`src/screens/SetupScreen.js`): full setup
  form (feedback toggle, guide media, activity type, note, duration)
  with the original's dual-mode behavior — typing a note and starting
  a session auto-pins it to Home, or explicitly tapping "Save to Home"
  saves it (prompting for a name if no note was entered). Pinned
  sessions (max 3, oldest evicted first) show on Home with edit/delete
  controls and launch immediately on tap, matching the original's
  `quickStart()`. Guide audio uses `@react-native-documents/picker` +
  `keepLocalCopy()` to get a stable local file path that survives app
  restarts — an improvement over the original, which lost its picked
  file (a Blob/ObjectURL) on every page reload and had to prompt the
  user to re-select it
- **Analytics, Session History, Session Detail** (`src/screens/`,
  `src/utils/sessionStats.js`): summary tiles, 7-day score trend chart
  (`WeeklyBarChart.js`), breakdowns by activity type / sound feedback /
  guide source, key insight text, and full session drill-down with
  "Start similar session" — all ported from `renderAnalytics()` /
  `renderSessionHistory()` / `renderSessionDetail()`. Two real bugs
  surfaced and got fixed while wiring this up: session records had no
  `id` field at all (nothing needed one until list keys/detail lookups
  did), and `useBLE.js` was calling a function (`stopRecording`) that
  had been renamed to `stopRecordingBuffers` earlier in this project —
  latent since then, only surfacing when a BLE disconnect actually
  fired. Both include a repair pass for already-saved data. One
  intentional behavior match, not a bug: like the original, the
  "This week" / "All sessions" tabs on Session History visually
  toggle but don't actually filter the list — that's how the source
  HTML works too, preserved as-is rather than silently changed
- **Bottom tab bar** (`src/navigation/MainTabs.js`): Home, Analytics,
  Learn, and Settings — the original's four "main" pages — are wrapped
  in a `@react-navigation/bottom-tabs` navigator with simple SVG line
  icons (`src/components/TabIcons.js`, no icon font dependency).
  Every other screen (Setup, Recording, Summary, Session History,
  Session Detail, Article) lives outside this tab navigator as a plain
  full-screen stack push, which is what makes the bar disappear on
  those screens — matching the original's `noNav` list without having
  to replicate that logic explicitly
- Screens with **real, working logic**: Home, Setup, Recording,
  Summary, Analytics, Session History, Session Detail
- Screens that are still **placeholders** for now (tap "Back to Home"
  to return): Learn, Article, Settings

## Not yet ported (by design — see roadmap below)
- Spotify/YouTube guide sources (Setup currently only offers "From my
  phone" and "No guide")
- Background audio (app currently only sonifies while in the
  foreground — no `AVAudioSession` background mode configured yet)

## Setup (on your Mac)


```bash
cd SteadyPointCLI
npm install
cd ios && pod install && cd ..
npx react-native run-ios       # or open ios/SteadyPointCLI.xcworkspace in Xcode
```

For Android:
```bash
npx react-native run-android
```

### Testing BLE
The iOS **Simulator has no Bluetooth hardware** — BLE only works on a
physical device. Use `npx react-native run-ios --device` (or select
your phone in Xcode) once it's paired and code-signed.

### Bundled audio samples
`npx react-native-asset` has already been run against this project
(the iOS project file and Android assets folder both already reference
`src/assets/audio/*.wav`), so no extra step is needed for a normal
build. Only re-run it if you add, remove, or rename files in that
folder.

### Podfile: DEFINES_MODULE fix
The Podfile's `post_install` hook sets `DEFINES_MODULE = YES` on all
pod targets. Without this, Swift pods (specifically
`MultiplatformBleAdapter`, pulled in by `react-native-ble-plx`) can
fail to generate a module map, causing a build error like:
`module map file '.../MultiplatformBleAdapter.modulemap' not found`.
This is a known issue with `react-native-ble-plx` on newer Xcode
versions.

### react-native-audio-api version pin
Pinned to **exactly 0.4.18**, not the latest release. Newer versions
(0.13.x+) use TurboModule codegen features (union types in native
specs) that RN 0.75.4's codegen doesn't support and will fail `pod
install` with `Error: Union types are unsupported in structs`. Version
0.4.18 has a minimal native spec (no unions) and was verified against
this project's actual usage (`createOscillator`, `createGain`,
`createStereoPanner`, `AudioParam.setTargetAtTime`) — all present with
matching signatures. If you ever upgrade the RN core version itself,
it's worth revisiting whether a newer audio-api version becomes safe
to use again.

### @react-native-documents/picker version pin
Pinned to **exactly 10.1.7**, for the same underlying reason as
above. Version 11.0.0+ requires `react-native >=0.79.0` as a peer
dependency (we're on 0.75.4), and 12.x's own native spec is written
against that newer baseline. 10.1.7's `Spec extends TurboModule`
interface deliberately uses generic `Object`/`Promise<Object>` types
instead of typed unions (per a comment in its own source: "we use
'Object' to have backward compatibility with old arch"), so it should
be codegen-safe here. `react-native-document-picker` (the older,
now-deprecated package) was avoided entirely rather than fixed forward.

### react-native-sound version pin
Pinned to **exactly 0.11.2**, not the latest (0.13.0). There's a ~3.5
year gap between 0.11.2 (2022) and 0.12.0 (2025) in the version
history — that gap is a TurboModule/codegen rewrite, and it turns out
0.13.0's native iOS code (`RNSound.mm`) references a codegen-generated
type (`JS::NativeSoundIOS::SoundOptionTypes`) with no fallback for old
architecture, so it fails to compile with `Error: Expected a type`
under old-architecture projects (which this one is, matching the other
native dependencies here). 0.11.2 predates that rewrite entirely —
plain Objective-C (`RNSound.m`, not `.mm`), no codegen dependency at
all, so it compiles cleanly regardless of architecture. Its public
`Sound` class API (constructor, `.play()`, `.stop()`, `.release()`,
`Sound.setCategory()`) is unchanged from 0.13.0, so nothing in
`src/services/guideTrackPlayer.js` needed to change for the downgrade.

## Focus group prep — temporarily hidden features
Ahead of a patient focus group, two existing features were hidden via
feature flags rather than removed — all underlying state, persistence,
and logic stays fully intact, so re-enabling is just flipping a
constant back to `true`, no data migration needed:
- **Home screen's "MY SESSIONS"** (pinned custom session types) —
  `FEATURE_MY_SESSIONS` in `src/screens/HomeScreen.js`
- **Setup screen's pre-session note field** — `FEATURE_SETUP_NOTE` in
  `src/screens/SetupScreen.js` (this is different from the *post*-session
  note on the Summary screen, which was kept and improved, not hidden)

Also: the Summary screen's post-session note field moved from an inline
`TextInput` (which `KeyboardAvoidingView` alone didn't keep clear of the
keyboard) to a dedicated full-screen modal, with the input pinned near
the top of its own screen — well out of the keyboard's reach regardless
of device/keyboard size.

## Screen sleep during a session
iOS locks the screen after its normal auto-lock timeout (5 minutes on
most default settings) regardless of an active BLE connection — and
when the screen locks, the app is suspended and **all JS execution
stops**, including the BLE packet/metrics processing loop. The BLE
connection itself stays alive at the native level, which is exactly
why this looked like the session "paused" while still connected: data
kept arriving over Bluetooth with nothing left running to process it.

Fixed by keeping the screen awake for the duration of a session, via
`useKeepAwake()` (`@sayem314/react-native-keep-awake`) in
`RecordingScreen.js`. Pinned to the **1.x line** deliberately — the
current 2.x requires React Native 0.82+ and New-Architecture-only,
neither of which matches this project (RN 0.75.4, Old Architecture,
matching several other libraries already pinned in this project for
the same reason). Verified 1.4.0's native iOS module correctly guards
all New-Architecture-specific code behind `#if RCT_NEW_ARCH_ENABLED`,
with a plain old-style bridge module as the always-compiled path, and
confirmed a standard podspec for normal autolinking (no manual Xcode
project surgery needed).

Since `RecordingScreen` deliberately stays mounted underneath the
Summary screen (see the earlier sonification-stop fix), the screen
stays awake through Summary too, not just the live session — that's
harmless and arguably desirable, since you likely don't want the
screen locking while reviewing results either. It releases once
"Return to home" unmounts the whole Setup → Recording → Summary stack.

## SteadyPoint Score — session scoring algorithm
The end-of-session score (`src/services/sessionLogic.js`'s `endSession()`)
was changed from a reduction-based formula to a band-time-based one, per
a spec from a separate chat (`SteadyPoint_Score.pdf`). Verified the new
formula's math directly against several test scenarios before wiring it
in — including confirming an intentional, non-obvious property of the
spec: a session spent entirely in the "High" band still scores 15, not
0, because the consistency component still rewards a stable (if bad)
trace. That's the spec's intended behavior, not a bug.

- **Validity gate**: a session is only scored if it has ≥10 tremor-level
  samples and lasted ≥30 seconds. Otherwise `score` is `null` and
  displays as "—" everywhere, rather than a misleading number
- **Steadiness (85%)**: average "band credit" across the full session
  trace — None=1.0, Mild=0.7, Moderate=0.35, High=0.0
- **Consistency (15%)**: `100 - stdDev(levels) × 1.5`, clamped 0-100 —
  rewards a stable trace, penalizes erratic spikes
- **Band time percentages** (% of session in None/Mild/Moderate/High)
  are computed and stored on each session record, for a future
  Analytics "Time in Bands" panel — that panel itself wasn't built in
  this pass, since it's a separate UI feature; the data is ready
  whenever it is
- Scoring now requires the **full session trace** of tremor levels, not
  just start/end snapshots — `src/state/liveSession.js` tracks this in
  `levelTrace`, pushed at each ~300ms metrics tick while recording,
  returned from `stopRecordingBuffers()` alongside the existing
  accelerometer `sessionBuffer`

**Interpretation bands** for the score itself (different from the
tremor-*level* bands used during a live session): 70-100 green
("mostly low tremor"), 45-69 amber ("moderate"), 0-44 red ("elevated
tremor") — updated in `scoreColor()`/`scoreTextColor()` in
`src/utils/sessionStats.js`, and propagated everywhere a session's
score is averaged, compared, or displayed (`AnalyticsScreen`,
`HomeScreen`, `SessionHistoryScreen`, `SessionDetailScreen`,
`SummaryScreen`) — all now filter out `null`-score sessions from
aggregates rather than letting them corrupt an average, and show "—"
rather than a raw number for a specific unscored session. Caught one
real bug while doing this sweep: `HomeScreen`'s most-recent-session
label used `>=` comparisons directly against `score`, and a `null`
score would have silently fallen through to the worst-case label
("HIGH"/"High tremor") due to how JS coerces `null` in numeric
comparisons — fixed with an explicit `null` check first.

The "Reduction" stat (start vs end intensity comparison) and its
underlying `startLevel`/`endLevel` are unrelated to the SteadyPoint
Score and were kept as-is — worth restating since they were briefly,
accidentally dropped mid-edit and then restored before shipping.

## Sonification frequency-detection investigation
Real device testing (metronome-guided shake tests at known BPMs,
compared via temporary diagnostic logging) surfaced multiple issues
with the combined-frequency pitch source. Two early fixes turned out
to be necessary-but-insufficient; the actual root cause was confirmed
by a decisive motionless-device test, and finally isolated with
synthetic-signal testing of the real production code.

1. **Missing temporal smoothing** — the original port omitted an
   exponential-smoothing step that was actually specified in the
   reference implementation. Fixed: `FREQ_SMOOTHING_ALPHA = 0.2` in
   `src/services/audio.js`.
2. **A "window too short" hypothesis that turned out to be wrong** —
   initially suspected the ~2s rolling window couldn't resolve low
   frequencies, and added a dedicated 5s window (`FREQ_WIN`/
   `freqWinX/Y/Z` in `liveSession.js`). Retested: made no meaningful
   difference. Kept anyway since it's harmless, but it was not the fix.
3. **Confirmed root cause, via a motionless-device test**: with the
   M5Stick completely still (no hand involved), the detector still
   reported erratic 10-20Hz+ readings — proving the FFT reports
   whichever bin has the most noise energy as a "dominant frequency"
   when no real signal is present. **Fixed** by gating detection behind
   `MIN_INTENSITY_FOR_FREQ = 8` (roughly the low end of "Mild").
4. **Isolated definitively via synthetic-signal testing** of the actual
   production `combinedDominantFreq()` (not a reimplementation — the
   real function, run standalone in Node against generated data):
   - Clean sine waves from 0.5-8Hz are all detected correctly,
     confirming the algorithm itself has no bug
   - A weak 0.5Hz fundamental + a stronger 4Hz artifact is misdetected
     as ~3.9Hz — closely matching the ~4-5Hz consistently seen on real
     60 BPM device tests
   - The same artifact against a *strong* 1.83Hz fundamental (220 BPM)
     is correctly detected — matching why that real test converged
     cleanly while 60 BPM never did, however long it ran
   - **Conclusion**: not a code bug. Real, slow, deliberate hand motion
     produces genuinely weak acceleration at its own fundamental
     (acceleration scales with frequency² for a given displacement),
     letting harmonics/artifacts from imperfect execution dominate.
     Actual clinical tremor (~4-12Hz) should behave like the
     successful 220 BPM case, not the artificial 60 BPM case.
5. **Follow-up UX fix**: the `MIN_INTENSITY_FOR_FREQ` gate (item 3)
   was confirmed via logs to cause pitch to freeze abruptly at its last
   value once intensity dropped below threshold — making a natural
   slow-down sound "stuck" rather than settling down, since gain fades
   independently and gradually while pitch just stopped updating.
   Fixed: below threshold, pitch now eases toward
   `SOURCE_FREQ_MIN_HZ` over ~2-3 seconds (`FREQ_DECAY_ALPHA = 0.25`)
   rather than freezing, resetting to null (silence-ready) once
   settled — preserves the motionless-device fix while giving a
   graceful fade instead of an abrupt stop.

All fixes confirmed with a combined real-world test (motionless →
moderate → vigorous → moderate → motionless): pitch and volume both
rose clearly during the vigorous phase and both faded gracefully
rather than freezing when winding down.

The `[sonification]` diagnostic console.log used throughout this
investigation is now off by default, gated behind
`SONIFICATION_DEBUG_LOGGING` in `audio.js` — flip that one boolean to
`true` to re-enable it if needed again, rather than re-adding logging
from scratch.

## Crash fix — confirmed via real crash log
A crash reported during long (2+ minute) sonification-on sessions was
initially addressed with a guess (throttling native automation call
volume) that turned out not to fix it — confirmed by testing, still
crashed at the same point even throttled. Got an actual iOS crash log
this time (`.ips` file via Settings > Privacy & Security > Analytics &
Improvements > Analytics Data) and found the real cause: `SIGSEGV`
inside `react-native-audio-api`'s own native `AudioParam.
cancelScheduledValues()` implementation (a deque-iterator decrement
failing), called from `stopHard()` in `src/services/audio.js` at
session end. Fixed by removing that call entirely —
`setValueAtTime(0, t)` alone still silences the gain; the throttling
from the earlier guess was left in place anyway since reducing native
call volume is reasonable on its own merits, just wasn't the actual
fix. Small accepted tradeoff: without an explicit cancel, a pending
ramp scheduled slightly beyond the silence point could theoretically
cause a brief audible blip before truly going silent — clearly
preferable to a crash.

## Sonification redesign — single combined voice
Replaced three independent voices (Cello=X, Viola=Y, Violin=Z, each
driven by its own axis) with a single voice — user-selected instrument
(Settings > Sonification) — driven by all three axes combined. Found
that three simultaneously-moving pitches felt busy even with
pentatonic quantization; muting two of three voices made it "much
more palatable," which directly motivated this redesign.

Ported from a reference Python implementation (`sp_stdout.py`) per an
explicit spec: pitch maps to the tremor's dominant frequency, volume
maps to tremor intensity.

- **Pitch**: `combinedDominantFreq()` in `src/utils/dsp.js` — FFT each
  axis separately (mean/gravity-removed), find each axis's own
  dominant frequency, average whichever axes produced a usable
  result. That combined frequency (expected 0.5-20Hz movement range)
  is linearly mapped (`mapRange()`) into the selected instrument's own
  natural register (reusing the old per-axis ranges: cello 65-130Hz,
  viola 196-330Hz, violin 392-784Hz)
- **Volume**: directly proportional to `tremorLevel` (the same 0-100
  value shown elsewhere in the app), not a movement-delta as before —
  "silence when steady" still holds naturally
- **Verified before wiring in**: tested `combinedDominantFreq()`
  against a synthetic known-frequency signal (confirmed it correctly
  recovers ~5Hz from three axes oscillating at 4.5/5.0/5.5Hz) and
  simulated the full pitch+volume pipeline across realistic scenarios
  for all three instrument choices, before trusting either

**Deliberate choices made porting this, not explicitly specified
either way:**
- **Not quantizing pitch to the pentatonic scale** the old engine
  used — that existed specifically to prevent dissonant clashes
  between *simultaneous* voices, which can't happen with only one
  voice playing. `quantizeToScale()` was removed; straightforward to
  reintroduce if a more "musical" (vs. scientifically direct) feel is
  wanted later
- **FFT throttled internally to ~300ms**, separate from the per-packet
  (~50Hz) cadence everything else in this engine uses — running an FFT
  on 3 axes at full packet rate is meaningfully more CPU work than
  anything this engine has done before. Volume stays fully responsive
  every packet; only the expensive frequency recompute is throttled.
  This is a new, reasoned safeguard, not something proven necessary by
  an observed on-device issue this time — worth watching for any signs
  of it still being too much load
- **Skipped the reference's uniform-time-grid resampling step** before
  each axis's FFT (added there for robustness against irregular BLE
  timing) — reuses the same "packets arrive regularly enough" assumption
  the pre-existing `dominantFreq()`/"Dominant Freq" stat already makes,
  rather than adding real per-sample timestamp tracking as a larger,
  separate change
- **Per-axis mute removed entirely** (not just hidden) — muting one of
  three voices has no coherent meaning when only one voice ever plays;
  turning off sonification entirely is still available via the existing
  visual-only feedback-type toggle
- **Settings > Sonification** lets the user choose which instrument
  carries this combined signal — set once at session start from the
  current setting (mirrors how `fullScaleG` is already fixed per-session)

The existing "Dominant Freq" stat and the SteadyPoint Score's stored
`peakFreq` are **untouched** by this — those still use the pre-existing
Y-axis-only `dominantFreq()`, a deliberate scope decision to avoid
touching an unrelated, already-working feature while iterating on
sonification specifically.

## Configurable sensitivity calibration
`FULL_SCALE_G` (the amount of motion that reads as intensity 100) is
now user-adjustable via Settings, rather than a fixed constant —
matching a change the team's parallel progressive web app developer
already made on his end, for cross-platform consistency. `NOISE_FLOOR_G`
stays fixed; only full-scale was requested as configurable.

The Settings UI itself was matched directly to the PWA's own Settings
> Sensitivity section (from a screenshot) for visual/UX consistency
across platforms — four preset pills rather than free-form numeric
entry, plus the same in-app transparency note about cross-sensitivity
comparability. One deliberate difference: presets are 0.35g / 1.0g /
2.0g / 3.0g here, not the PWA's 0.3g / 1.0g / 2.0g / 3.0g — keeping our
own value (tuned from actual on-device calibration earlier this
project) rather than adopting the PWA's close-but-different 0.3g, at
the user's explicit choice.

- **Setting**: `state.settings.fullScaleG`, adjustable in
  `SettingsScreen.js` (now a real screen, not a placeholder), persisted
  automatically via the existing generic `state.settings` persistence
  — no new storage keys needed. Defaults to `DEFAULT_FULL_SCALE_G`
  (0.35, matching the previous hardcoded value), exported from
  `src/utils/dsp.js` as the single source of truth for that default
- **Used in calculation**: `rmsToLevel(rms, fullScaleG)` in
  `src/utils/dsp.js` now takes this as a parameter instead of a fixed
  module constant. Verified directly that different values actually
  shift the resulting level as expected (wider full-scale → lower
  reading for the same physical motion, narrower → higher) before
  wiring it in
- **Fixed per-session, not read live**: `src/state/liveSession.js`
  holds the value in module state (`setFullScaleG()`/`getFullScaleG()`,
  the same pattern as the existing `setAudioHook()`), set once when
  `startSession()` begins from whatever the setting was at that moment
  — so a mid-session change to the setting (not currently reachable in
  the UI anyway, since Settings isn't accessible during a session)
  couldn't affect a session already in progress
- **Persisted with session data**: each session record now stores the
  `fullScaleG` it was actually computed with (`sessionLogic.js`),
  shown as a small footnote on Session Detail ("Calibrated to 0.35g
  full-scale"). This matters for Analytics: two sessions scored under
  *different* full-scale settings aren't directly comparable the same
  way two sessions under the *same* setting are — that nuance isn't
  yet surfaced anywhere in Analytics itself (no UI change there in
  this pass), but the data needed to account for it is now captured
  on every session going forward

## Device migration — M5StickC Plus to M5StickS3
M5Stack discontinued the M5StickC Plus; the project is moving to the
M5StickS3. On the app side, this needed only cosmetic changes (see
above — no hardcoded model name left anywhere in the codebase). The
one thing that does **not** automatically carry over: the two devices
use genuinely different IMU chips (Plus: MPU6886, S3: BMI270 — different
manufacturers, different hardware). The tremor scoring calibration
constants (`NOISE_FLOOR_G`, `FULL_SCALE_G` in `src/utils/dsp.js`) were
tuned to real-world output from the old sensor specifically, not an
abstract "g-force" concept — a different physical chip can have a
different noise floor and sensitivity even when reporting in the same
units. These should be re-validated against real S3 hardware before
trusting the absolute scores/levels it produces, the same kind of
on-device tuning that produced the current constants in the first
place. This project has no visibility into the M5Stick's own firmware
(it's treated purely as a BLE peripheral sending a known packet
format) — if the S3's firmware changes the wire protocol at all
(different UUIDs, different packet format), `src/services/ble.js`'s
parsing will need updating too; if the protocol stays identical, no
BLE-layer changes are needed.

## Tremor intensity scoring — absolute calibration
The 0-100 tremor intensity level (`rmsToLevel()` in `src/utils/dsp.js`)
was changed from a session-relative scale to a fixed, absolute one, per
a spec from a separate chat (`Tremor_Intensity_Score.pdf`). The
underlying gravity-free RMS math (`rmsOf()`) was already mathematically
identical to the spec's AC-RMS definition — verified directly, not
assumed — so the only real change is in the RMS-to-level mapping:

- **Before**: `tremorLevel = (rms / sessionMaxRMS) * 100` — relative to
  the highest RMS seen *so far in this session* (with slow decay). The
  same physical tremor could read as a very different level depending
  on what had already happened earlier in that same session.
- **Now**: fixed thresholds — `NOISE_FLOOR_G = 0.006` (stillness floor)
  and `FULL_SCALE_G = 0.35` (maps to level 100) — so a given physical
  tremor severity always produces the same level, comparable across
  sessions, days, and users.

This was applied consistently everywhere a tremor level gets computed,
not just the live display, since leaving any of them on the old
relative scale would make the numbers inconsistent with each other:
- `src/state/liveSession.js` — the live orb/level during a session
  (`sessionMaxRMS` tracking removed entirely, no longer needed)
- `src/services/sessionLogic.js` — a session's saved `startLevel`/
  `endLevel` (previously relative to whichever of those two 10%
  samples was higher, not an absolute scale — also changed)

Severity label/threshold and color also changed to match the source
spec: None (0-19, green) / Mild (20-44, blue) / Moderate (45-69, amber)
/ High (70-100, red) — previously None/Mild/Moderate/**Severe** at
15/40/65 with a slightly different color set. Updated in
`liveSession.js` (thresholds) and `RecordingScreen.js` (colors).

## Roadmap
1. Done: Infra — state, BLE, DSP, persistence, navigation shell, core
   Home -> Setup -> Recording -> Summary loop
2. Done: Audio sonification proof-of-concept
3. Done: Visual polish — score ring, waveform sparkline
4. Done: Custom Session Types — Setup screen, pinned sessions on Home,
   guide-audio file picking
5. Done: Analytics, Session History, Session Detail
6. Remaining screens: Learn/Article, Settings
7. Spotify/YouTube guide sources, background audio support
