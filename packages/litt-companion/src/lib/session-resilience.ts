import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import { AppState, AppStateStatus } from "react-native";

export interface ResilienceConfig {
  conversationId?: string;
  runId?: string;
  onNetworkStatusChange?: (isConnected: boolean) => void;
  onReconnectRequired?: () => void;
}

export class SessionResilienceManager {
  private processedEventIds = new Set<string>();
  private isConnected: boolean = true;
  private appState: AppStateStatus = AppState.currentState;

  constructor(private config: ResilienceConfig) {
    this.initNetworkListener();
    this.initAppStateListener();
  }

  private initNetworkListener() {
    NetInfo.addEventListener((state: NetInfoState) => {
      const connected = !!state.isConnected;
      if (this.isConnected !== connected) {
        this.isConnected = connected;
        if (this.config.onNetworkStatusChange) {
          this.config.onNetworkStatusChange(connected);
        }
        if (connected && this.config.onReconnectRequired) {
          this.config.onReconnectRequired();
        }
      }
    });
  }

  private initAppStateListener() {
    AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (this.appState.match(/inactive|background/) && nextState === "active") {
        if (this.isConnected && this.config.onReconnectRequired) {
          this.config.onReconnectRequired();
        }
      }
      this.appState = nextState;
    });
  }

  isDuplicateEvent(eventId: string): boolean {
    if (this.processedEventIds.has(eventId)) {
      return true;
    }
    this.processedEventIds.add(eventId);
    if (this.processedEventIds.size > 500) {
      const first = Array.from(this.processedEventIds)[0];
      this.processedEventIds.delete(first);
    }
    return false;
  }
}
