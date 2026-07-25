import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export interface PosRealtimeEvent {
  type: 'pos.updated';
  entityType: 'invoice' | 'terminal' | 'print_job' | 'cash_drawer';
  entityId: string;
  action: string;
}

@Injectable({ providedIn: 'root' })
export class PosRealtimeService {
  private readonly updates = new Subject<PosRealtimeEvent>();
  private socket: WebSocket | null = null;
  private socketToken = '';
  private retryTimer = 0;

  constructor(private readonly auth: AuthService) {}

  events(): Observable<PosRealtimeEvent> {
    this.connect();
    return this.updates.asObservable();
  }

  private realtimeUrl(): string {
    const configuredBase = environment.realtimeWsBaseUrl.trim() || environment.apiBaseUrl;
    const base = configuredBase.replace(/\/+$/, '');
    if (/^wss?:\/\//i.test(base)) return `${base}/realtime/pos`;

    const httpBase = base.match(/^https?:\/\/[^/]+/i)?.[0] ?? location.origin;
    const path = base.replace(/^https?:\/\/[^/]+/i, '');
    const wsOrigin = httpBase.replace(/^http/i, location.protocol === 'https:' ? 'wss' : 'ws');
    return `${wsOrigin}${path}/realtime/pos`;
  }
  private connect(): void {
    const token = this.auth.accessToken ?? '';
    if (!token) return;
    if (this.socket && this.socketToken === token && this.socket.readyState <= WebSocket.OPEN) return;

    window.clearTimeout(this.retryTimer);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
    }
    this.socketToken = token;
    this.socket = new WebSocket(this.realtimeUrl(), ['aurashine-v1', token]);
    this.socket.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(String(data)) as PosRealtimeEvent;
        if (event.type === 'pos.updated' && event.entityId) this.updates.next(event);
      } catch {
        // Ignore malformed transport messages; REST remains the source of truth.
      }
    };
    this.socket.onclose = () => {
      this.socket = null;
      this.retryTimer = window.setTimeout(() => this.connect(), 2_000);
    };
  }
}
