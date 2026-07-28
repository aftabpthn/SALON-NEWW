import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

export type AiSession = { id: string; channel: string; status: string; locale: string };
export type AiMessage = { id: string; role: string; body: string; provider: string; modelName: string; promptVersion: string; intent: string; safetyFlags: string[]; createdAt: string };
export type AiReply = { session: AiSession; userMessage: AiMessage; assistantMessage: AiMessage; actionType: string; actionPayload: { serviceId?: string; bookingUrl?: string; requiresConfirmation?: boolean } };

@Injectable({ providedIn: 'root' })
export class AiConciergeService {
  private readonly api = inject(ApiService);

  async open(): Promise<AiSession> {
    return this.unwrap(await firstValueFrom(this.api.post<ApiEnvelope<AiSession>>('/ai/concierge/sessions', { locale: 'en-IN' })));
  }

  async transcript(sessionId: string): Promise<AiMessage[]> {
    return this.unwrap(await firstValueFrom(this.api.get<ApiEnvelope<AiMessage[]>>(`/ai/concierge/sessions/${encodeURIComponent(sessionId)}/transcript`)));
  }

  async send(sessionId: string, body: string): Promise<AiReply> {
    return this.unwrap(await firstValueFrom(this.api.post<ApiEnvelope<AiReply>>(`/ai/concierge/sessions/${encodeURIComponent(sessionId)}/messages`, { body })));
  }

  private unwrap<T>(response: ApiEnvelope<T>): T {
    if (!response.success || response.data === undefined) throw new Error(response.error?.message || 'AI concierge request failed');
    return response.data;
  }
}
