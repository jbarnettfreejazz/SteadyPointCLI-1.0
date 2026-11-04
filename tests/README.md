# SteadyPoint off-device tests

Node scripts that bundle the app's real source (`../src`, `../App.js`) with
esbuild, swap React Native / native modules for small mocks, and check
behaviour. No simulator or phone needed. They're separate from the
project's Jest setup and have their own dependencies.

## Run

```
cd tests
npm install        # once (esbuild, react 19.1.4, react-test-renderer 19.1.0)
npm test           # all suites, with a summary; exit code 1 on any failure
node run-all.mjs render    # one suite: logic | render | cal | dsp
```

Each test file prints `N passed, M failed` and a `FAIL: …` line per failed
check. Files are re-bundled on every run (`out*.mjs`, git-ignored), so they
always test the current source. Last full run: 534 passed, 0 failed.

## Suites

| Folder | What it covers |
|---|---|
| `logic/` | Session logic and state: start/end/resume sessions, checkpoints and launch recovery (`test8`), the live metrics loop driven with synthetic tremor signals (`test6` — intensity, in-band/actual frequency, edge-spill muting, upper limit, map trail), intensity stats (`test3`), records, reducer; Android sample copying and calibration-log sharing (`test9`, own mocks `mock9.js`); Android BLE packet size (`test10`, mocks `mock10*.js`); navigation helper `go()` against React Navigation 7's real StackRouter (`test11`) and the patched react-native-sound (`test12`) — both need the app's `node_modules`, so run `npm install` in the project root first; the Android session foreground service wrapper (`test13`, mock `mock13rn.js`). `bundle.mjs` / `b3.mjs` build the bundles `test`/`test2`/`test3` import. |
| `render/` | Screens rendered with react-test-renderer and mocked RN/SVG: Recording (tremor map, numbers, g value — `testRec`), Settings and Calibration sub-pages and editor incl. upper limit (`testCal`), Session History (`testHist`), Home, Analytics, Session Detail, Results, App shell. `viewMap.mjs` draws the tremor map to `map.html` for a visual check. |
| `cal/` | Calibration wizard (readiness, results, defaults). |
| `dsp/` | Frequency detection accuracy (`tremorPeakFrequency`) on synthetic tremors. |
| `native/` | `run.sh`: ThreadSanitizer stress test of the patched react-native-audio-api `AudioParam` (needs the patched library in `../node_modules` and g++/clang with TSan). Not part of `npm test`. |

## How the mocks work

- `*/plugin.mjs` — esbuild resolve plugin mapping `react-native`,
  `react-native-svg`, the store, BLE, audio, persistence etc. to the local
  mock files.
- `render/` mocks read test state from globals: `globalThis.__store`
  (`{ state, actions }`), `__live` (live session values for the Recording
  screen), `__nav`, `__alerts` (Alert.alert calls).
- `logic/` stubs replace audio and checkpoint storage; `asmock.js` is an
  in-memory AsyncStorage; `test6`/`test8` fake `setInterval` and `Date.now`
  to drive the real 300 ms metrics loop.

When app code gains a new export that a mocked module must provide (e.g. a
new `liveSession` function used by `sessionLogic`), add it to the matching
stub — a missing one shows up as "… is not a function" in that suite.
