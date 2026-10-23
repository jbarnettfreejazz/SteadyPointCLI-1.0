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

**Follow-up**: `console.log()` alone isn't useful once this reaches
TestFlight — a Release build has no Metro/debugger attached to receive
that output, so it either goes nowhere visible, or at best to the
device's low-level system log (which would need a tester's physical
phone connected to a Mac with Xcode to view, same as retrieving the
earlier crash log — not realistic for a remote tester). Added a new
`src/services/calibrationLogger.js`: writes the same log lines to an
actual file (`calibration-log.txt` in the app's Documents directory,
via `react-native-fs`, already a project dependency) alongside the
existing console output, plus a "Share Calibration Log" button in
Settings that opens the iOS share sheet (AirDrop, email, Files, etc.)
so a tester can get the file off their device without any special
tools. Used React Native's own built-in `Share` API for this —
verified directly (both against the official docs and the actual
installed package) that its `url` option explicitly supports local
`file://` URLs on iOS, so no new native dependency was needed.

**Follow-up**: added a live `liveFreqHz` reading to each ~300ms log
line during Active Calibration, on request — reuses the same
already-validated `combinedDominantFreq()` used for sonification/the
Dominant Freq stat, computed from the longer `freqWinX/Y/Z` buffers
(not the short amplitude window). Gated behind a minimum RMS threshold
(`MIN_RMS_FOR_LIVE_FREQ = 0.01`, matching the one already validated
inside `detectSustainedFrequencyBand()`) so it correctly logs `null`
rather than a noise-driven false reading before the user starts
producing real tremor — the same lesson already learned and fixed
three times elsewhere in this project. Purely informational: the
actual frequency band saved by calibration still comes from the batch
analysis over the whole recording in `handleLevelReached()`, unchanged.

## Session Complete / Session Detail redesign — Intensity Over Session chart
Both `SummaryScreen.js` and `SessionDetailScreen.js` (same changes to
both, per the design reference): removed the Reduction and Intensity
Shift stat cards, leaving Dominant Freq and Duration as the only two
(they now naturally pair up side by side in the existing 2-column
grid, no layout change needed). Added a new "Intensity Over Session"
chart below the stats, and moved the "N samples captured" text to
below the chart (newly added to SessionDetailScreen, which didn't
show a sample count before at all).

**Real prerequisite found and fixed first**: the chart needs a
per-session intensity trace over time, but this app only ever computed
that in memory during a session (for the SteadyPoint Score's
steadiness/consistency math) — it was never saved with the session
record, so `SessionDetailScreen` had no way to show one later. Fixed
by adding `intensityTrace` to the saved session record. Downsampled to
a fixed 150 points before saving (`downsampleTrace()` in
`sessionStats.js`) — a Continuous Session could run for hours,
producing tens of thousands of raw ~300ms samples, which would be
wasteful to store in full and pointless to render anyway (the chart is
only ~320 logical pixels wide). Also found and fixed the same way:
`samples` (the raw sample count) was computed but never actually
persisted to the session record either — `SessionDetailScreen` had no
access to it before this, which is why it never showed a sample count
at all.

**`IntensityChart.js`** (new component): a faithful react-native-svg
port of the team's PWA `IntensityChart.tsx` — same geometry and
gradient-stop math (verified directly against a synthetic trace:
high-intensity points correctly map near the chart's top, low-intensity
near the bottom, and the filled area path closes correctly), same
severity-band color segmentation (None/Mild/Moderate/High), just
translated from raw web SVG elements to their react-native-svg
equivalents and from CSS color variables to this app's own theme
colors. `react-native-svg` was already a project dependency (used by
`TabIcons.js`), so no new dependency was needed. Backward compatible:
an older session with no saved `intensityTrace` shows the same
"not enough data" fallback the PWA original has for a too-short trace.

## Settings — merged Sensitivity into Calibration
Requested consolidation: the old standalone "SENSITIVITY" section (the
manual full-scale-g preset picker) and the "CALIBRATION" section (the
Tremor Measurement wizard) both set the exact same underlying
`fullScaleG` setting — one manually, one automatically/more accurately
— so they're now one merged card under a single "CALIBRATION" header,
preset picker on top, a divider, then the existing Tremor Measurement
block. This also makes the Tremor Measurement card's existing copy
("more accurate than picking a preset above") literally true again,
which it wasn't while the two lived in separate sections.

The four presets moved from single-line pills ("0.35g", "1g", ...) to a
2x2 grid of larger two-line buttons — a small letter-spaced label on
top, the g-value below, both inside the same button. Relabeled per
request: Micro/Low/Mid/High — using "-sensitivity" rather than the
originally-requested "-frequency" wording, since this setting is a
full-scale amplitude (g-force) threshold, not a Hz value; flagged this
during design discussion and the user chose "-sensitivity" to keep the
labels accurate to what they actually control.

**Follow-up fix — label direction was backwards.** The initial
Micro/Low/Mid/High assignment (0.35g/1g/2g/3g respectively) had the
direction inverted: the card's own description text says "Lower =
more sensitive" (a smaller full-scale-g threshold takes less motion to
read as intensity 100), but "High-sensitivity" was on 3g — the
*least* sensitive option — and "Low-sensitivity" was on 1g, a fairly
sensitive one. Corrected to a Max → Min gradient that actually runs in
the right direction as g increases: `0.35g Max-sensitivity → 1g
High-sensitivity → 2g Low-sensitivity → 3g Min-sensitivity`.

## Tremor-band filtering — distinguishing voluntary motion from tremor
Raised question: an accelerometer on the wrist can't tell "lifting a
glass to drink" from "tremor" — both are real, above-noise-floor
motion, so both were counted equally toward live intensity, the
SteadyPoint Score, and the Dominant Freq stat. Discussed several
approaches (frequency-band filtering, motion-shape/kinematic
discrimination, adding the onboard gyroscope, manual activity tagging,
a learned classifier); band-filtering was the one selected to build
now, since Calibration Mode already measures a per-user tremor
frequency band (`tremorBandMinHz`/`tremorBandMaxHz`) but never actually
applied it anywhere — it was only stored and displayed.

**`bandLimitedRms()`** (new, in `dsp.js`) computes an RMS-equivalent
amplitude using only the FFT spectral content that falls inside
`[minHz, maxHz]`, instead of raw broadband time-domain RMS. A
deliberate reach-and-lift is a large, low-frequency directed motion
(well under a typical tremor band), so its energy is mostly outside the
band and gets attenuated; genuine tremor oscillation stays in-band and
passes through close to unchanged. Verified via synthetic signals: a
pure in-band 6Hz "tremor" signal passed through at 99.9% of its raw
RMS, a pure out-of-band 0.5Hz "reach" signal was reduced to 1.8%, and —
importantly — a combined signal (reach + tremor superimposed, modeling
essential tremor's kinetic component, which characteristically
*worsens* during a reach rather than damping the way Parkinsonian rest
tremor does) produced a band-limited RMS almost identical to the
pure-tremor case, confirming real tremor riding on top of a voluntary
motion is preserved rather than thrown out along with the gesture.

**(a) Soft-edged taper, not a hard cutoff.** Essential tremor's
frequency range (~4-12Hz) is wider and more individually variable than
Parkinsonian tremor's narrower ~4-6Hz band, and can drift somewhat with
age/disease duration between calibrations. A hard binary cutoff sitting
exactly on a calibrated edge risked zeroing out real tremor content
that drifted just slightly outside it. `bandLimitedRms()` instead
applies a raised-cosine (Hann-style) taper of `taperHz` (default 1.5Hz)
on each side of the band — full weight inside, a smooth ramp down to
zero weight `taperHz` past each edge. Verified synthetically: a signal
1Hz past the calibrated edge (inside the 1.5Hz taper) passed through at
~51%, a smooth partial value rather than a cliff.

**(b) Recalibration nudge.** Added `lastCalibratedAt` (ISO timestamp,
`initialState.js`/`persistence.js`) set whenever Calibration Mode
completes (`CalibrationResultsScreen.js`). Home now shows a dismissible
(by recalibrating) banner — "Time to recalibrate?" — once more than
`RECALIBRATION_REMINDER_DAYS` (90) have passed since the last
calibration, since a stale calibration makes this band-filtering less
accurate as a user's tremor changes over time. Deliberately only shown
when `lastCalibratedAt` is actually set — a user who's never run
Calibration Mode (e.g. an existing user grandfathered straight to
`hasCalibrated: true`) isn't nagged into starting it for the first
time; that's still an opt-in via Settings' existing "Open Calibration"
button.

Also fixed as a prerequisite: `CalibrationResultsScreen.js`'s "Save to
Settings" previously only dispatched `updateSettings()` without an
explicit `persistSave()` call, relying on the next session ending to
opportunistically carry the change to disk. Since `lastCalibratedAt`'s
entire purpose is to survive an app restart, this now calls
`persistSave()` directly after dispatching, same pattern already used
by `savePinnedSession()`/`SummaryScreen.js` elsewhere. (The other
Settings pickers — `fullScaleG`, `sonificationVoice` — still have this
same latent gap; not fixed here since it wasn't blocking this feature,
but worth knowing about.)

Wired into the live pipeline (`liveSession.js`'s `updateLiveMetrics()`,
called every 300ms during a session): the tremor band actually in
effect is fixed for the whole session at start time (`setTremorBand()`
in `sessionLogic.js`'s `startSession()`, mirroring the existing
`fullScaleG` pattern), and now persisted with each session record
(`tremorBandMinHz`/`tremorBandMaxHz`) for the same reason `fullScaleG`
already is — so a session stays self-describing even if the user's
calibrated band changes before their next one.

Known caveat, documented directly in `dsp.js`: Calibration Mode's
`FULL_SCALE_G` is still measured from broadband (non-band-limited) RMS
during the "find your peak" step — the ~300ms window used there is too
short for meaningful frequency resolution at tremor-band frequencies.
So a live band-limited reading during a similarly vigorous session will
generally read at or slightly below what the same motion scored
before this change, not exactly 100 even at calibration-level effort,
since some of that effort's energy sits outside the tremor band. For
genuine tremor-like motion (which is mostly in-band by nature) this
should be a small effect in practice — worth watching for during
real-device testing, not something addressed in this pass.

The pre-existing "Intensity shift" (start-level/end-level/reduction)
calculation in `sessionLogic.js`'s `endSession()` — used only for the
Session Detail insight-box text now, since its own stat cards were
removed in an earlier redesign — was deliberately left on raw broadband
RMS, unchanged, to keep this change scoped to the live intensity/score
pipeline.

### Band-filtering made opt-in — only for users who've actually calibrated
Follow-up question raised after the merged Settings redesign below: once
users can pick a manual full-scale preset instead of running Calibration
Mode, does the tremor-band filter above still make sense for them? It
didn't — `tremorBandMinHz`/`tremorBandMaxHz` are only ever *set* by
`CalibrationResultsScreen.js` on wizard completion, so a preset-only
user (or an existing user grandfathered to `hasCalibrated: true`
without ever running the wizard — see `persistence.js`) would silently
keep the factory-default 3-14Hz band applied to their live scoring,
without ever having seen or agreed to it.

Fixed by adding a third argument to `setTremorBand(minHz, maxHz,
active)` in `liveSession.js` — `active` gates whether
`updateLiveMetrics()` actually calls `bandLimitedRms()` at all;
when false, it falls back to plain broadband `rmsOf()`, i.e. the
original pre-band-filter behavior. `sessionLogic.js`'s `startSession()`
derives `active` from `!!settings.lastCalibratedAt` — deliberately not
`hasCalibrated`, since that field IS backfilled true for grandfathered
users (to avoid re-triggering the mandatory first-launch gate), while
`lastCalibratedAt` is only ever set by an actual completed calibration
run. Net effect: band-filtering only ever applies to someone who has
personally measured their own band at least once; picking a preset
afterward still only changes `fullScaleG` and leaves their measured
band (and the filtering) in place, which is correct — they earned that
band once and it doesn't need re-earning every session.

Also now persisted per session: `tremorBandFiltered` (boolean) —
whether band-filtering was actually applied to that specific session's
scoring, distinct from the `tremorBandMinHz`/`tremorBandMaxHz` values
themselves (which are always carried along informationally even when
not applied, same as before).

## Connectivity guard — disconnection mid-session
Reported bug: powering off the M5Stick during a session left the
session running indefinitely with a frozen intensity reading — nothing
was watching for a BLE drop once a session had started.

`react-native-ble-plx`'s `onDisconnected()` was already wired up
end-to-end (`ble.js` → `useBLE.js` → `state.isConnected` flips to
`false` via the `BLE_DISCONNECTED` reducer case), but nothing during an
*active session* was watching that flag — `RecordingScreen.js` only
ever read `state.isConnected` indirectly through the live BLE packet
stream drying up, which just froze the display rather than ending
anything.

Fixed with a small connectivity guard in `RecordingScreen.js`: a
`useEffect` tracks the previous `state.isConnected` value in a ref and,
on a `true → false` transition while the screen is mounted (i.e. a
session is actually running), calls `endSession()` with a new
`disconnected: true` flag rather than leaving the session to run
forever — this matters most for Continuous Sessions, which have no
timer of their own to eventually stop them.

