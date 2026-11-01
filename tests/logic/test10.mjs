// FIFTY-SECOND follow-up (Android round 1): larger BLE packets requested on
// Android after connecting, never blocking the connection; iOS untouched.
import { build } from 'esbuild';
const plugin = { name: 'm10', setup(b) {
  b.onResolve({ filter: /^react-native-ble-plx$/ }, () => ({ path: new URL('./mock10ble.js', import.meta.url).pathname }));
  b.onResolve({ filter: /^react-native$/ }, () => ({ path: new URL('./mock10rn.js', import.meta.url).pathname }));
  b.onResolve({ filter: /^\.\.\/state\/liveSession$/ }, () => ({ path: new URL('./mock10live.js', import.meta.url).pathname }));
} };
await build({ entryPoints: ['entry10.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'out10.mjs', plugins: [plugin], logLevel: 'error' });
const B = await import('./out10.mjs');
const { Buffer } = await import('buffer');
console.log = () => {}; console.warn = () => {};
let ok = 0, fail = 0;
const check = (n, c, x = '') => { if (c) ok++; else { fail++; process.stdout.write(`FAIL: ${n} ${x}\n`); } };
const flush = () => new Promise((r) => setTimeout(r, 5));

function fakeDevice({ mtuFails = false } = {}) {
  const calls = [];
  const conn = {
    requestMTU: async (m) => { calls.push(['mtu', m]); if (mtuFails) throw new Error('GATT error'); return { mtu: 185 }; },
    discoverAllServicesAndCharacteristics: async () => { calls.push(['discover']); },
    monitorCharacteristicForService: (_s, _c, cb) => { calls.push(['monitor']); conn.cb = cb; return { remove() {} }; },
    onDisconnected: () => {},
    cancelConnection: async () => {},
  };
  const dev = { name: 'TremorMonitor', connect: async (opts) => { calls.push(['connect', opts]); return conn; } };
  return { dev, conn, calls };
}
async function run(os, opts) {
  globalThis.__os = os; await B.disconnectBLE();
  const f = fakeDevice(opts); const ev = [];
  await B.connectBLE({ onConnecting: () => ev.push('connecting'), onConnected: (n) => ev.push('connected:' + n), onError: (m) => ev.push('error:' + m) });
  globalThis.__scanCb(null, f.dev); await flush();
  return { ...f, ev };
}

let r = await run('android');
check('Android: MTU requested after connect, before discovery', JSON.stringify(r.calls.map((c) => c[0]).slice(0, 3)) === '["connect","mtu","discover"]', JSON.stringify(r.calls));
check('Android: asks for 185', r.calls[1][1] === 185 && B.ANDROID_REQUESTED_MTU === 185);
check('Android: connect() itself has no MTU option', r.calls[0][1] === undefined);
check('Android: connected', r.ev.includes('connected:TremorMonitor') && !r.ev.some((e) => e.startsWith('error')), JSON.stringify(r.ev));
globalThis.__pkts = [];
r.conn.cb(null, { value: Buffer.from('-0.0123,0.4567,-0.9876').toString('base64') });
check('Android: 22-character packet parsed whole', JSON.stringify(globalThis.__pkts[0]) === '[-0.0123,0.4567,-0.9876]', JSON.stringify(globalThis.__pkts));

r = await run('android', { mtuFails: true });
check('Android: MTU refusal does not fail the connection', r.ev.includes('connected:TremorMonitor') && !r.ev.some((e) => e.startsWith('error')) && r.calls.some((c) => c[0] === 'monitor'), JSON.stringify(r.ev));

r = await run('ios');
check('iOS: no MTU request', !r.calls.some((c) => c[0] === 'mtu') && r.ev.includes('connected:TremorMonitor'), JSON.stringify(r.calls));

process.stdout.write(`${ok} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
