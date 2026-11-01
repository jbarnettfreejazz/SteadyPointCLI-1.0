export const Platform = { get OS() { return globalThis.__os || 'ios'; }, get Version() { return 34; } };
export const PermissionsAndroid = {
  PERMISSIONS: { BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect', ACCESS_FINE_LOCATION: 'loc' },
  RESULTS: { GRANTED: 'granted' },
  request: async () => 'granted',
  requestMultiple: async (l) => Object.fromEntries(l.map((k) => [k, 'granted'])),
};
