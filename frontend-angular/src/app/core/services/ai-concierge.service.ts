import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

export type AiSession = { id: string; channel: string; status: string; locale: string };
export type AiMessage = { id: string; role: string; body: string; provider: string; modelName: string; promptVersion: string; intent: string; safetyFlags: string[]; createdAt: string };
export type AiReply = { session: AiSession; userMessage: AiMessage; assistantMessage: AiMessage; actionType: string; actionPayload: { serviceId?: string; bookingUrl?: string; requiresConfirmation?: boolean }; providerStatus: string };

/** Which concierge call failed, so the drawer can retry exactly that step. */
export type AiConciergeStep = 'open' | 'transcript' | 'send';

export type AiConciergeFailure = {
  step: AiConciergeStep;
  /** Backend error code (VALIDATION_FAILED, AI_CHANNEL_DISABLED, …) or a transport code. */
  code: string;
  /** Server-supplied message. Empty when the request never reached the API. */
  detail: string;
  /** `meta.request_id` from the API envelope — quote this in a bug report. */
  requestId: string;
  /** HTTP status, or 0 when the browser could not reach the API at all. */
  status: number;
  /** True when retrying without changing anything could plausibly succeed. */
  retryable: boolean;
};

/** Carries the exact API failure instead of collapsing it into a generic message. */
export class AiConciergeError extends Error {
  constructor(readonly failure: AiConciergeFailure) {
    super(failure.detail || `AI concierge ${failure.step} failed (${failure.code})`);
    this.name = 'AiConciergeError';
  }
}

const RETRYABLE_STATUSES = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

@Injectable({ providedIn: 'root' })
export class AiConciergeService {
  private readonly api = inject(ApiService);

  async open(): Promise<AiSession> {
    return this.call('open', () => this.api.post<ApiEnvelope<AiSession>>('/ai/concierge/sessions', { locale: 'en-IN' }));
  }

  async transcript(sessionId: string): Promise<AiMessage[]> {
    return this.call('transcript', () => this.api.get<ApiEnvelope<AiMessage[]>>(`/ai/concierge/sessions/${encodeURIComponent(sessionId)}/transcript`));
  }

  async send(sessionId: string, body: string): Promise<AiReply> {
    return this.call('send', () => this.api.post<ApiEnvelope<AiReply>>(`/ai/concierge/sessions/${encodeURIComponent(sessionId)}/messages`, { body }));
  }

  private async call<T>(step: AiConciergeStep, request: () => Observable<ApiEnvelope<T>>): Promise<T> {
    let response: ApiEnvelope<T>;
    try {
      response = await firstValueFrom(request());
    } catch (error) {
      throw new AiConciergeError(this.describe(step, error));
    }
    if (!response.success || response.data === undefined) {
      throw new AiConciergeError({
        step,
        code: String(response.error?.code || 'INVALID_RESPONSE').toUpperCase(),
        detail: String(response.error?.message || ''),
        requestId: this.requestId(response),
        status: 200,
        retryable: false,
      });
    }
    return response.data;
  }

  private describe(step: AiConciergeStep, error: unknown): AiConciergeFailure {
    if (!(error instanceof HttpErrorResponse)) {
      return { step, code: 'CLIENT_ERROR', detail: error instanceof Error ? error.message : String(error), requestId: '', status: 0, retryable: true };
    }
    // A parsed API envelope carries the real code, message and request id.
    const envelope = (error.error ?? {}) as ApiEnvelope<unknown>;
    const body = typeof error.error === 'object' && error.error !== null ? envelope : undefined;
    const code = String(body?.error?.code || (error.status === 0 ? 'NETWORK_UNAVAILABLE' : `HTTP_${error.status}`)).toUpperCase();
    const detail = String(body?.error?.message || (error.status === 0 ? '' : error.statusText || ''));
    return {
      step,
      code,
      detail,
      requestId: body ? this.requestId(body) : '',
      status: error.status,
      retryable: RETRYABLE_STATUSES.has(error.status),
    };
  }

  private requestId(response: ApiEnvelope<unknown>): string {
    const meta = (response.meta ?? {}) as Record<string, unknown>;
    return String(meta['request_id'] ?? meta['requestId'] ?? '');
  }
}
