import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

export type AiSession = { id: string; channel: string; status: string; locale: string };
export type AiMessage = { id: string; role: string; body: string; provider: string; modelName: string; promptVersion: string; intent: string; safetyFlags: string[]; createdAt: string };
/** A starter question the drawer offers as a chip. */
export type AiSuggestedQuestion = {
  question: string;
  /** Tool it routes to, so chips can be grouped or filtered. */
  tool: string;
};

/** One quantity as current vs previous, with the change between them. */
export type AiCopilotMetric = {
  label: string;
  /** Pre-formatted by the backend (currency, percent or count). */
  current: string;
  previous: string;
  /** Null when the previous period was zero, so no percentage is meaningful. */
  changePercent: number | null;
  direction: 'up' | 'down' | 'flat' | string;
};

/** The exact date range an answer covers. */
export type AiCopilotPeriod = {
  label: string;
  start: string;
  end: string;
  /** Empty for answers that do not compare against an earlier period. */
  previousStart: string;
  previousEnd: string;
};

/**
 * Something the user can do next. The copilot only proposes — a proposal is a
 * CRM route plus prefilled values, never a change that has already happened.
 */
export type AiCopilotProposal = {
  /** Stable id, e.g. `create_offer_draft`. */
  kind: string;
  /** Button text, e.g. "Create Offer Draft". */
  label: string;
  /** CRM route to open. */
  route: string;
  /** Values to prefill on that screen. Never applied automatically. */
  params: Record<string, unknown>;
  /** True when completing this would change business data. */
  requiresApproval: boolean;
  /** What the user is approving, and what is still not done. Empty if read-only. */
  approvalPrompt: string;
  /** What completing this is expected to achieve. Always an estimate. */
  expectedImpact: string;
};

/** A CRM record an answer refers to, so the drawer can link straight to it. */
export type AiCopilotEntity = {
  /** `staff`, `client`, `service`, `offer`, `inventory_item`, `branch`. */
  kind: string;
  id: string;
  name: string;
  /** CRM route for this record. Empty when it has no own screen. */
  link: string;
};

/** Grounded evidence from the CRM tool that answered the question. */
export type AiCopilotAnswer = {
  /** Which read tool ran, e.g. `staff_performance_decline`. */
  tool: string;
  headline: string;
  /** Tenant the figures were read for. */
  tenantId: string;
  /** Branch the figures were read for, as an id. */
  branchId: string;
  /** Branch the figures describe. */
  branchName: string;
  /** CRM module or report the figures came from. */
  source: string;
  /** When the tool read the data, RFC 3339. */
  generatedAt: string;
  /** Records this answer refers to. */
  entities: AiCopilotEntity[];
  period: AiCopilotPeriod;
  /** Headline quantities, current vs previous. */
  metrics: AiCopilotMetric[];
  /** Why the numbers moved, derived from the data. */
  reason: string;
  /** The figures the conclusion rests on. */
  evidence: string[];
  recommendedAction: string;
  /** CRM route to open to act on the answer. */
  deepLink: string;
  /** What the user can do next. Nothing here has been done for them. */
  proposals: AiCopilotProposal[];
  confidence: 'high' | 'medium' | 'low' | string;
  /** Structured rows behind the answer. */
  data: Record<string, unknown>;
};

export type AiReply = {
  session: AiSession;
  userMessage: AiMessage;
  assistantMessage: AiMessage;
  actionType: string;
  actionPayload: { serviceId?: string; bookingUrl?: string; requiresConfirmation?: boolean };
  providerStatus: string;
  copilot?: AiCopilotAnswer;
  /** Set when a tool matched but the signed-in role may not run it. */
  restrictedTool?: string;
};

/**
 * An action the user has been asked to agree to. Creating one changes nothing;
 * it is approved only once `confirmAction` is called with an explicit
 * confirmation. The owning CRM screen still performs the real change.
 */
export type AiActionDraft = {
  id: string;
  actionType: string;
  /** `draft`, `approved` or `cancelled`. */
  status: string;
  /** Exactly what the user is agreeing to. */
  summary: string;
  /** What will still not have happened after this runs. */
  confirmationNote: string;
  requiresConfirmation: boolean;
  payload: Record<string, unknown>;
  /** CRM screen that owns the change. */
  route: string;
  /** Screens to reload after the user completes the change there. */
  refreshTargets: string[];
  result: Record<string, unknown>;
};

/** Which concierge call failed, so the drawer can retry exactly that step. */
export type AiConciergeStep = 'open' | 'transcript' | 'send' | 'suggestions' | 'feedback' | 'action';

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

  /** Opens a session in the user's language, so answers come back in it. */
  async open(locale: string): Promise<AiSession> {
    return this.call('open', () => this.api.post<ApiEnvelope<AiSession>>('/ai/concierge/sessions', { locale }));
  }

  async transcript(sessionId: string): Promise<AiMessage[]> {
    return this.call('transcript', () => this.api.get<ApiEnvelope<AiMessage[]>>(`/ai/concierge/sessions/${encodeURIComponent(sessionId)}/transcript`));
  }

  /**
   * `submissionId` identifies one thing the user typed, not one HTTP attempt.
   * Retrying keeps the same id, so a resend of a message the server already
   * stored is rejected as a conflict instead of duplicating the transcript.
   */
  async send(sessionId: string, body: string, submissionId: string): Promise<AiReply> {
    return this.call('send', () => this.api.post<ApiEnvelope<AiReply>>(
      `/ai/concierge/sessions/${encodeURIComponent(sessionId)}/messages`,
      { body, providerMessageId: submissionId }));
  }

  /** Starter questions this role may actually have answered, in their language. */
  async suggestions(locale: string): Promise<AiSuggestedQuestion[]> {
    return this.call('suggestions', () =>
      this.api.get<ApiEnvelope<AiSuggestedQuestion[]>>(`/ai/concierge/suggestions?locale=${encodeURIComponent(locale)}`));
  }

  /** Records whether an answer was useful. Voting again replaces the first vote. */
  async sendFeedback(sessionId: string, messageId: string, helpful: boolean, tool: string): Promise<void> {
    await this.call('feedback', () =>
      this.api.post<ApiEnvelope<unknown>>(`/ai/concierge/sessions/${encodeURIComponent(sessionId)}/feedback`, { messageId, helpful, tool }));
  }

  /** Raises an approval draft. This API does not perform the CRM change. */
  async createAction(actionType: string, payload: Record<string, unknown>, summary = ''): Promise<AiActionDraft> {
    return this.call('action', () =>
      this.api.post<ApiEnvelope<AiActionDraft>>('/ai/actions/drafts', { actionType, payload, summary }));
  }

  /**
   * Records approval for a draft the user explicitly confirmed.
   *
   * `confirmationId` identifies the confirmation, not the attempt: replaying it
   * returns the first result rather than approving twice, so a double-tap
   * or a retried request is safe.
   */
  async confirmAction(draftId: string, confirmationId: string): Promise<AiActionDraft> {
    return this.call('action', () =>
      this.api.post<ApiEnvelope<AiActionDraft>>(
        `/ai/actions/drafts/${encodeURIComponent(draftId)}/confirm`, { idempotencyKey: confirmationId }));
  }

  async cancelAction(draftId: string): Promise<AiActionDraft> {
    return this.call('action', () =>
      this.api.post<ApiEnvelope<AiActionDraft>>(
        `/ai/actions/drafts/${encodeURIComponent(draftId)}/cancel`, {}));
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
