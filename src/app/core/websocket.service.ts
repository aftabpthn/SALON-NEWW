import { Injectable, effect, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthSessionService } from './auth-session.service';
import { ApiService } from './api.service';
import { AppStateService } from './state/app-state.service';

export type RealtimeFrame<T = unknown> = {
  type: string;
  payload: T;
  meta?: {
    version?: string;
    timestamp?: string;
    eventId?: string;
    channel?: string;
  };
};

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  readonly connected = signal(false);
  readonly events = signal<RealtimeFrame[]>([]);

  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private started = false;
  private connectionKey = '';
  private connectionAttempt = 0;

  constructor(
    private readonly auth: AuthSessionService,
    private readonly appState: AppStateService,
    private readonly api: ApiService
  ) {
    effect(() => {
      this.auth.accessToken();
      this.auth.session()?.tenant.id;
      this.appState.selectedTenantId();
      this.appState.selectedBranchId();
      if (this.started) this.scheduleReconcile(0);
    });
  }

  connect(): void {
    this.started = true;
    this.scheduleReconcile(0);
  }

  private async reconcile(): Promise<void> {
    const token = this.auth.accessToken();
    const authenticatedTenantId = this.auth.session()?.tenant.id || '';
    const selectedTenantId = this.appState.selectedTenantId();
    const branchId = this.appState.selectedBranchId();
    const key = `${token}|${authenticatedTenantId}|${selectedTenantId}|${branchId}`;
    if (!this.started || !token) {
      this.connectionAttempt += 1;
      this.closeSocket();
      return;
    }
    if (this.connectionKey === key && this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    this.closeSocket();
    const attempt = ++this.connectionAttempt;
    this.connectionKey = key;
    let issued: { ticket: string };
    try {
      issued = await firstValueFrom(this.api.post<{ ticket: string }>('realtime/ticket', { branchId }));
    } catch {
      if (attempt === this.connectionAttempt && this.started) this.scheduleReconnect();
      return;
    }
    if (attempt !== this.connectionAttempt || key !== this.currentConnectionKey() || !issued.ticket) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/api/v1/realtime?ticket=${encodeURIComponent(issued.ticket)}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.connected.set(true);
      this.reconnectAttempt = 0;
      this.clearReconnectTimer();
      this.send({ type: 'subscribe', channel: `tenant:${authenticatedTenantId}` });
      if (branchId) this.send({ type: 'subscribe', channel: `branch:${branchId}` });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      try {
        const frame = JSON.parse(event.data) as RealtimeFrame;
        this.events.update((items) => [frame, ...items].slice(0, 100));
      } catch {
        this.events.update((items) => [{ type: 'error', payload: { message: 'Realtime frame parse failed' } }, ...items].slice(0, 100));
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connected.set(false);
      if (this.started && key === this.currentConnectionKey()) this.scheduleReconnect();
    };
  }

  send(frame: { type: string; channel?: string; payload?: unknown }): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(frame));
  }

  disconnect(): void {
    this.started = false;
    this.connectionAttempt += 1;
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.closeSocket();
  }

  private currentConnectionKey(): string {
    return `${this.auth.accessToken()}|${this.auth.session()?.tenant.id || ''}|${this.appState.selectedTenantId()}|${this.appState.selectedBranchId()}`;
  }

  private scheduleReconnect(): void {
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt) + Math.round(Math.random() * 500);
    this.reconnectAttempt += 1;
    this.scheduleReconcile(delay);
  }

  private scheduleReconcile(delay: number): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconcile();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.connectionKey = '';
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }
    this.connected.set(false);
  }
}