`endSession()` (`sessionLogic.js`) treats a disconnection-triggered end
like any other end-of-session — it still stops timers/buffers, scores
whatever was captured, and persists the session via the normal
`addSession()` path — except:
- it skips sending the `STOP` BLE command (the device is already gone)
- the persisted record gets two new fields: `endReason: 'disconnected'`
  and a human-readable `statusMessage` explaining what happened
- navigation goes to a new dedicated `disconnected` route instead of
  the normal `summary` (Session Complete) screen, since the user needs
  to know *why* the session stopped, not see a congratulatory score

The new `DisconnectedScreen.js` explains the app lost connection, that
the session was already saved, and has a single "Return to Home"
button (`navigation.navigate('home')`, same pattern `SummaryScreen.js`
and `SetupScreen.js` already use). Registered as `disconnected` in
`RootNavigator.js`.

`SessionDetailScreen.js` shows a red status banner above the score ring
for any session with `endReason === 'disconnected'`, using the saved
`statusMessage`. Older sessions (no `endReason` field) render exactly
as before — the check is additive.

Not built (explicitly deferred by request): using an upcoming
M5Stick battery-level BLE command to pre-empt a disconnection before it
happens. This guard only reacts after the connection is already gone.

## Calibration debug logging
Added `CALIBRATION_DEBUG_LOGGING` in `CalibrationScreen.js`, matching
the same toggleable-flag pattern already established for sonification
(`SONIFICATION_DEBUG_LOGGING` in `audio.js`). **Currently set to
`true`** for this delivery, since it was requested to actively debug
an upcoming test — flip to `false` once done, same lifecycle as the
sonification logging had.

Logs three things, all under a `[calibration]` prefix:
- **Baseline settings** once, when Active Calibration begins:
  `FULL_SCALE_G`, `TREMOR_BAND_MIN_HZ`, `TREMOR_BAND_MAX_HZ`,
  `NOISE_FLOOR_G` — all read from `state.settings`, i.e. whatever was
  in effect *before* this calibration attempt
- **Every raw reading and tracker state** during Active Calibration
  (every ~300ms, matching the existing poll cadence): the raw RMS
  value, the running peak, the currently-sustained value, sustained
  seconds, and whether the threshold's been reached
- **Final computed values** once, when calibration completes: the new
  `FULL_SCALE_G`, the raw measured frequency band (or "none detected"),
  the derived `TREMOR_BAND_MIN_HZ`/`MAX_HZ` (after the ±1Hz buffer),
  `NOISE_FLOOR_G` (echoed unchanged, since calibration doesn't measure
  it), and the total recorded sample count — verified these are the
  exact same variables passed to the Results screen, not a separately
  computed (and potentially divergent) copy

## Continuous Session

**Redesigned from a pre-session toggle to an in-session one**: the
Quick Start card's sonification switch (added right after the initial
feature) was removed per explicit follow-up request — Continuous
Session now always starts silent (`feedbackType: 'visual'`), with a
new toggle on `RecordingScreen.js` (shown only for continuous
sessions, via the existing `isContinuous` check) letting the user turn
sonification on or off *while the session is running*. This needed no
new audio-wiring mechanism: the existing effect that sets up the audio
hook already depends on `audioEnabled` (derived from
`state.config.feedbackType`), so flipping the switch just calls the
same `actions.updateConfig({ feedbackType: ... })` used elsewhere, and
that existing effect automatically cleans up or re-registers the
sonification hook in response. The now-unused
`continuousSessionSoundOn` setting from the prior design (and its
backfill entry) was removed — harmless if it lingers in an existing
user's already-saved data, just no longer written for new/backfilled
settings.

A new Quick Start button for sessions with no fixed duration, running
until manually ended — for testers who want to monitor tremors on an
ongoing basis rather than a preset 5/10/20-minute block. First
iteration: no sound, no guide, per explicit scope.

Reuses existing infrastructure rather than adding new mechanisms:
- `duration: null` on the new `CONTINUOUS_TEMPLATE` (`HomeScreen.js`)
  makes `totalSeconds` falsy in `startSession()`/`startTimers()`
  (`duration * 60` → `0`), and `startTimers()`'s auto-completion check
  (`if (totalSeconds && ...)`) already skips entirely when that's
  falsy — verified this directly rather than assuming. No new timer
  logic needed.
- Launched via the same `quickStart()` function every other Quick
  Start template already uses, so the existing "not connected" alert
  in `startSession()` applies automatically — no new connection-check
  code needed, per explicit request to reuse existing error handling.
- `RecordingScreen.js`'s countdown and progress bar (which would
  otherwise show a meaningless 00:00/empty bar, or divide by zero for
  the progress fraction) are hidden for continuous sessions —
  elapsed time still displays and counts up normally.
- New `InfinityIcon` added to `TabIcons.js`, matching the existing
  icon component style.
- `endSession()`'s saved `duration` (computed from actual elapsed
  time, not the original config) is unaffected — a continuous session
  saves and displays completely normally once ended.

**Sonification toggle** (added after the first iteration): a switch on
the Continuous Session card lets the user turn sonification on for
this session type, defaulting to off. Persisted as
`state.settings.continuousSessionSoundOn`, and computed into the
actual `feedbackType` (`'both'`/`'visual'`) at press time rather than
baked into the static template. The switch sits in its own row,
outside the "start" `Pressable`, deliberately — nesting a `Switch`
inside a `Pressable` risks the tap bubbling up and accidentally
starting a session when the user only meant to flip the toggle.

Sound state persistence for "Start Similar Session" needed no new
code: it already worked, since `feedbackType` is a normal field on the
saved session record and `startSimilarSession()` already reused it.

**Related bug found and fixed while implementing this**: a saved
session's `duration` is always its actual elapsed time, computed the
same way regardless of whether the original session had a fixed
length or was continuous — there was no way to tell them apart on the
record. This meant "Start Similar Session" on a past Continuous
Session would relaunch it as a **fixed-duration** session matching
whatever length it happened to run before, not as another continuous
one. Fixed by adding an explicit `isContinuous` flag to the session
record (set from `!state.config.duration` before it gets overwritten
by elapsed time), and `startSimilarSession()` now checks it — passing
`duration: null` instead of the saved value when relaunching a
continuous session. Backward compatible: an older session with no
`isContinuous` field falls through to the previous (correct, since it
was never continuous) behavior.

## Calibration Mode — Phase 1 (per Calibration_Mode_Design.pdf)


**Spec-compliance fixes**, found via a direct line-by-line comparison
against the design doc's text, at the user's request:

1. **Short RMS window**: the design doc specifically calls for "a short
   window (about 300ms)" for the amplitude RMS calculation — this was
   incorrectly computed over the much longer, general-purpose ~2-second
   rolling buffer instead, which would dilute a brief (under-half-a-
   second) tensing action with surrounding calmer motion and likely
   under-report the user's true peak effort. Fixed with a dedicated
   short window (`SHORT_WIN = 15` samples, ~300ms, `shortWinX/Y/Z` in
   `liveSession.js`), mirroring the same pattern already used for
   sonification's longer frequency-detection window — just short
   instead of long.
2. **`FULL_SCALE_G` value**: the design doc says "the RMS value
   *sustained during that 5-second window*" becomes the candidate value
   — this was using the all-time peak RMS instead, which could be an
   unrepresentative one-off spike (a bump, a sudden jerk) rather than
   genuinely sustained effort. Fixed in `createSustainedPeakTracker()`:
   now tracks recent readings and computes the average of those that
   actually qualified as "at the peak" within the current sustain
   window, ignoring any one-off spike once it's aged out — verified
   directly (both in isolation and against the real, unmodified
   production code) with a synthetic scenario: an early spike followed
   by genuine sustained effort at a meaningfully lower level now
   correctly reports the sustained level, not the spike.
3. Added the requested reassurance text under the Current intensity bar
   ("This is your longest, most intense tremor so far.") — corrected an
   apparent typo in the requested wording (a period that would have
   split it into a sentence fragment) to a comma.


**Sustained-peak tracker tuning fix**: real device testing found the
"100 Level Reached" button would enable only briefly then immediately
disable again during genuine vigorous shaking. Verified the cause
directly: real tremor-like motion naturally oscillates rather than
holding a perfectly flat plateau, and the original 85%-of-peak
tolerance combined with a hard reset-to-zero on any dip meant the
sustain counter almost never survived a full natural oscillation cycle
long enough to accumulate 5 continuous seconds. Confirmed with a
synthetic test simulating realistic oscillating vigorous motion: the
old settings never reached 5 seconds even after 9 simulated seconds of
sustained effort. Fixed by loosening the tolerance to 60% of peak and
replacing the hard reset with a decay (at 2x the accumulation rate) on
a dip — reverified with the same synthetic test (now reaches the
threshold reliably) and a genuine-stop test (still correctly decays
back to ~0 within a few seconds, not stuck showing false progress).

**"Current intensity" display fix**: was implemented incorrectly as a
static indicator (100% filled the moment any signal existed at all,
regardless of actual movement) rather than a live reading — confirmed
via user testing this looked constantly full and meaningless. Now
shows current RMS relative to the running peak found so far, updating
live as intensity actually rises and falls.


**Critical fix**: real testing found Active Calibration appeared to
completely hang — no data, no live meter movement at all. Root cause:
`CalibrationScreen.js` managed the local buffer state
(`beginSessionBuffers()`/`stopRecordingBuffers()`) but never sent the
actual BLE `sendCommand('START')` that tells the M5Stick's firmware to
begin transmitting — the normal session flow in `sessionLogic.js`
always does this, but this screen was built independently of that flow
and the step was missed entirely. Device stayed connected but
genuinely never sent a single packet. Fixed by adding
`sendCommand('START')` when Active Calibration begins and
`sendCommand('STOP')` both on successful completion and on unmount
cleanup (so backing out mid-calibration doesn't leave the device
streaming needlessly) — same command strings already used elsewhere.


**Follow-up fix**: real testing surfaced a gap the design doc's mockups
didn't address — a first-launch user has no way to reach the
device-connect button at all (it normally lives on Home, which the
mandatory calibration gate blocks access to), so "Calibrate Now" led
into a flow with no way to actually connect. Fixed by adding a
connection card directly to `CalibrationWelcomeScreen.js`, reusing the
exact same `useBLE()`/`state.isConnected` pattern as Home's own connect
row for consistency — and disabling "Calibrate Now" until connected,
with the footer note changing to explain why. `CalibrationScreen.js`'s
existing "Connect your device first" fallback (for the separate case of
launching calibration from Settings, or a mid-flow disconnect) is
unchanged and still needed as a safety net.

Lets each user personalize `FULL_SCALE_G` and their tremor frequency
band by physically producing their worst tremor for a few seconds,
instead of using generic fixed defaults for everyone. Built in phases;
this is Phase 1 (the calibration flow itself) of five agreed phases —
Settings manual-editing UI, mid-session overflow auto-detection,
band-pass filtering of scoring/graphs to the calibrated band, and
retroactive historical rescoring are separate, later work.

**New screens**: `CalibrationWelcomeScreen.js` (mandatory, first-launch
only, no skip), `CalibrationScreen.js` (Setup + Active Calibration
combined as internal phases — Setup is pure instructional copy, Active
Calibration runs a live BLE recording), `CalibrationResultsScreen.js`
(shows computed values, Save/Recalibrate). Reachable from Settings
("Open Calibration"/"Recalibrate") for any subsequent recalibration.

**Two new core algorithms in `dsp.js`**, both went through real,
test-driven iteration before being trusted — not shipped on first pass:

- `createSustainedPeakTracker()` — stateful, live amplitude tracker for
  `FULL_SCALE_G`. Worked correctly from the first design; verified with
  a ramp-hold-reach scenario and a sudden-drop-resets-the-counter case.
- `detectSustainedFrequencyBand()` — batch analysis for the tremor
  frequency band, run once on the full calibration recording. Went
  through three rounds of finding and fixing real bugs via direct
  testing: (1) an initial design tracking many individual frequency
  bins over time required a Hann window to avoid spectral-leakage false
  positives, and even then under-detected a realistic jittering-tremor
  signal — redesigned around a simpler, more robust concept (single
  dominant frequency per short time-slice, reusing the same well-tested
  idea behind `combinedDominantFreq()`, looking for stretches of
  mutually-consistent consecutive readings); (2) the sliding analysis
  window itself was found to inflate a brief transient's apparent
  duration by roughly the window's own length — a 1-second bump could
  appear "sustained" for 3+ seconds purely from window overlap — fixed
  by subtracting the window length from the apparent duration before
  the sustain check; (3) near-silent recording segments produced a
  "peak" frequency driven by floating-point noise rather than real
  signal — the same category of bug already found and fixed twice
  elsewhere in this project (sonification, the Dominant Freq stat),
  fixed the same way with a minimum-signal gate. Final version verified
  against an isolated brief transient (correctly rejected), a pure
  steady tone (correctly detected), and a realistic randomly-jittering
  tremor-like signal with a transient mixed in (correctly captured the
  true band, correctly excluded the transient) before being wired in.

**`rmsToLevel()` in `dsp.js`**: `NOISE_FLOOR_G` is now a configurable
parameter (`noiseFloorG`, defaulting to `DEFAULT_NOISE_FLOOR_G`),
matching how `fullScaleG` already worked — per the design doc, though
not yet exposed in any UI (that's the Phase 2 Settings work; the
setting exists in storage now, ready for that phase to read/write it).
Not part of the calibration measurement flow itself, same as the
design doc specifies.

