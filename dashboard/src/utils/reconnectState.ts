export interface ReconnectState {
  isConnected: boolean;
  hadConnected: boolean;
  wasDisconnected: boolean;
  /** The socket gave up or the server closed it: dead until the user retries. */
  connectionFailed: boolean;
}

export interface ReconnectDecision {
  invalidate: boolean;
  hadConnected: boolean;
  wasDisconnected: boolean;
}

/**
 * Pure state transition that detects a WebSocket RECONNECT — a connect that follows a disconnect
 * after the initial connection. Extracted from the component so the transition is unit-testable
 * independent of React/socket.io.
 *
 * A reconnect means realtime events (message.received/ack/revoke) were missed during the gap. On
 * `invalidate: true` the caller re-reads what it holds outside the per-connect refresh (Chats: the
 * chat list and contact statuses; useSessionFeed: the session cards). Chat threads are not refreshed
 * here: Chats invalidates them in its subscribe effect on every connect.
 *
 * - First connect (hadConnected false): no invalidate. The cache is not necessarily empty (a remount
 *   within gcTime keeps the threads read before it); refreshing those is not this decision's job.
 * - Disconnect after the first connect: mark a gap (wasDisconnected), no invalidate.
 * - Connect with a marked gap: RECONNECT — invalidate, then clear the gap marker.
 * - Disconnect before any connect (transient noise on mount): no gap marked (avoid a spurious first-
 *   connect invalidate if isConnected toggles false→true before the real first connect).
 * - Failed feed (connectionFailed), even one that never connected: mark a gap, and keep it while the
 *   retry clears the flag. The data read at mount is older than the failure, and a rejected handshake
 *   can deliver its connect and its close in one batch, so isConnected may never have rendered true.
 */
export function nextReconnectState(state: ReconnectState): ReconnectDecision {
  if (state.isConnected) {
    return {
      invalidate: state.wasDisconnected,
      hadConnected: true,
      wasDisconnected: false,
    };
  }
  return {
    invalidate: false,
    hadConnected: state.hadConnected,
    wasDisconnected: state.wasDisconnected || state.hadConnected || state.connectionFailed,
  };
}
