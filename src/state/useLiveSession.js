import { useSyncExternalStore } from 'react';
import { subscribeLive, getLiveState } from './liveSession';

// Subscribes a component to the live BLE packet store. Only components
// that actually render live tremor data (the Recording screen) should
// use this — everything else stays on the regular reducer state and
// won't re-render on every packet.
export function useLiveSession() {
  return useSyncExternalStore(subscribeLive, getLiveState, getLiveState);
}