**Mandatory first-launch gate**: implemented via `RootNavigator.js`'s
own `initialRouteName` (conditional on `state.settings.hasCalibrated`)
rather than a redirect-after-mount — avoids any flicker or race
condition, and is safe because `App.js` already gates rendering
`RootNavigator` at all until persisted settings have fully loaded.

**Critical fix for existing users**: found and fixed a real bug before
shipping — an existing user's already-persisted settings (saved before
these new fields existed) would restore with `hasCalibrated` and the
new tremor-band fields simply `undefined`, which would both crash
`SettingsScreen.js` (`undefined.toFixed`) and incorrectly force any
*existing* user into the mandatory first-launch flow after a routine
app update. Fixed in `persistence.js`'s `persistLoad()`: existing
users' settings are now backfilled with the new fields on load —
critically, `hasCalibrated` backfills to `true` for them specifically
(not the fresh-install default of `false`), since merely having prior
saved data at all proves this is a returning user, not someone who
should suddenly hit a mandatory gate they'd never seen before. A
genuinely brand-new install is unaffected by this (there's nothing to
backfill) and still correctly gets `hasCalibrated: false`.

**Deliberately not yet implemented, to avoid overpromising**: the
design doc describes saving calibration as also retroactively
recalculating past sessions' scores against the new `FULL_SCALE_G`.
That's real, separate work blocked on this app not yet persisting the
raw per-session data needed to do it (see the phasing discussion) —
`CalibrationResultsScreen.js` only writes the new settings; its copy
was deliberately written to not claim historical rescoring happens.

## Dominant Freq stat — same noise-during-stillness bug, separately fixed
Confirmed via real user testing (not the sonification investigation
above — a genuinely separate, older calculation): the "Dominant Freq"
stat (`state.liveFreqHz` in `liveSession.js`, saved as `session.freq`)
had the exact same category of bug as the sonification frequency
detector — reporting noise as a "dominant frequency" during stillness,
since its `dominantFreq()` function has no protection against this.

This one is more consequential, since the saved value isn't just a
live display — it's persisted with every session and shown in
Summary/Session Detail. Confirmed directly: a session with vigorous
~10Hz motion, ended after holding the device still for the final ~5
seconds, saved a meaningless ~1Hz reading instead of anything
reflecting the actual session — because the saved value is a snapshot
of whatever the live reading happened to be at the *exact instant*
the session ends, and that instant fell during the stillness.

Fixed the same way as sonification's version: gated behind
`MIN_INTENSITY_FOR_DOMINANT_FREQ = 8` in `liveSession.js` (same
threshold value, for consistency) — below that, `liveFreqHz` is left
at its last real value rather than updated with noise. This means
both the live display and the end-of-session snapshot now reflect
genuine last-active motion, even if the session happens to end during
a still moment. `dominantFreq()` itself (the 1-15Hz-restricted,
Y-axis-only function) is unchanged — only how/when its result gets
applied to `liveFreqHz` changed. This function has exactly one call
site, so the fix is fully contained.

**Follow-up**: also replaced the Y-axis-only `dominantFreq()` call
with `combinedDominantFreq()` (the same all-three-axis function
sonification uses, via the same longer `freqWinX/Y/Z` window) — a
rotation or tremor that happens to show up mostly on a different axis
was previously missed entirely just because of how the device was
oriented. Verified directly with a synthetic test: motion at 6Hz
concentrated on the X/Z axes with a nearly-flat Y axis is now
correctly detected, where the old Y-axis-only version would have seen
mostly noise. `combinedDominantFreq()`'s own search is intentionally
unrestricted (see dsp.js), so `DOMINANT_FREQ_MIN_HZ`/
`DOMINANT_FREQ_MAX_HZ` (1-15Hz) clamp the result afterward to the same
reasonable clinical range the old function used to enforce internally.
`dominantFreq()` remains exported from `dsp.js`, just unused by this
file now — this changes how newly recorded sessions compute this stat,
so it isn't directly comparable to sessions recorded before this fix,
similar to the `fullScaleG` sensitivity setting's own comparability
caveat.

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

## Custom tonal range — user-defined sonification register
Based on user feedback: several users liked the three instrument choices
but wanted a tonal range of their own rather than being limited to
Cello/Viola/Violin's fixed registers. Added a fourth **Custom** option to
Settings > Sonification, alongside the existing three.

- **Settings > Sonification** is now headed "Tonal Range" instead of
  "Instrument" (the section now covers more than instrument choice), with
  updated description text. A fourth pill, **Custom**, sits next to Violin.
