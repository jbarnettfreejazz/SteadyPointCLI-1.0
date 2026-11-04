export default { name: 'stubs', setup(b) {
  const stub = new URL('./stubs.js', import.meta.url).pathname;
  b.onResolve({ filter: /^(react-native|\.\/ble|\.\/persistence|\.\/audio|\.\/guideTrackPlayer|\.\/guideAudioPicker|\.\/sessionService|\.\.\/utils\/dsp|\.\.\/utils\/sessionStats|\.\.\/state\/liveSession)$/ }, () => ({ path: stub }));
  b.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({ path: new URL('./asmock.js', import.meta.url).pathname }));
}};
