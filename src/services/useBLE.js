import { useCallback } from 'react';
import { useStore } from '../state/StoreContext';
import * as bleService from './ble';
import { resetLiveSession, stopRecordingBuffers } from '../state/liveSession';

export function useBLE() {
  const { actions } = useStore();

  const connect = useCallback(() => {
    bleService.connectBLE({
      onConnecting: () => actions.bleConnecting(),
      onConnected: () => actions.bleConnected(),
      onDisconnected: () => {
        actions.bleDisconnected();
        actions.bleErrorSet('Device disconnected.');
        stopRecordingBuffers();
      },
      onError: (message) => actions.bleErrorSet(message),
    });
  }, [actions]);

  const disconnect = useCallback(async () => {
    await bleService.disconnectBLE();
    actions.bleDisconnected();
    resetLiveSession();
  }, [actions]);

  const sendCommand = useCallback((cmd) => bleService.sendCommand(cmd), []);

  return { connect, disconnect, sendCommand };
}