- Selecting **Custom** expands a **Custom Tonal Range** sub-pane in place,
  directly below the pill row — pressing Custom again while it's already
  selected and expanded collapses the sub-pane (pressing a different
  instrument also collapses it, and switches voices as normal). The
  sub-pane holds:
  - A **Lower** slider (with its live value, e.g. "Lower 200hz") and an
    **Upper** slider ("Upper 700hz"), each spanning 50-1000Hz —
    deliberately wider than any single existing instrument's register, so
    Custom can cover one of them, straddle several, or sit entirely
    outside all three
  - Below the sliders, editable **Lower**/**Upper** numeric text fields,
    synced to the sliders in real time in both directions — dragging a
    slider updates its field, typing a valid number in a field moves its
    slider
  - **Validation**: Lower is always kept at least 10Hz below Upper (a
    `CUSTOM_RANGE_MIN_GAP_HZ` floor) — dragging/typing one past the other
    clamps it to that minimum gap rather than allowing an invalid or
    zero-width range. Both are clamped to the 50-1000Hz slider bounds.
    An invalid or empty text-field entry doesn't corrupt the stored
    setting — the field simply snaps back to the last valid committed
    value on blur.
- **Persisted** as `customTonalRangeMinHz`/`customTonalRangeMaxHz` in
  Settings (new backfill defaults in `persistence.js`: 200/700Hz, per the
  product's stated default), independent of which voice is currently
  selected — so switching to Cello and back to Custom doesn't lose a
  previously-entered range. The sub-pane's expand/collapse state itself is
  **not** persisted (purely transient UI state) — Custom always opens
  collapsed, even if it was left expanded last session.
- **Underlying sound**: originally shipped reusing the Viola sample's
  playback voice (pitch-shifted into the user's custom range); **changed
  to a pure sine-wave oscillator** per direct tester feedback asking for a
  cleaner, more precise tone than a pitch-shifted instrument sample. A new
  `SineVoice` class in `audio.js` (alongside the existing sample-based
  `SampleVoice`) wraps a Web Audio `OscillatorNode` (`type: 'sine'`)
  through the same pan/lowpass-filter/gain staging as the other voices —
  `setFrequency()` just sets the oscillator's `frequency` AudioParam
  directly to the mapped Hz value every update, with no sample loading, no
  reference-pitch/semitone math, and no pitch-shifter needed. Per the Web
  Audio spec an oscillator can only be `start()`ed once, so `SineVoice` is
  constructed and started once in `initAudio()` and is synchronously ready
  (no async `loadPair()` to wait on, unlike the sample-based voices).
- **Session wiring**: `setCustomTonalRange(minHz, maxHz)` (`audio.js`) is
  called once at `startSession()` time in `sessionLogic.js`, alongside the
  existing `setActiveVoice()`/`setFullScaleG()`/`setTremorBand()` calls —
  fixed for the whole session even if Settings changes mid-session,
  matching that established pattern. It's called unconditionally (cheap,
  harmless when a non-Custom voice is active).
- **Dependency added**: `@react-native-community/slider` (pinned to
  `4.5.7`, the latest release on the 4.x line — the 5.x line targets
  newer RN/new-architecture setups, not a fit for this project's RN
  0.75.4 bare/old-architecture setup).

## Fix — buzzy/pulsing artifact on the Custom sine voice
Testers reported Custom's sine tone sounding buzzy with a "hard, regular
background techno pulsing quality" — notably different from a comparable
pure-tone sonification in the team's Flutter app, which sounds clean and
continuous. Investigated via an outside code review (shared as
investigation notes) proposing two theories: (1) the FFT recomputing on
every BLE packet without throttling, a heavy enough load to cause
irregular audio-clock delays, similar to a previously-confirmed load
ceiling with 6 simultaneous pitch-shifters; (2) the lowpass filter's
cutoff being continuously modulated, a known Web Audio subtlety
independent of a sine's lack of harmonics to actually filter.

**Theory (1) doesn't hold up against this codebase's own code**: the FFT
is already throttled to every ~300ms (`FREQ_RECOMPUTE_INTERVAL_MS`), not
every packet — and that throttle is identical for all four voices, so if
compute load were the cause, Cello/Viola/Violin would show the same
artifact, which nobody reported.

**Actual root cause, confirmed by inspection**: that same 300ms throttle
gated the *entire* rest of `updateAudio()` — not just the FFT, but gain
and brightness too (flagged by the code's own prior comment: "throttles
ALL native calls below, not just frequency"). Gain/frequency/brightness
all used a short `setTargetAtTime()` time constant (0.05-0.08s) that
reached its target well within the 300ms gap and then sat perfectly flat
until the next recompute — a periodic "snap, then hold" pattern repeating
~3.3x/sec. That's an audible periodic modulation on its own, independent
of CPU load. A pure sine has no harmonic content to mask this; the
sample-based voices' own continuous timbral motion (bow noise, vibrato,
broadband harmonics) buried it completely — which is exactly why only
Custom exposed the problem, and why Flutter's (presumably more
continuously-updated) pure tone sounded clean by comparison.

**Fix, in `audio.js`, applied to all four voices** (confirmed to help
everyone and not just Custom, discussed and confirmed with the user
before implementing — see git history for the specific exchange):
- **Gain/brightness decoupled from the FFT throttle** — they now update
  every call (real BLE packet cadence, ~50Hz), removing the periodic
  volume stepping entirely. Only the FFT/frequency recompute itself stays
  on the 300ms throttle (unavoidable — it's genuinely expensive at full
  packet rate).
- **`FREQ_RAMP_TIME_CONSTANT`** (new named constant, `0.25`, replacing the
  previous ad hoc `0.05` inline in both `SampleVoice.setFrequency()` and
  `SineVoice.setFrequency()`) — lengthened so pitch glides continuously
  across close to the full 300ms gap between FFT recomputes, instead of
  snapping to target early and then holding flat.

Not yet re-confirmed via `SONIFICATION_DEBUG_LOGGING` + an actual
on-device listening test — flip that flag to watch `smoothedFreq` for
stability (supports this theory) vs. wild jitter (would instead point
back toward the FFT-load theory) if the artifact persists.

## Follow-up fix — Custom's pitch source replaced (FFT → direct level)
On-device re-test after the fix above: Cello/Viola/Violin sounded
noticeably better, but Custom's sine still buzzed/pulsed. Compared
against the team's actual production sonification — not the HTML
prototype's dead/commented-out "AUDIO ENGINE 2.0" experiment (sawtooth +
triangle + filter `StringVoice`), which turned out to be unused code and
briefly, incorrectly, treated as the reference — but the real deployed
engine, `src/sp/hooks/use-tremor-audio.ts` in the team's TanStack/React
PWA repo, confirmed via direct source review (and tracing its call site
in `app.active.tsx` → `use-active-session.ts`'s `onSample`).

**What that engine actually does, confirmed by reading it directly:**
- Three oscillators — `sine` (X, 220Hz), `sine` (Y, 200Hz), `triangle`
  (Z, 110Hz). **The sine waveform itself is proven innocent** — it's
  already in production, sounding clean.
- **No FFT anywhere in the pitch path.** Pitch comes from `std()`
  (standard deviation of the rolling per-axis window — see `tremor.ts`),
  fed through `freq = base * 2^(octaveSpread * min(1, sd/2))`. `std()`
  is cheap and continuously computable; there's no estimation noise, no
  recompute-interval lag, nothing to smooth.
- Called directly from every raw BLE sample (`onSample`), with **zero
  throttling** — confirmed by reading the call chain, not assumed.

This reframes the real cause for Custom specifically: this engine's
pitch comes from `combinedDominantFreq()`, an FFT over a 5-second window
recomputed only every 300ms — a meaningfully noisier, laggier pitch
source than a continuously-computed `std()`, even after lengthening the
ramp time constant in the fix above (which smoothed the symptom without
removing the underlying jitter in the signal feeding it). A sine has no
harmonic content to mask that residual jitter; Viola's sample timbre
buries the exact same FFT jitter completely — which is why only Custom
kept buzzing even after the first fix helped everyone else.

**Fix, in `audio.js`, scoped to Custom only** (a deliberate, explicitly
user-confirmed design change — see the exchange in this session's
history before implementing): Custom's pitch no longer uses the FFT path
at all.
- New branch in `updateAudio()`: when `activeVoiceName === 'custom'`,
  pitch is computed directly from `normLevel` — the same already-
  calibrated 0-100 tremor level already used for gain, not a new signal
  — via `freq = minFreq * (maxFreq/minFreq) ^ normLevel` (exponential/
  octave interpolation, not linear-Hz, matching the PWA's own
  octave-based approach and giving equal perceptual pitch steps for
  equal level changes). No FFT, no throttle, recomputed every packet,
  then returns early — skipping the FFT-gated section below entirely.
- Deliberately reuses the existing `tremorLevel`/`normLevel` (already
  tied to the user's own calibrated `fullScaleG`) rather than computing
  a fresh `std()`-based measure from `recentX/Y/Z` — avoids introducing
  a second, differently-calibrated "how much movement counts as
  maximal" scale alongside the one the rest of the app already uses.
- New `CUSTOM_FREQ_RAMP_TIME_CONSTANT` (`0.05`, matching the PWA's own
  continuously-updated oscillators) for `SineVoice.setFrequency()` —
  much shorter than `FREQ_RAMP_TIME_CONSTANT` (`0.25`, still used by
  `SampleVoice`/Cello/Viola/Violin), appropriate now that Custom's pitch
  recomputes every ~20-40ms rather than every 300ms.
- **Cello/Viola/Violin are completely untouched** — they keep the
  original "pitch = FFT dominant tremor frequency" design. This is a
  deliberate scope boundary, not an oversight: that design isn't broken
  for them (their sample timbre already masks FFT jitter fine), and
  reintroducing the PWA's actual three-simultaneous-axis-voice
  architecture to those voices would undo the project's own earlier,
  deliberate "single combined voice" redesign (see that section above).

**Genuine behavior change, confirmed with the user before implementing**:
Custom's pitch now represents "how much the motion is spreading" (an
amplitude-like measure) rather than "the tremor's own oscillation rate" —
matching what the proven-clean production PWA actually does, but a real
semantic change from the original "pitch = dominant frequency" spec,
scoped to Custom only.

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

## Second follow-up fix — Custom's residual ~1-2s pulsation
Still on-device, after the FFT-removal fix above: Cello sounded clean, and
Custom's tone itself was much cleaner, but a periodic pulsation every
~1-2 seconds remained — not present on Cello, and not present on the
Flutter/PWA app.

**Leading explanation**: `tremorLevel` is the RMS of a ~2-second rolling
window (`ROLL_WIN` in `liveSession.js`). If the actual motion being
measured has its own period anywhere near that window length (e.g. a
deliberate ~0.5-1Hz test shake — plausible, since that's a natural,
comfortable rate to wave a phone by hand, well *below* the 3-14Hz
physiological tremor band this whole system (band-pass, window length)
is actually tuned for), a window that short relative to the signal's own
period doesn't produce a flat RMS value — it genuinely ripples once per
cycle of the input motion. That ripple has always been present in
`tremorLevel` and already fed gain on every voice, but a volume ripple is
subtle, easy to miss, especially under a sample's own texture. Once
Custom's *pitch* started tracking that same level signal (the prior
fix), every bit of that ripple became an audible pitch wobble instead —
the ear is far more sensitive to pitch modulation than volume modulation
of the same relative size, and a bare sine has nothing to mask it with.
Cello's pitch is immune since it's still FFT/frequency-domain-based,
which doesn't care how much the amplitude envelope ripples.

**Fix, in `audio.js`, scoped to Custom's pitch only** (gain stays fully
responsive/unsmoothed, as before): a new `customSmoothedLevel` module
variable, blended each packet via `CUSTOM_LEVEL_SMOOTHING_ALPHA` (`0.05`,
~0.4s time constant at the engine's assumed ~50Hz cadence) before feeding
the exponential pitch-mapping formula. Reset alongside the engine's other
per-session state in `initAudio()`/`silenceAudio()`.

**Known limitation, confirmed via simulation, not yet re-tested
on-device**: this time constant meaningfully damps a ~1Hz ripple (~60%
reduction) but only partially damps a slower ~0.5Hz one (~37%
reduction) — going heavier would start making pitch noticeably sluggish
to respond to genuine tremor onset/offset, a tradeoff not made without
user input. Also worth directly testing: shaking at an actual
tremor-like rate (4-8Hz, well above the 2-second window's resolution)
rather than a slower deliberate test shake — if the pulsation
disappears entirely at a realistic tremor rate, this is largely a
bench-testing artifact from testing below the system's designed
frequency range, not something real patients would hear.

## Third follow-up fix — pulsation narrowed to level-transition moments
On-device re-test: the smoothing fix reduced the pulsation's frequency,
but it still occurred — now reported specifically WHILE the tremor level
is actively rising or falling, not during a steady level. That's a
different signature than the windowed-RMS-ripple theory above (which
would predict steady-state ripple regardless of whether the level is
changing), pointing at something else.

**Leading explanation**: Cello's pitch gets a new value at most
~3.3x/sec (`FREQ_RECOMPUTE_INTERVAL_MS`). Custom's `FREQ_EPSILON` gate,
by contrast, rarely trips during a STEADY level (the computed frequency
stays within 2Hz of `lastSent.freq`, so `setFrequency()` is barely
called) but trips on nearly every packet while the level is actively
changing (the target keeps drifting past the epsilon) — meaning Custom
can burst 40-50 `setFrequency()` calls/sec specifically during the
moments this reportedly occurs, far more than Cello ever issues. This
exact native audio library has already shown a real scheduling
limitation once before in this project — the `cancelScheduledValues()`
SIGSEGV (see "Crash fix" above), traced to however many accumulated
AudioParam automation events had built up. A burst of rapid-fire
`setFrequency()` calls landing on the native audio graph is a plausible
trigger for a similar, non-crashing glitch, and lines up with "occurs
during changes, not during steady tremor" much better than the earlier
windowed-RMS theory does.

**Fix, in `audio.js`, scoped to Custom only**: new
`CUSTOM_PITCH_UPDATE_INTERVAL_MS` (`50`ms, ~20/sec) throttles only the
actual native `setFrequency()` push — `customSmoothedLevel` itself still
updates every packet (cheap, pure JS, no native call). Still far more
responsive than Cello's 300ms, while cutting Custom's native call volume
during transitions by more than half. New `lastCustomPitchUpdateTime`
module variable, reset alongside the engine's other per-session state in
`initAudio()`/`silenceAudio()`.

Not yet re-tested on-device — if this doesn't fully resolve it, the next
things to try, in rough order of how likely they are to help: lengthen
`CUSTOM_PITCH_UPDATE_INTERVAL_MS` further (trades responsiveness),
increase `FREQ_EPSILON` (coarser pitch resolution, fewer calls), or
revisit whether the windowed-RMS theory from the prior fix is actually
the dominant factor after all (in which case lengthening
`CUSTOM_LEVEL_SMOOTHING_ALPHA`'s time constant would be the next lever).

## Fourth follow-up fix — gain/brightness were never smoothed either
On-device re-test: better, but the pulsation still occurred during
intensity changes, in both directions (rising and falling). This is the
actual, complete root cause, found by tracing the signal's own update
cadence rather than theorizing further about the oscillator or the
native library.

**Root cause**: `tremorLevel` — the single value driving both gain and
pitch — is NOT continuous. It's recomputed by `updateLiveMetrics()`'s
own separate 300ms timer in `liveSession.js`, not by `updateAudio()`
itself. So even though `updateAudio()` runs every packet (~20ms), the
*value* it reads only changes ~3.3x/sec — a staircase, not a smooth
curve. During a steady tremor, consecutive steps are nearly identical,
so the staircase is invisible. During an actively rising or falling
level, each 300ms step is a real, audible jump. The two fixes above
smoothed PITCH against exactly this — but **gain and brightness were
never smoothed at all**, directly exposed to this same staircase since
the very first build, on every voice. A volume jump every 300ms during a
change is a literal pulsation, in both directions — this has likely
been the dominant real cause all along, just far less audible wrapped in
Viola's/Cello's own texture than on a bare sine (the same "sine exposes
everything" theme throughout this entire investigation).

**Fix, in `audio.js`, scoped to Custom only**: restructured
`updateAudio()` so the `activeVoiceName === 'custom'` branch now runs
*first* and handles gain, brightness, AND pitch together, all three
reading the SAME `customSmoothedLevel` already computed for pitch,
instead of gain/brightness using raw `normLevel`. This closes two gaps
at once: the staircase itself (now smoothed before it reaches any
AudioParam), and a subtler, separate risk — gain/brightness snapping
instantly to each new step while pitch glides smoothly beside them,
which could itself read as a mismatched-timing artifact independent of
the staircase. Cello/Viola/Violin's gain/brightness remain fully
unsmoothed/responsive in the generic path below, unchanged — nobody has
reported this as a problem for them, so there's no reason to trade away
their responsiveness pre-emptively.

Not yet re-tested on-device. If a residual pulsation still survives
this, that would point at something other than the level signal itself
— worth getting a `SONIFICATION_DEBUG_LOGGING` capture at that point
(now also prints `gain=` alongside `level=`/`smoothedLevel=`/`freq=`)
during an actual episode, rather than continuing to theorize blind.

## Fifth follow-up fix — smoothing gain/brightness made the pulsation faster, not gone

Tested on-device: the fourth fix above made things worse in a specific
way — the pulsation became noticeably *more rapid*, and was now
perceived as *closer in pitch* to the main tone rather than a separate
low thump.

Root cause: `customSmoothedLevel` creeps toward its target by a small
amount on every packet (`updateAudio()` runs at BLE packet cadence,
roughly every 20ms), using a fixed per-packet alpha rather than a true
time-based decay. `GAIN_EPSILON` (0.03) and `BRIGHT_EPSILON` (0.02) are
small enough that nearly every packet's tiny creep still exceeds them,
so `setGain()`/`setBrightness()` were calling into the native
`setTargetAtTime()` ramp on almost every packet during a transition —
a brand new ramp target arriving every 20-40ms, well before the
previous ramp had settled. Repeatedly re-targeting an exponential ramp
that fast is itself a form of amplitude modulation, at a packet-rate
frequency (tens of Hz) — which is exactly "more rapid," and which
shows up acoustically as sidebands sitting close to the carrier
frequency — exactly "closer in pitch to the underlying tone." Pitch
was already spared this because `CUSTOM_PITCH_UPDATE_INTERVAL_MS`
already throttled its native push; gain/brightness had no such
throttle, so they took the full brunt of it once they started reading
the continuously-creeping smoothed value instead of the static
per-300ms raw value.

**Fix, scoped to Custom only**: gain and brightness now sit behind the
exact same throttle gate as pitch (`CUSTOM_PITCH_UPDATE_INTERVAL_MS`,
the same clock/variable), so all three only reach the native
AudioParams once per interval, together — instead of gain/brightness
retargeting on every packet while pitch waits for its turn.
`customSmoothedLevel` itself still updates every packet underneath
(cheap, pure JS); only how often that value is actually pushed into
the native audio graph is gated now. Cello/Viola/Violin are untouched.

Not yet re-tested on-device.

## Sixth follow-up — diagnostic build for a within-session escalation report

Latest on-device report changes the picture: the sixth build (throttled
gain/brightness) started out clean, but the pulsation got MORE frequent
the longer the session ran, only during active level changes — never at
rest, never while holding a steady level.

That pattern doesn't fit a pure per-transition artifact (which should
behave identically regardless of how long the session has been running).
It does fit scheduled-`AudioParam`-event accumulation on the native
audio engine: this exact library (`react-native-audio-api`) has already
caused one confirmed crash from exactly that — a SIGSEGV inside its own
`cancelScheduledValues()`, traced to however many automation events had
piled up by that point in a longer session (see the dated note near the
top of `audio.js`). We can't call `cancelScheduledValues()` to clear
that backlog — that's the same call that crashed it. Custom's oscillator
is also a single node that's lived for the entire session since
`initAudio()`, pushed roughly 6x more often (every 50ms) than Cello's
pitch-shifter AudioParam ever is (every 300ms) — so if events really are
piling up unboundedly, Custom should accumulate noticeably faster.

Rather than restructure Custom's update architecture on this theory
alone, the diagnostic console log (`SONIFICATION_DEBUG_LOGGING`) is
temporarily flipped **on** in this build, and now also prints
`elapsedSec` (time since the session's audio started) and `pushCount`
(a running total of native setFrequency/setGain/setBrightness calls made
on Custom since then). The idea: if pulsation onset/worsening tracks a
rising `pushCount` specifically, that confirms event accumulation as the
cause. If it tracks elapsed time regardless of how many pushes have
actually happened (e.g. mostly holding steady, few pushes logged, but it
still degrades), that rules accumulation out and points somewhere else
entirely.

**Next step**: run a session on Custom long enough to reproduce the
escalation, watching the Metro/Xcode console, and capture the log lines
around when the pulsation starts and when it visibly worsens (the
`elapsedSec=`/`pushCount=` values at those moments are the key data).
`SONIFICATION_DEBUG_LOGGING` should be flipped back to `false` once this
is resolved — it's left on for this one diagnostic build only.

### Diagnostic bug found and fixed before the data meant anything

A real device log from a motionless ("at rest") run showed `pushCount`
climbing at essentially the same rate (~17/sec) as a run where the level
was actively changing throughout — even though `gain`/`freq` never moved
off their resting values in that log. That's a contradiction: if nothing
is being pushed to the native audio graph, the count shouldn't be
climbing at all. Looking at the code confirmed why: `customPushCount`
was incremented right after the 50ms throttle gate opened, unconditionally
— before the epsilon checks that decide whether `setGain()`/
`setBrightness()`/`setFrequency()` actually get called. So it was only
ever measuring "how many times has 50ms elapsed," i.e. elapsed time in
disguise, completely confounded with the one variable the whole
diagnostic exists to separate from elapsed time.

**Fix**: replaced the single `customPushCount` with three separate
counters (`customGainPushCount`, `customBrightPushCount`,
`customFreqPushCount`), each incremented only inside the branch that
actually calls into its native `AudioParam` — i.e. only when the
epsilon check trips and a real automation event is scheduled. Kept as
three separate counters rather than one combined total because gain,
brightness, and frequency are three distinct `AudioParam`s with
independent internal event histories; collapsing them into one number
would hide it if, say, only frequency's history was the one ballooning.
All prior log data collected before this fix is unusable for telling
accumulation apart from elapsed time and needs to be re-captured.

## Seventh follow-up — accumulation theory rejected; real cause found and fixed

A real device log (with the corrected per-parameter push counters above)
gave a clean answer. In a session only 27 seconds old:

- Pulsation was first heard at `elapsedSec≈5`, right at the moment
  motion began after a steady hold — `level` jumped 38→100 within about
  2 seconds, and `freqPush` burst by ~35 in that same window (~15/sec).
- Pulsation clearly worsened at `elapsedSec≈25`, during the most
  vigorous, fastest-swinging motion in the whole capture — `level`
  swinging from near 0 up to 98 and back in sub-second jumps, with
  `freqPush` climbing at ~15.6/sec, close to the 20/sec throttle ceiling.

Severity tracked the RATE and SIZE of level swings, not elapsed session
time — the opposite of what the accumulation theory predicts (which
would show gradual worsening over minutes regardless of how vigorously
the device was being moved). The "escalates over a long session" read
from the original report was most likely just this: people naturally
shake harder and vary their motion more as a test session goes on,
confounding elapsed time with vigor. **Accumulation is rejected as the
cause.**

**Real mechanism**: `setTargetAtTime()` schedules an *exponential*
approach toward a target. Every time a new value lands before the
previous approach has finished — which happens up to ~20x/sec (the
throttle ceiling) during vigorous motion — the curve's direction kinks.
Each kink is a small discontinuity in the derivative of gain, pitch, or
brightness, and enough of them close together, happening faster during
bigger/faster swings, is audible as pulsation that gets worse exactly
when motion is more vigorous — matching the log precisely.

**Fix, scoped to Custom only**: `SineVoice`'s `setFrequency`/`setGain`/
`setBrightness` now use `linearRampToValueAtTime()` instead of
`setTargetAtTime()`, each ramp explicitly anchored with
`setValueAtTime()` at the parameter's current value and spanning the
ACTUAL elapsed time since that specific parameter's own previous push
(tracked per-parameter, since gain/brightness/frequency don't always
push on the same tick — their epsilon gates differ) rather than a fixed
assumed interval. Consecutive linear ramps chain together with no
curve-direction kink at the seams, regardless of how fast or large the
underlying swings are. Cello/Viola/Violin's pitch-shifter keeps its
original `setTargetAtTime()` ramp, unchanged — nobody has reported this
as a problem there.

**CONFIRMED on-device**: a repeat of the same hold-steady-then-move
pattern that reliably produced pulsation in every prior build —
including the exact same fast, large transition that triggered onset
at ~5s last time — produced no audible pulsation at all. `SONIFICATION_DEBUG_LOGGING`
has been flipped back to `false` now that this is resolved.

This closes out the Custom sonification buzz/pulsation investigation
that ran across the Viola→sine switch, the PWA-engine research, and
seven follow-up rounds: the final, confirmed root cause was
`setTargetAtTime()`'s exponential-ramp retargeting kinking under fast,
frequent target changes — not FFT load, not windowed-RMS ripple, not
native scheduling bursts alone, and not event accumulation, each of
which was investigated and ruled out (or only partially addressed) in
turn before arriving here.

## Eighth follow-up — sonification kept playing after End Session (Custom only)

Reported shortly after the Seventh follow-up shipped: on a continuous
session using Custom Tonal Range, with Sonification toggled on mid-session,
pressing End Session didn't reliably silence the tone — it kept audibly
playing afterward.

Ruled out first, since they're the obvious suspects for an audio-after-stop
bug and had both been touched recently: the `audioHook` wiring in
`liveSession.js` (a live module-level variable, re-read fresh on every
`pushPacket()` call — not a stale closure), `RecordingScreen`'s
`audioEnabled`-keyed effect (correctly calls `silenceAudio()` +
`setAudioHook(null)` on cleanup), and `endSession()`'s own explicit
`silenceAudio()` + `setAudioHook(null)` calls (added specifically because
`RecordingScreen` stays mounted under `Summary` via navigation, so
unmount-based cleanup doesn't fire at end-of-session time). All three were
confirmed working correctly — none of them explains the bug.

**Real cause**: self-inflicted by the Seventh follow-up's own fix.
Switching Custom's `SineVoice` to `linearRampToValueAtTime()` gave each
parameter a discrete, scheduled-in-advance end time — unlike
`setTargetAtTime()`'s open-ended asymptotic curve, which has no future
event to leave dangling. `stopHard()`'s `setValueAtTime(0, t)` does not
cancel an already-scheduled ramp (`cancelScheduledValues()` is avoided
project-wide here; see the SIGSEGV note earlier in this file). Per the Web
Audio automation-event model, events are ordered by time regardless of
call order, so the fresh `setValueAtTime(0, t)` just becomes that ramp's
new starting point — the still-pending ramp fires anyway, carrying gain
back up from 0 to its last target by its original end time, and then sits
there, since nothing after it says otherwise. Because gain pushes happen up
to 20x/sec during an active session right up until End Session is pressed,
a pending ramp in flight at that exact moment was routine, not a rare edge
case. Cello/Viola/Violin's `SampleVoice` was never at risk, since its gain
is still driven by `setTargetAtTime()`.

**Fix, scoped to Custom only**: `SineVoice` now tracks each parameter's
most recently scheduled ramp end time (`gainRampEndTime`, `freqRampEndTime`,
`brightRampEndTime`, updated by `setGain`/`setFrequency`/`setBrightness`
every time they schedule a new ramp). `stopHard()` checks each one and, if
it's still in the future, schedules a second override — silence for gain,
current value held steady for frequency/brightness — timed to land
`STALE_RAMP_GUARD_SEC` (10ms) *after* that ramp's own end time, not at the
exact same instant. The buffer matters: two automation events tied at the
same timestamp have implementation-defined precedence, and landing
strictly after sidesteps that ambiguity entirely rather than trading one
rare bug for another. The result is a brief (bounded, same-order-as-the-
ramp-itself) resurgence immediately silenced again, instead of audio stuck
playing indefinitely.

Pending on-device confirmation: repeat the reported repro (Custom Tonal
Range, continuous session, toggle Sonification on a few seconds in, run for
a minute, End Session) and confirm the tone actually stops.

## Ninth follow-up — faint tone persisted at true rest (Custom only)

Reported alongside the Eighth follow-up's bug, described as a recurrence of
something already fixed once before, for the three stringed tonal ranges:
with Custom Tonal Range selected, after tremoring and then returning the
stick to rest (Intensity reading of 0), a slight tone kept playing instead
of going fully silent.

**Cause**: Cello/Viola/Violin's gain/brightness read raw `normLevel`
directly, every call, unsmoothed — so at true rest (`normLevel=0`) their
gain is exactly 0 on the very next packet, with no lag. Custom's
gain/brightness, since the Fourth follow-up, instead read
`customSmoothedLevel`, an exponential blend introduced to stop gain/
brightness jumping in audible steps during active transitions.
Exponential decay only ever approaches 0 asymptotically — it never
mathematically reaches it — and `GAIN_EPSILON`/`BRIGHT_EPSILON` only push a
new value to the native oscillator when it differs from the last one by
more than the epsilon. As the decay nears rest its per-packet steps shrink
below that epsilon and simply stop being pushed, stranding gain at
whatever small nonzero value it last reached — indefinitely, since nothing
afterward is different enough to trip the gate again. That stranded value
is the "slight sound."

**Fix, scoped to Custom only**: `normLevel === 0` (true rest) is now a
special case. `customSmoothedLevel` snaps directly to `0` instead of
blending toward it, and the gain/brightness push below is allowed to fire
unconditionally — bypassing `GAIN_EPSILON`/`BRIGHT_EPSILON` — whenever the
last value sent isn't already exactly `0`. This guarantees rest always
actually completes the trip to true silence, the same way Cello/Viola/
Violin already do, without touching their unsmoothed path or weakening the
epsilon gates that fixed the Fourth follow-up's pulsation during genuine
active transitions — the bypass only ever applies once motion has fully
stopped.

Pending on-device confirmation: tremor, let intensity settle back to a
displayed 0, and confirm no audible tone remains.

## Tenth follow-up — buzzing root-caused to the shared BiquadFilter node

Reported after the Eighth/Ninth follow-ups shipped: Custom's sine tone
sounded buzzy rather than clean, described as "two tonal ranges at once"
and, by a tester, like "a neighbor's lawn mower."

Investigation ruled out, in order, with real device tests at each step
(no theory was acted on without one):

1. **Device speaker distortion** — ruled out; persisted on headphones.
2. **A fixed low absolute-Hz band** — ruled out; raising the Custom
   range's floor from 200Hz to 400Hz didn't move or remove it.
3. **Quiet-signal/epsilon-coupling** (gain and pitch both driven off the
   same smoothed intensity value in Custom, so the low end of the pitch
   range is also the quietest) — ruled out; buzzing was present at
   moderate-to-high intensity too, not just near the quiet floor.
4. **Relative position in the configured range** — ruled out; it still
   buzzed throughout a 400-700Hz range just as it had at 200-700Hz.
5. **Retargeting-rate/scheduling artifacts** (the actual mechanism behind
   every previous follow-up in this investigation) — ruled out
   definitively by a real device log: the buzz was present even during a
   fully static ~8-second hold with zero AudioParam automation events
   firing (frequency and gain both pinned, nothing being retargeted at
   all). A dead-steady oscillator has no "update rate" to blame.
6. **Custom/oscillator-specific** — ruled out; confirmed present on Cello
   too (a sample-based voice, not an oscillator), just "more integrated"
   into its own sample texture and therefore less noticeable — the same
   "a bare sine exposes everything a sample's texture would mask" theme
   that's recurred throughout this file, just for a different underlying
   defect than any previous round.

That left only what `SineVoice` and `SampleVoice` actually share: the
`BiquadFilter -> GainNode -> StereoPannerNode -> masterGain -> destination`
chain and the underlying `AudioContext`. A bisection test with temporary
`BYPASS_FILTER`/`BYPASS_PANNER` toggles (construction-time wiring, routing
around one node or the other) isolated it on the first try:
`BYPASS_FILTER=true` — skipping the `BiquadFilterNode` entirely — made the
buzzing disappear completely, confirmed across thorough on-device testing
of both Cello and Custom.

**Root cause**: `react-native-audio-api`'s `BiquadFilterNode`, in this
app's lowpass configuration (cutoff swept 800-3600Hz, `Q=1.0`), introduces
audible buzzing/distortion into whatever signal passes through it — not
specific to Custom, not specific to a sine wave, not related to this
app's own scheduling/throttling code at all. No matching report was found
on the library's open GitHub issues as of this writing.

**Decision**: ship with `BYPASS_FILTER=true` — the filter stays
completely out of the signal path on both `SampleVoice` and `SineVoice`.
Clean tone takes priority over the brightness feature for now; brightness
is paused, not removed, until the filter question (fix its configuration,
replace it, or deliver brightness a different way) is revisited. Despite
the flag's name, this is the deliberate current shipping configuration,
not a temporary diagnostic state.

Two things surfaced during this round's thorough testing, logged here and
deliberately deferred rather than chased immediately:

1. A periodic/intermittent pulsation on Cello specifically (not present
   on Custom) with the filter bypassed. Possibly the long-standing,
   deliberately-unsmoothed Cello gain path (see the THIRD follow-up)
   being slightly more exposed now that the filter isn't incidentally
   softening transients — unconfirmed.
2. An intermittent recurrence of sonification continuing to play after
   End Session, in some case separate from the Eighth follow-up's fix
   (which was specific to Custom/`SineVoice`'s stale linear ramps) — no
   repro captured yet.

## Eleventh follow-up — sound lingering at true rest after intense tremor (fixed); End Session recurrence (logging added)

Picking up the two items the Tenth follow-up deferred, now that the
filter question has a shipping decision. Confirmed Custom-only for both.

**Issue A — sound still audible at true rest (displayed Intensity 0)
after tremoring intensely for 10-15 seconds, fixed**: the Ninth
follow-up's rest-detection fix pushed `setGain(0, rampSec)` the same way
as any other gain push — but that's an ordinary scheduling call, and it
does not cancel an already-scheduled *future* ramp (Web Audio automation
events are time-ordered, not call-ordered; `cancelScheduledValues()` is
unsafe in this library — see the SIGSEGV note near the top of this
file). The longer/more intense the preceding tremor, the more likely an
earlier gain push had scheduled a ramp ending *after* the moment rest
was reached — exactly the same mechanism as the Eighth follow-up's
"sound continues after End Session" bug, just reached through this
rest-detection path instead of `stopHard()`. Since `stopHard()` already
carries the fix for this (the Eighth follow-up's `STALE_RAMP_GUARD_SEC`
backstop), the rest-detection branch now calls `voice.stopHard()` instead
of a plain `setGain()` call, giving it the same protection ending a
session already had.

**Issue B — End Session reliability, Custom-only, inconsistent duration
(immediate / a few seconds / until Return to Home / past Home)**:
suspected to be a related but distinct manifestation — most likely a
BLE packet reaching `updateAudio()` in a timing-dependent window around
teardown — but not yet confirmed against a real device log, so no fix
yet. Re-enabled `SONIFICATION_DEBUG_LOGGING`, and added two new
always-on (not gated behind that flag, since they fire only a few times
per session) absolute-timestamp logs: `[sonification:hook]` in
`liveSession.js`'s `setAudioHook()` (SET/CLEARED), and
`[sonification:silence]` in `silenceAudio()`. Cross-referencing these
against the existing per-push `[sonification:custom]` log (now also
carrying an absolute `at=` timestamp) should show whether a packet
reaches `updateAudio()` after `setAudioHook(null)` runs — a hook
re-registration or a late-packet race — once a real capture is in hand.

## Thirteenth follow-up — masterGain mute backstop at End Session

`silenceAudio()` now also sets `masterGain.gain.value = 0` with a plain
value write (no scheduled automation), and `unmuteAudio()` restores it
(`MASTER_GAIN_LEVEL`, 0.93) from `sessionLogic.js`'s `startSession()`.
Confirmed on-device: sound stopped immediately at End Session on both a
Quick Start (Reading) session and a Continuous session. Kept as a
permanent backstop — nothing can be audible between sessions regardless
of per-voice automation state.

## Fourteenth follow-up — Custom ramp lengths capped (root cause of lingering sound)

**Root cause**: the Seventh follow-up sized each Custom linear ramp to
the real time since that parameter's previous push. That gap has no
upper bound. `GAIN_EPSILON` (0.03) against Custom's 0-0.25 gain range
allows only ~8 steps across the whole range, so gain pushes stop
entirely during any steady stretch — and the next push after a hold got
a ramp as long as the hold. Diagnostic logging
(`[sonification:gainpush] rampSec=`) on a real Continuous session
showed 22 of 73 gain pushes with ramps over 1s, up to 9.36s.

Consequences: volume responding seconds late after a steady stretch;
and, because `stopHard()` can't cancel an in-flight ramp
(`cancelScheduledValues()` is unsafe — SIGSEGV note), a long ramp still
in flight climbs back up from 0 until its original end time. That is the
likely single mechanism behind both sound at displayed Intensity 0 and
the variable-length post-End-Session sound (immediate / seconds / until
Home — duration tracks how long the hold before the last gain change
was). The Eighth/Eleventh follow-ups' `STALE_RAMP_GUARD_SEC` backstop
only ends the resurgence at the ramp's end; it never prevented it.

**Fix**: `CUSTOM_RAMP_MAX_SEC = 0.3` caps every Custom ramp (gain,
frequency, brightness) via a shared `customRampSec()` helper. 0.3s
because the same log shows push gaps during genuine active change are
mostly 0.12-0.36s, so seamless ramp chaining during motion is preserved
(no "ramp, then hold" stepping), while post-hold lag and any stale-ramp
resurgence are bounded to 0.3s. The Thirteenth follow-up's masterGain
mute stays as a backstop.

Diagnostics still on (`SONIFICATION_DEBUG_LOGGING = true`):
`[sonification:gainpush]` now logs both `gapSec` (raw time since the
previous push) and `rampSec` (capped value actually scheduled);
`[sonification:silence]` and `[sonification:rest]` log
`pendingGainRampSec` (seconds of the last ramp still in flight — should
now never exceed 0.3).

## Fifteenth follow-up — in-session sonification toggle stayed silent after OFF -> ON

Regression from the Thirteenth follow-up. The Recording screen's
sonification `Switch` changes `config.feedbackType`, which re-runs
RecordingScreen's audio effect: OFF runs its cleanup (`silenceAudio()`,
which now also hard-mutes `masterGain`); ON re-registers the audio hook.
But `masterGain` was only ever unmuted by `startSession()`, so after one
OFF the hook was live while the master bus stayed at 0 — silent for the
rest of the session.

Fix: the effect now calls `audioService.unmuteAudio()` alongside
`initAudio()`. It is also guarded on `getLiveState().isRecording`, so a
`feedbackType` change while RecordingScreen sits mounted under Summary
can never re-register the hook or unmute after End Session (on first
mount, `startSession()` has already set `isRecording` via
`beginSessionBuffers()` before navigating to Recording).

## Sixteenth follow-up — session "paused" while another app was open (step 1 of 2)

**Cause**: `Info.plist` declared no `UIBackgroundModes`, so iOS
suspended the app a few seconds after it left the foreground — all JS
stopped: BLE notifications weren't processed (gap in the recording), and
the session clock, which incremented `elapsed` by 1 per `setInterval`
tick, silently lost every second it didn't fire, resuming from where it
stopped. Same mechanism `useKeepAwake()` addressed for auto-lock, which
can't help once the user switches apps.

**Fix (step 1)**:
- `UIBackgroundModes` = `bluetooth-central` — iOS keeps delivering the
  M5Stick's BLE notifications in the background and wakes the app to
  handle them, so packets keep flowing into `pushPacket()` and the
  session buffer. (Appropriate for a BLE-sensor app; native rebuild
  required.)
- `liveSession.js`'s `startTimers()` now derives `elapsed` from the wall
  clock (time since session start), clamped to `totalSeconds` for timed
  sessions — any timer gap catches up on the next tick, and a timed
  session whose end passed in the background completes on that tick.

**Not yet covered (step 2)**: sonification and guide tracks in the
background — needs the `audio` background mode plus a Playback audio
session, and a decision on mixing with other apps' audio (relevant to the
planned Spotify session type). Background delivery is also best-effort:
iOS may batch notifications or terminate the app under memory pressure.

## Seventeenth follow-up — "Maximum update depth exceeded" while backgrounded

Side effect of the Sixteenth follow-up. `liveSession.js`'s `notify()`
fired synchronously on every BLE packet (~50/sec), and each one forces a
synchronous React render through `useSyncExternalStore`. Now that
packets keep arriving in the background, iOS throttles React's scheduled
passive-effect work while these forced renders kept coming — React
logged "Maximum update depth exceeded". Confirmed only ever logged while
backgrounded.

Fix: `notify()` now (1) does nothing while `AppState` isn't `active`,
flushing once immediately on return to the foreground, and (2) coalesces
foreground notifications to at most one per `NOTIFY_INTERVAL_MS` (33ms,
~30 renders/sec — already anticipated by the "throttle this" note in
`pushPacket()`). Only UI notification changed: buffers, recording,
metrics, the audio hook and the session clock still run on every
packet/tick, and `getLiveState()` always returns current state
(Calibration's sample polling reads it directly, so it's unaffected).

## Eighteenth follow-up — sonification in the background (step 2 of 2)

- `Info.plist` `UIBackgroundModes` now also includes `audio`.
  react-native-audio-api 0.4.18 already sets `AVAudioSession` to
  Playback (Bluetooth/AirPlay options, no mix-with-others) on start and
  resume — verified in its `ios/audioapi/ios/core/AudioPlayer.m` — and
  `guideTrackPlayer.js` already uses `Sound.setCategory('Playback')`, so
  no category change was needed. Native rebuild required.
- **Engine suspended between sessions**: the single AudioContext lives for
  the app's lifetime, and a running AVAudioEngine counts as "playing" to
  iOS even when silent — with the `audio` mode that would keep the app
  alive in the background indefinitely after its first sonification
  session (battery; App Store guideline 2.5.4). `silenceAudio()` (End
  Session, toggle OFF) now calls `AudioContext.suspend()`;
  RecordingScreen's audio effect calls the new `resumeAudio()` alongside
  `unmuteAudio()`. Suspend/resume, not close/rebuild — the graph stays
  intact. Native suspend/resume each run on a detached thread, so calls
  are serialized through a promise queue (`queueEngineOp`) to keep a fast
  OFF->ON toggle from executing out of order; `updateAudio()`'s existing
  resume-if-suspended line is now only a fallback, skipped while our own
  ops are pending. Kill switch: `SUSPEND_ENGINE_WHEN_SILENT` in audio.js.
  New log lines: `[sonification:engine] suspend/resume at <ms>`.

**Known limitations (not addressed)**:
- The library registers no `AVAudioSession` interruption handling, so
  after a phone call/Siri/alarm interrupts a session, sonification may not
  come back until the next session (or a toggle OFF->ON).
- Playback without mix-with-others means starting sonification pauses
  other apps' audio (e.g. Spotify/podcasts). The library re-applies its
  category options on every resume, so changing this needs a
  patch-package change to the library — relevant to the planned Spotify
  session type.

## Nineteenth follow-up — sonification silent after switching to a Bluetooth speaker mid-session

**Reported by a tester; reproduced**: start a sound-on session on the
phone speaker, then connect/select a Bluetooth speaker — sonification
goes silent for the rest of the session. Connecting the speaker before
the session works.

**Cause**: switching output can change the hardware sample rate/channel
count, and AVAudioEngine then stops itself and posts
`AVAudioEngineConfigurationChangeNotification`. react-native-audio-api
0.4.18 registers no observers at all, so nothing restarted it (the JS
side can't tell — the context's own state still reads "running"). Same
gap for `AVAudioSessionInterruptionNotification`: after a phone call /
Siri / alarm, the engine stayed stopped (the Eighteenth follow-up's
known limitation).

**Fix** (`patches/react-native-audio-api+0.4.18.patch`, native, applied
by patch-package on `postinstall`): `AudioPlayer.m` now observes both
notifications. On a configuration change or interruption end it
re-establishes the main-mixer -> output connection at the new hardware
format, re-activates the session and restarts the engine — only if
`isRunning` is true, so a route change while SteadyPoint is idle (engine
suspended between sessions) doesn't wake it. Observers are removed in
`cleanup`. Native logs (Xcode console, not Metro) are prefixed
`[SteadyPoint audio]`. The patch file still contains the original
`Constants.h` `<cstddef>` fix; it's regenerated against the pristine
0.4.18 package and verified with patch-package 8.

## Twentieth follow-up — Cello prototypes on the Custom (sine) engine

Goal: bring Custom's clean, smooth, pulsation-free behavior to the string
voices. Two candidate approaches, both prototyped on Cello only and
selectable in Settings > Tonal Range next to the original Cello for A/B
listening. Both switch Cello's pitch from the FFT dominant frequency to
**intensity** (exponential mapping across 65-130Hz), like Custom — an
explicit product decision.

- **Cello A (test)** — the recorded cello sample, driven by Custom's
  pipeline: smoothed level, chained linear ramps capped at 0.3s, stale-
  ramp guard, rest snap. Implemented as `SmoothSampleAdapter` over the
  existing `cello` SampleVoice (no second real-time pitch-shifter — CPU
  ceiling, see `DUAL_LAYER_ENABLED`). Pitch ramps the stretcher's
  `semitones` param linearly (= exponential in Hz), anchored at its own
  last target rather than a native `.value` read. Risk: the pitch-shifter
  itself may still warble while pitch moves.
- **Cello B (test)** — Custom's `SineVoice` with a harmonic waveform
  (`createPeriodicWave`, `CELLO_B_HARMONICS`): a "body-resonant" recipe
  that keeps the fundamental strongest but holds harmonics 2-5 up, so the
  65-130Hz register is audible on a phone speaker (~26% of energy >=200Hz
  at 65Hz vs ~8% for a plain 1/n^1.5 rolloff). Synthesized, not recorded,
  timbre. No vibrato (the library can't connect a node to an AudioParam,
  so it would need JS-scheduled modulation).

Shared change: the smooth branch in `updateAudio()` now serves every
voice in `SMOOTH_PIPELINE_VOICES`. Non-Custom voices use a pitch-relative
push threshold (`PITCH_EPSILON_SEMITONES` = 0.1) because 2Hz is half a
semitone in Cello's register; Custom keeps its exact 2Hz behavior.

Verified off-device with a mock-AudioContext simulation (ramp 0->80
intensity, hold, back to 0): no errors; every ramp <= 0.3s; all voices end
at gain 0 after `silenceAudio()`; Cello A touches only its gain and
semitones params; Custom's event stream unchanged by this follow-up.

Starting values to tune by ear: `cello_b.maxGain` 0.3 (vs the sample's
0.4), `CELLO_B_HARMONICS`. Once a winner is chosen, apply it to Viola and
Violin and remove the losing prototype (and its Settings pill).

## Twenty-first follow-up — Cello A becomes a multi-sampled 65-1000Hz cello

Cello A (sample on Custom's smooth pipeline) won the Twentieth follow-up's
A/B. Requested next: widen its range from 65-130Hz to 65-1000Hz.

**Constraint found**: react-native-audio-api's pitch-shifter clamps
`semitones` to -12..+12 (`StretcherNode.cpp`), so one recording can only
span one octave either side of its own pitch — which is why every string
voice's register was exactly one octave. A different single recording
can't fix that.

**Approach**: seven VSCO 2 CE cello notes (same "Cello Section / susvib"
set as the existing cello.wav, CC0), one every fifth — C2, G2, D3, A3, E4,
B4, F5 — with the voice handing off between neighbours as pitch rises.
Each note is shifted at most ~+/-3.5 semitones (top note up to ~+6 for
1000Hz) — far less than the old single sample's full octave, so less
pitch-shifter warble. Pitches and loudness were measured, not assumed
(see AUDIO_SOURCES.md); per-zone trim matches each note's loop RMS to
cello.wav's so hand-offs don't jump in level.

- `ZonedSampleVoice` (audio.js) replaces the Twentieth follow-up's
  `SmoothSampleAdapter`; same smooth-pipeline interface. Hand-offs
  crossfade over `ZONE_XFADE_SEC` (0.3s) with both notes tracking pitch in
  unison; `ZONE_HYSTERESIS_SEMITONES` (1.0) prevents flapping near a
  boundary.
- **CPU**: this library renders only what's connected to the destination,
  so a zone's gain node is connected only while it's in use (max two
  during a hand-off) and all zones disconnect at session end
  (`release()`, from `silenceAudio()`).
- **Also changed for all voices** (`routeSampleVoices()`): the original
  Cello/Viola/Violin SampleVoices used to be connected permanently, so all
  three pitch-shifters rendered during every session (even Custom). Now
  only the active one is connected, on every session start.
- Assets linked with `npx react-native-asset` (6 new files; cello.wav is
  reused for C2) — ~13MB added to the bundle.

Verified off-device with a mock-AudioContext simulation that models graph
connections and timers: 0->100->0 intensity ramp walks up through all 7
notes and back (12 hand-offs, in order); hovering near a boundary causes
no hand-offs; at most 2 pitch-shifters render during Cello A and 0 after
End Session; Custom sessions now render 0 pitch-shifters (previously 3);
Custom's in-session automation is byte-identical to the previous build.

To tune by ear: per-zone loudness (`loopRmsDb` in `CELLO_ZONES` — raise a
zone's value to make it quieter), `ZONE_XFADE_SEC`,
`ZONE_HYSTERESIS_SEMITONES`, `cello_a.maxFreq`.

## Twenty-second follow-up — all three strings multi-sampled; test voices retired

Cello A tested well across 65-1000Hz, so the same approach now covers all
three string voices, Cello A *becomes* Cello, and Cello B is removed.

- **Cello** 65-1000Hz — the Twenty-first follow-up's seven cello notes.
- **Viola** 131-1175Hz (was 196-330Hz) — six VSCO Viola Section notes a
  fifth apart, C3-B5 (viola.wav reused as G3).
- **Violin** 196-1568Hz (was 392-784Hz) — seven VSCO Solo Violin notes,
  G3-G6 (the same set the original violin.wav came from; it has G/A/C/E per
  octave, so steps alternate fourths and fifths). Capped at G6 — the C7
  sample exists but 2kHz+ is shrill for continuous sonification.
- All pitch now follows **intensity** on the smooth pipeline (like Custom);
  every voice is in `SMOOTH_PIPELINE_VOICES`.
- Each instrument's zones are trimmed to its *original* sample's loudness
  (`ZONE_LOUDNESS_REF_DB`), so overall levels are unchanged per instrument.
- Viola/violin pitches and loudness were measured like the cello's (see
  AUDIO_SOURCES.md). Violin G3's fundamental is weak (third harmonic
  strongest) so autocorrelation locked onto h3; its 195.5Hz pitch was
  confirmed from the harmonic series.

**Removed** (unused once every voice moved to the zoned engine): the
original single-sample `SampleVoice` class and its FFT dominant-frequency
pitch path in `updateAudio()` (and its constants/state), the Twentieth
follow-up's `SmoothSampleAdapter`, Cello B (`CELLO_B_HARMONICS`, the
`cello_b` voice), `routeSampleVoices()` (zones self-connect, so idle
instruments already do no work), and the assets cello_loud / viola_loud /
violin_loud / violin.wav (~12MB). `SineVoice`'s optional `harmonics`
parameter stays (harmless, unused). Saved `cello_a`/`cello_b` choices
migrate to `cello` (persistence.js; Settings also tolerates a stale value).

Verified off-device: ESLint `no-undef`/`no-unused-vars` clean after the
removals (linter confirmed to catch a planted error); mock-AudioContext
simulation of a slow 0->100->0 sweep on each voice — each instrument walks
its notes in order (cello 12 hand-offs, viola 10, violin 12), at most 2
pitch-shifters render at once, none after End Session; Custom renders none
and its in-session automation is byte-identical to the previous build; a
stale `cello_a`/`cello_b` voice falls back to Cello; exactly the 20 WAVs on
disk are decoded, with no load warnings. Asset linking via
`npx react-native-asset` (12 added, 4 removed in the Xcode project — 6
lines each, nothing else touched).

## Xcode project file: user's copy is authoritative

`ios/SteadyPointCLI.xcodeproj/project.pbxproj` in the zips this chat had
been sending came from an older snapshot with React Native's default
bundle ID (`org.reactjs.native.example.SteadyPointCLI`), build number 1,
no signing team, no `PrivacyInfo.xcprivacy` in Resources, and none of the
settings `pod install` writes. Unzipping it over the real project reset
those — so archives were uploaded to a second App Store Connect record
("SteadyPoint") instead of the testers' "SteadyPoint0.1"
(`com.kaivo.steadypoint`). Replaced with the user's own file (bundle ID
`com.kaivo.steadypoint`, team 6N4P2VVN25, build 22, privacy manifest and
Pods settings present; all 20 current WAVs referenced, none retired).
Going forward, zips omit project.pbxproj unless a change requires it, and
then start from the user's latest copy.

## Twenty-third follow-up — Custom Sessions re-enabled and reworked

The Home section previously hidden behind `FEATURE_MY_SESSIONS` is back as
**CUSTOM SESSIONS** (`FEATURE_CUSTOM_SESSIONS` in HomeScreen.js).

- **Home** shows the two most recently used custom sessions
  (`HOME_CUSTOM_SESSION_LIMIT`), each with its configuration line under the
  name, plus edit (✎) and delete (✕). With more than two, a
  **View all (n)** link sits at the right of the header row.
- **Custom Sessions screen** (`customSessions` route,
  CustomSessionsScreen.js): every custom session, most recently used first;
  tap to start, ✎ to edit (Setup returns to this screen when done), ✕ to
  delete.
- **Shared row** (`components/CustomSessionRow.js`) and helpers
  (`utils/customSessions.js`: `sortByRecentUse`, `describeCustomSession`)
  so both places stay identical.
- **No more 3-session cap.** Removed from `savePinnedSession()`, the
  auto-pin path in `startSession()`, the reducer's
  `ADD_PINNED_SESSION` (`.slice(0, 3)`) and Setup's "Save to Home (full)".
  Previously the oldest was silently replaced (and its guide audio
  deleted).
- **Recency:** `lastUsedAt` is set on creation and on every successful
  start via the new `startCustomSession()` (not when disconnected — the
  "Not connected" alert path doesn't count). Editing doesn't reorder.
  Sessions saved before this field existed sort after timestamped ones,
  newest id first — no data migration needed.
- **Auto-pin de-duplication:** starting from Setup with a name that
  matches an existing custom session (trimmed, case-insensitive) updates
  that one (keeping its name) instead of adding a copy — needed now that
  there's no cap.
- Setup's Back/Cancel and Save/Update now return to whichever screen
  opened Setup (Home or Custom Sessions). Delete confirmation reworded to
  "Delete custom session".

Verified off-device: ESLint (with React JSX rules) clean apart from three
pre-existing unused imports; 22 behavioural checks running the real
sessionLogic.js + reducer against a simulated store — no cap, legacy
ordering, start moves to top and persists, no usage bump when
disconnected, edit keeps position and doesn't duplicate, auto-pin
de-duplicates (keeping the original name) and adds new names, delete,
description strings, Home limit.

## Twenty-fourth follow-up — save a Session setup from Summary; "Start →" on custom sessions

**Session origin.** `startSession()` takes `origin` ('setup' default,
'quickStart', 'custom' + `customSessionId`, 'similar'); callers pass theirs
(Home Quick Start, `startCustomSession()`, `startSimilarSession()`).
Recorded in a module-level `currentSessionOrigin` and written by
`endSession()` to `state.results` and the session history record
(`origin`, `customSessionId`) — groundwork for a future "Save as custom
session" on Session Detail.

**Summary "Save this setup?" card.** `endSession()` sets
`results.saveOffer` (the setup as configured at start) only when the
session started from Session setup, wasn't auto-saved by name, and
`findMatchingCustomSession()` finds no custom session with the same
activity, duration, sound on/off and guide (guide audio matched by file
name, since each pick copies to a new path). Never for Quick Start, custom
or "Start similar" sessions (explicit product decision). The card shows the
setup line with "Save as custom session" and "Not now"; Save opens a
page-sheet name editor (same pattern as the note editor, for keyboard
reasons) and calls `saveSetupAsCustomSession()` — rejects blank and
duplicate (case-insensitive) names, saves with `createdAt`/`lastUsedAt` so
it lists first, then the card confirms "✓ Saved … to Custom Sessions".

**Fix (pre-existing):** `savePinnedSession()` persisted a snapshot with the
old `pinnedNextId`, so if the app was closed before anything else saved
state, the next new custom session after a restart reused an id (the load-
time repair then renumbered). The snapshot now advances the counter;
`saveSetupAsCustomSession()` does the same.

**"Start →"** (blue, Quick Start style) added to `CustomSessionRow`, so it
appears on Home and the Custom Sessions screen; the row body still starts
the session too.

Verified off-device: React-aware ESLint clean; 19 new behavioural checks
on the real sessionLogic.js + reducer (origin tagging on results and
history; offer only for unsaved Setup sessions; none for Quick Start,
custom, "Start similar", auto-saved-by-name or matching setups; guide
matching by file name; Summary save incl. blank/duplicate rejection,
fields, ordering, unique ids, persisted counter), plus the previous 22.

## Twenty-fifth follow-up — activity icons on custom sessions

`CustomSessionRow` shows the activity icon on the left, matching Quick
Start: Meditative = brain on blue, Engaged = book on green, Active = walk
on orange, same 40×40 box and 20px icon. The card switched from the light-
blue fill to Quick Start's neutral `bg2`/`bd3` style, because the
Meditative icon's light-blue box disappeared against the blue fill; the
blue name and "Start →" still distinguish custom sessions. Applies to Home
and the Custom Sessions screen (shared component).

## Twenty-sixth follow-up — replacing the SteadyPoint Score (round 1 of 2)

The score was effectively inverted intensity. It's being replaced by two
direct measures (product decisions: **median** rather than mean, so a brief
spike doesn't skew it; **all four bands** shown, so percentages add to 100%):

- **Median intensity** — the session's typical 0-100 level, with its band.
- **Time in each band** — % of the session at None (<20), Mild (20-44),
  Moderate (45-69), High (70+): the live screen's bands and colours.

`utils/intensityStats.js` holds the bands, `median()`, `bandPercentages()`
(largest-remainder rounding so they always total 100), `sessionIntensity()`
and `intensityHeadline()`. `endSession()` now stores `medianIntensity`,
`bandPct` and `intensityValid` (same 10-reading / 30-second gate as the
score) on results and the session record, from the full-resolution trace.
Older sessions are derived on the fly from their saved ~150-point
`intensityTrace` (and stored pct fields when present) — no migration.

Round 1 screens: **Summary** and **Session Detail** show a median-intensity
ring (filled to the level, coloured by band, band name inside) plus a
"Time in each band" bar and legend; Summary's headline describes the
session by band ("A calm session.", "Mostly mild tremor this session.", …,
"Session too short to measure."). **Session History** badges show median
intensity coloured by band. Components: `components/IntensityDisplay.js`
(`MedianIntensityRing`, `TimeInBands`).

**Round 2 (pending):** Home (ring, daily bars, 7-day average) and
Analytics still use the score, which `endSession()` keeps computing until
then; afterwards the score calculation and `scoreColor`/`scoreTextColor`
can be removed.

Verified off-device: React-aware ESLint clean; 14 checks on the intensity
maths (band edges, median vs spike, 100% totals, new/old/very-old/invalid
sessions, headlines) plus the existing 41 session-logic checks.

## Twenty-seventh follow-up — Analytics redesigned around intensity (score removed)

Built from the user's design (sections below removed white space moved up):

1. Header: "Analytics" + **All sessions history (n)** pill (n = all recorded
   sessions) → Session History. The old bottom "Session history" row is gone.
2. **7D / 30D / All** period selector (default 30D) driving everything below.
3. **Sessions** (all sessions in period) and **Avg intensity** (mean of each
   measured session's median, coloured by band).
4. **Your calmest session**: All types / Meditative / Engaged / Active chips;
   lowest median in period + filter (ties → most recent); band + "% below
   your avg" (vs. the same filter's average); date/time; Activity / Length /
   Sound / Guide tiles; **Start similar session** (`startSimilarSession`).
5. **Intensity chart** (7-DAY / 30-DAY / ALL-TIME): one dot per session in
   its band colour, blue 3-session rolling average, dashed band boundaries at
   20/45/70, type dropdown; a dashed **marker for each session with a note**
   (label = note, shortened; overlapping labels skipped, line kept).
   Subtitle: first vs last 3-session average ("Avg down from 92 to 46").
6. **Time in bands**: one 100% stacked bar per session (None/Mild/Moderate/
   High), or Lines view (each band's share per session). Subtitle: first vs
   last session's High % ("High time down from 60% to 4%").
7. **By activity type**: avg intensity, mini band bar, session count.
8. **Sound & guide**: avg intensity for sound on/off, with/without guide.
9. **Avg dominant frequency** with trend: first vs second half of the
   period, **stable** within ±0.5 Hz, else rising/falling.

Band boundaries and colours are unchanged (Mild stays blue). Sessions are
spaced evenly on chart x-axes (several on one day would otherwise overlap).

Files: `utils/analyticsStats.js` (pure calculations), `components/
AnalyticsCharts.js` (`IntensityTrendChart`, `BandsOverTimeChart`,
`BandLegend`), `screens/AnalyticsScreen.js` (rewritten); `roundTo100` now
exported from intensityStats.js. The old score-based helpers in
sessionStats.js (`build7DayChart`, `byActivityType`, `bySoundFeedback`,
`byGuideSource`, `keyInsight`) and `WeeklyBarChart` are now unused — to be
removed with the score in the Home round.

Known data caveat: `endSession()` records a placeholder dominant frequency
of 5.7 Hz when none was detected, which is included in the frequency
average. Worth replacing with "no reading" in the Home/score-removal round.

Verified off-device: React-aware ESLint clean; 41 checks — calculation unit
tests on 40 days of mixed old/new-format sample sessions (periods, overview,
calmest + filter, rolling average, subtitles, note markers, band splits
summing to 100, groups, frequency trend, axis ticks, dates) and full-screen
renders in light and dark mode with every control exercised (history link
+ count, Start similar → calmest session, 7D/30D/All, chips, dropdown,
bars/lines), the empty state, and no remaining "score" text; plus the 14
intensity checks.

## Twenty-eighth follow-up — Home without the score; no placeholder frequency

**Dominant frequency placeholder removed.** When no dominant frequency was
detected during a session, `endSession` used to record 5.7 Hz, which then
showed up as real data. It now records `null`; Summary and Session Detail
show "—" ("none detected"), and Analytics' average frequency already
ignores missing values. Sessions saved before this change that stored the
5.7 placeholder can't be told apart from a real 5.7 Hz reading, so they are
left as they are.

**Home uses intensity instead of the SteadyPoint Score** (lower is calmer,
same four bands and colours as everywhere else):
- The ring shows the most recent session's **median intensity**, filled to
  that level and coloured by its band, with the band name underneath
  ("TOO SHORT" if that session was too short to measure, "NO DATA" with no
  sessions). The line under it reads e.g. "Last session: 9:10 AM · Median 30"
  (with the date when it wasn't today).
- The bars show the **last 7 days** (was 6), each day's height being that
  day's average intensity (mean of its session medians, same definition as
  Analytics' "Avg intensity"), coloured by band; days with no measured
  session show a small grey stub.
- The second tile is now **7-DAY AVG INTENSITY**: the mean of every
  measured session's median over the last 7 days, with its band name.
- Demo mode stubs updated to match.

**Score removed from the app.**
- `endSession` no longer computes the score, steadiness, consistency or the
  separate `pctNone`..`pctHigh` fields; new records store `intensityValid`,
  `medianIntensity` and `bandPct` only. Old records keep their fields and
  `sessionIntensity()` still reads them, so history needs no migration.
- The `analyticsData` store (per-day score totals that nothing displayed),
  its `RECORD_COMPLETED_SESSION` action and its saved entry are gone; the
  old `sp_analyticsData` entry is removed from storage on next launch.
- Removed the unused score helpers from `utils/sessionStats.js`
  (`hasScore`, `build7DayChart`, `byActivityType`, `bySoundFeedback`,
  `byGuideSource`, `keyInsight`, `scoreColor`, `scoreTextColor`) and
  `components/WeeklyBarChart.js`. `ScoreRing` stays — it's the generic ring
  used for median intensity.

## Twenty-ninth follow-up — noise floor setting now applied

`settings.noiseFloorG` (NOISE_FLOOR_G) was saved but never used: live
intensity always used dsp.js's built-in 0.006 g. It's now applied the same
way as full scale:
- `startSession` passes it to the new `liveSession.setNoiseFloorG()` (after
  `setFullScaleG()`), fixed for the whole session; `updateLiveMetrics` and
  the start/end levels in `endSession` use it.
- Validated: a missing, negative, or at/above-full-scale value falls back to
  0.006 g (or half of full scale if full scale is tiny). `rmsToLevel()` also
  guards against a floor at/above full scale.
- Each session record now stores the `noiseFloorG` it used, alongside
  `fullScaleG` and the tremor band, so every session is self-describing.
  Older records have no `noiseFloorG`; they were all measured at 0.006 g.

No visible change for anyone today: every user's setting is still the
default 0.006 g (there's no UI to edit it yet).

## Thirtieth follow-up — past sessions shown on the current scale

Every screen now shows every session on the user's **current** full scale
and noise floor, so sessions stay comparable after those settings change.
This is a display-time conversion only — saved sessions are never modified,
so history simply follows whatever the settings are now.

- **How:** a saved 0–100 reading is turned back into the motion (g) it came
  from using the scale it was measured on (the session's stored `fullScaleG`,
  and `noiseFloorG` or 0.006 g for sessions saved before that field existed),
  then re-scored on the current settings. `utils/intensityStats.js`:
  `displayScale`, `sessionScale`, `rescaleLevel`, `sessionTrace`,
  `sessionReduction`, and an optional `scale` argument to `sessionIntensity`.
- **Where:** Home (ring, bars, 7-day average), Session History badges,
  Session Detail and Summary (ring, time in bands, intensity chart,
  start-vs-end reduction text), and every Analytics section.
- **Accuracy:** the median is converted exactly (the conversion keeps the
  order of readings). Time in each band is recomputed from the saved
  ~150-point trace, so it's approximate — typically within a few percent.
  Readings pinned at 0 or 100 are only a bound and are converted as if they
  sat exactly on it. Sessions on the same settings as today are unchanged.
- **Assumption (agreed):** the frequency band hasn't changed across saved
  sessions — band changes alter what's measured and can't be converted. The
  Analytics intensity chart now marks any point where band filtering
  switched on/off ("Band filter on", e.g. a first Calibration Mode run) or
  the band changed ("Band changed"), as grey outlined markers alongside the
  blue note markers, with a "Band change" legend entry. Band-change labels
  take priority over note labels when they'd overlap.

## Thirty-first follow-up — motion (g) saved with every session

Each new session now also saves the motion behind its readings, in g, so
future comparisons aren't limited by the 0–100 scale or by band changes.
**Saving only — nothing displays these yet.**

- `rmsTraceG`: the value each 0–100 reading was scored from (in-band when
  band filtering is on, otherwise broadband). Makes full-scale / noise-floor
  conversion exact, including readings that were pinned at 0 or 100.
- `rmsAllTraceG`: all-frequencies (broadband) motion, which depends on no
  calibration setting (full scale, noise floor or band) — comparable across
  every session from now on, including across band changes. Note it also
  includes voluntary movement, which the band normally filters out.
- Both are recorded on every 300 ms metrics tick alongside `levelTrace`
  (`liveSession.js` `updateLiveMetrics()`; broadband RMS is now always
  computed) and saved downsampled the same way as `intensityTrace`, so entry
  *i* of all three traces is the same moment. Values are rounded to
  0.0001 g; about 300 extra numbers per session.
- Sessions saved before this change don't have these fields.

## Thirty-second follow-up — exact rescaling, same-band trends, All motion view

**Exact rescaling for new sessions.** When a session has the saved motion
trace (`rmsTraceG`, from the thirty-first follow-up), converting it to the
current full scale / noise floor now re-scores the saved g values directly:
exact, no 0/100 pinning, no whole-number coarseness. Used for the intensity
chart and time in each band, and for the median when the stored median was
itself pinned at 0 or 100. Older sessions keep the 0–100 conversion.

**Trend comparisons stay within one band.** A band change alters what's
measured, so the Analytics subtitles now only compare sessions measured on
the same band as the most recent one:
- Intensity: "Avg down from X to Y **since band change**" (or
  "Avg N · 1 session since band change").
- Time in bands: "High time down from X% to Y% since band change".
- With no band change in view, the wording is unchanged.
- Also fixed: with fewer than 6 sessions, the "first 3 vs last 3" averages
  overlapped (3 sessions always read as "steady"). Each end now uses up to
  3 sessions without overlapping (e.g. 4 sessions → first 2 vs last 2).

**All motion view.** The intensity chart has a **Tremor band / All motion**
toggle. All motion plots each session's median on all frequencies
(`rmsAllTraceG`, scored on the current full scale / noise floor): it
includes voluntary movement, so it reads higher, but it's unaffected by band
changes, so it compares across everything (no band-change markers; note
markers still shown; subtitle compares the whole period). Only sessions
recorded since the thirty-first follow-up have this data — older ones are
left out, with an empty-state message when none are in the period and a
short explanatory caption under the chart.

## Thirty-third follow-up — band filtering shown in Settings and Session Detail

- **Settings → Tremor Measurement:** new "Band filtering" row — "On since
  Oct 20, 2026" (from `settings.lastCalibratedAt`, the same test
  `startSession()` uses) or "Off". When off, the Tremor band row reads
  "… Hz (not applied)" in grey, with a short note that intensity counts all
  frequencies until calibration is completed.
- **Session Detail:** "Calibrated to Xg full-scale" is replaced by what the
  session was measured with — "Measured with 0.35g full scale · 0.006g noise
  floor" and "Band filter: 4.0–8.0 Hz" or "Band filter: off (all
  frequencies)". Older records without these fields show the values that
  applied then (0.006 g noise floor; band filter off). When the session is
  displayed on different settings, a third line says "Shown on your current
  1g full scale · 0.006g noise floor".
- New helper `dateFromIso()` in `utils/analyticsStats.js`.

## Thirty-fourth follow-up — version in Settings, remembered Analytics range

- **Version and build number** at the bottom of Settings, e.g.
  "SteadyPoint Version 1.2 (34)": the Version and Build set in Xcode
  (CFBundleShortVersionString / CFBundleVersion — what TestFlight shows),
  read with the new dependency **react-native-device-info 14.1.1**. Needs
  `npm install` and `cd ios && pod install` before building. If the native
  module is missing the label is simply left blank.
- **Analytics date range remembered.** Choosing 7D / 30D / All saves it as
  `settings.analyticsPeriod`; Analytics opens on it at the next launch
  (30D if never chosen).
- **Settings now saved as soon as they change.** Previously settings changed
  outside a session (full-scale preset, voice, custom tonal range) were only
  saved by the next full save — usually at the end of a session — so closing
  the app first lost them. App.js now calls the new
  `persistence.persistSettings()` whenever `state.settings` changes after
  launch (never on launch itself, so saved settings can't be overwritten by
  defaults). It writes settings + mode + meta, so it also works for a user
  who hasn't finished a session yet. Demo mode still never saves.

## Thirty-fifth follow-up — Settings split into Calibration and Sonification sub-pages

**Main Settings page** is now a short menu: **Calibration** (subtitle e.g.
"1.00 g full scale · band filtering on") and **Sonification** (subtitle: the
voice, or "Custom · 200–700 Hz"), each opening its own sub-page, plus the
version/build line at the bottom. The full-scale preset grid (Max/High/Low/
Min-sensitivity) and its wording are removed.

**Settings > Calibration** (`screens/CalibrationSettingsScreen.js`):
- Shows full scale range, noise floor, minimum and maximum tremor band and
  band filtering read-only. **Edit values** turns the four values into
  number fields (decimal keypad, − / + buttons, allowed-range hint) and band
  filtering into a switch, with **Save** / **Cancel** and **Restore defaults**
  (0.35 g, 0.006 g, 3.0–14.0 Hz, filtering off).
- Limits (`utils/calibrationLimits.js`): full scale 0.10–4.00 g (step 0.01);
  noise floor 0.000–0.050 g (step 0.001) and under 10% of full scale; band
  minimum 0.5–18.0 Hz and at least 1 Hz below the maximum; band maximum
  1.5–20.0 Hz (step 0.1). Values outside 3–12 Hz get a warning but are
  allowed. Errors show under the field and keep Save disabled.
- Save asks for confirmation, explaining the effect: full scale / noise floor
  changes re-display past sessions; band or filtering changes apply to new
  sessions only and are marked on Analytics. A format-only edit ("1" vs
  "1.00") just leaves edit mode. Leaving with unsaved edits (back button or
  swipe) asks whether to discard them.
- Manual saves record `calibrationSource: 'manual'` and `calibrationSetAt`;
  they do NOT set `lastCalibratedAt`, so they don't reset Home's 90-day
  recalibration reminder. A note shows "Last set manually on …" / "Last set
  by the calibration wizard on …" / "Using the default values."
- Below it: the calibration wizard (Open Calibration / Recalibrate) and
  Share Calibration Log. After saving wizard results, the app now returns to
  wherever the wizard was opened from (this page, or Home's reminder);
  first-launch calibration still continues into the app.

**Band filtering is now an explicit setting** (`settings.bandFilterEnabled`),
used by `startSession()` instead of "has a wizard calibration been saved".
Saving wizard results turns it on (and sets `calibrationSource: 'wizard'`).
Existing users are migrated in `persistLoad()` to exactly what they had:
on if they'd saved a wizard calibration, otherwise off.

**Settings > Sonification** (`screens/SonificationSettingsScreen.js`): the
former Sonification section, moved unchanged.

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
