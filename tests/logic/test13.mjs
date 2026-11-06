// FIFTY-FIFTH follow-up: src/services/sessionService.js — Android session
// foreground service wrapper: permission asked once, calls kept in order,
// failures swallowed, iOS no-ops.
import { build } from 'esbuild';
const plugin = { name: 'm13', setup(b) {
  b.onResolve({ filter: /^react-native$/ }, () => ({ path: new URL('./mock13rn.js', import.meta.url).pathname }));
  b.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({ path: new URL('./asmock.js', import.meta.url).pathname }));
} };
await build({ entryPoints: ['entry13.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'out13.mjs', plugins: [plugin], logLevel: 'error' });
const S = await import('./out13.mjs');
console.warn = () => {};
let ok = 0, fail = 0; const check = (n, c, x = '') => { if (c) ok++; else { fail++; console.log('FAIL:', n, x); } };
const g = globalThis;
const reset = (o = {}) => { g.__listeners = []; g.__emitterCount = 0; g.__native = []; g.__os = 'android'; g.__ver = 34; g.__granted = false; g.__answer = 'granted'; g.__noModule = false; g.__startFails = false; Object.assign(g, o); S.AS._store.clear(); S.__resetForTests(); };
const J = (x) => JSON.stringify(x);

check('text: continuous', S.sessionNotificationText({ duration: null }) === 'Continuous session');
check('text: timed', S.sessionNotificationText({ duration: 10 }) === '10-minute session');
check('text: missing config', S.sessionNotificationText(undefined) === 'Continuous session');

// iOS: nothing native
reset({ __os: 'ios' });
check('iOS start is a no-op', (await S.startSessionService({ duration: 5 })) === false && (await S.stopSessionService()) === false && g.__native.length === 0);

// Android 13+, first session: ask once, then start; second session: no ask
reset();
check('first start resolves true', (await S.startSessionService({ duration: null })) === true);
check('asks for notifications, then starts', J(g.__native) === J([['ask', 'android.permission.POST_NOTIFICATIONS'], ['start', 'Continuous session'], ['monitorStart']]), J(g.__native));
check('remembers it asked', S.AS._store.get(S.NOTIFICATION_ASKED_KEY) === '1');
await S.stopSessionService(); g.__native = []; g.__answer = 'denied';
await S.startSessionService({ duration: 10 });
check('second session: not asked again (even if declined)', J(g.__native) === J([['start', '10-minute session'], ['monitorStart']]), J(g.__native));

// already granted: no dialog
reset({ __granted: true });
await S.startSessionService({ duration: null });
check('already granted: no dialog', J(g.__native) === J([['start', 'Continuous session'], ['monitorStart']]), J(g.__native));

// Android 12: no notification permission exists
reset({ __ver: 32 });
await S.startSessionService({ duration: null });
check('Android 12: no dialog', J(g.__native) === J([['start', 'Continuous session'], ['monitorStart']]), J(g.__native));

// session ends while the permission dialog is open: stop still comes after start
reset();
const p1 = S.startSessionService({ duration: null }); const p2 = S.stopSessionService();
await Promise.all([p1, p2]);
check('order kept: ask, start, stop', J(g.__native) === J([['ask', 'android.permission.POST_NOTIFICATIONS'], ['start', 'Continuous session'], ['monitorStart'], ['monitorStop'], ['stop']]), J(g.__native));

// native failure never throws
reset({ __granted: true, __startFails: true });
let threw = false; let r;
try { r = await S.startSessionService({ duration: null }); } catch (e) { threw = true; }
check('start failure resolves false, no throw', !threw && r === false);
check('a later stop still runs', (await S.stopSessionService()) === true);

// module missing (e.g. an old build): no-op
reset({ __noModule: true });
check('missing native module: no-op', (await S.startSessionService({ duration: null })) === false && g.__native.length === 0);


// FIFTY-EIGHTH follow-up: call monitor events reach the session's handler
reset({ __granted: true });
const seen = [];
S.onCallStateChange((inCall) => seen.push(inCall));
await S.startSessionService({ duration: null });
g.__emit(S.CALL_STATE_EVENT, { inCall: true, mode: 2 });
g.__emit(S.CALL_STATE_EVENT, { inCall: false, mode: 0 });
check('call events reach the handler', J(seen) === J([true, false]), J(seen));
await S.startSessionService({ duration: null });
check('one event subscription across sessions', g.__emitterCount === 1 && g.__listeners.length === 1, String(g.__emitterCount));
S.onCallStateChange(null);
g.__emit(S.CALL_STATE_EVENT, { inCall: true });
check('no handler after the session: ignored', J(seen) === J([true, false]));
S.onCallStateChange(() => { throw new Error('boom'); });
let threw2 = false; try { g.__emit(S.CALL_STATE_EVENT, { inCall: true }); } catch (e) { threw2 = true; }
check('a failing handler does not throw out of the event', !threw2);
reset({ __os: 'ios' });
await S.startSessionService({ duration: null });
check('iOS: no call monitor', g.__native.length === 0 && (g.__emitterCount || 0) === 0);
console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
