import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { ApiRecord, ApiService } from '../../../core/api.service';
import {
  AiDraftReplyResponse,
  PlatformSummary,
  ReputationAlert,
  ReputationDashboard,
  ReputationMetrics,
  ReputationPlatformsResponse,
  ReputationReview,
  ReputationScore,
  ReviewPlatform,
  ReviewReply,
  SupportedPlatform
} from '../domain/reputation.models';

@Injectable({ providedIn: 'root' })
export class ReputationApiService {
  constructor(private readonly api: ApiService) {}

  dashboard(params: ApiRecord = {}): Observable<ReputationDashboard> {
    return this.api.list<ApiRecord>('reputation/dashboard', params).pipe(
      map(normalizeDashboard),
      catchError((error) =>
        shouldUseLegacyFallback(error) ? this.legacyDashboard(params) : throwError(() => error)
      )
    );
  }

  reviews(params: ApiRecord = {}): Observable<ReputationReview[]> {
    return this.api.list<ApiRecord[]>('reputation/reviews', params).pipe(
      map((rows) => rows.map(normalizeReview)),
      catchError((error) =>
        shouldUseLegacyFallback(error) ? this.legacyReviews(params) : throwError(() => error)
      )
    );
  }

  review(id: string): Observable<ReputationReview> {
    return this.api.get<ApiRecord>('reputation/reviews', id).pipe(
      map(normalizeReview),
      catchError((error) =>
        shouldUseLegacyFallback(error)
          ? this.api.get<ApiRecord>('reputationReviews', id).pipe(map(normalizeReview))
          : throwError(() => error)
      )
    );
  }

  platforms(params: ApiRecord = {}): Observable<ReputationPlatformsResponse> {
    return this.api.list<ApiRecord>('reputation/platforms', params).pipe(
      map(normalizePlatformsResponse),
      catchError((error) =>
        shouldUseLegacyFallback(error)
          ? of({ platforms: [], supported: LEGACY_SUPPORTED_PLATFORMS })
          : throwError(() => error)
      )
    );
  }

  updateReview(id: string, payload: ApiRecord): Observable<ReputationReview> {
    return this.api.patch<ApiRecord>(`reputation/reviews/${id}`, payload).pipe(
      map(normalizeReview),
      catchError((error) =>
        shouldUseLegacyFallback(error)
          ? this.api.update<ApiRecord>('reputationReviews', id, payload).pipe(map(normalizeReview))
          : throwError(() => error)
      )
    );
  }

  assignReview(id: string, assignedTo: string): Observable<ReputationReview> {
    return this.api.post<ApiRecord>(`reputation/reviews/${id}/assign`, { assignedTo }).pipe(
      map(normalizeReview),
      catchError((error) =>
        shouldUseLegacyFallback(error)
          ? this.api.update<ApiRecord>('reputationReviews', id, { assignedTo, status: 'assigned' }).pipe(map(normalizeReview))
          : throwError(() => error)
      )
    );
  }

  resolveReview(id: string): Observable<ReputationReview> {
    return this.api.post<ApiRecord>(`reputation/reviews/${id}/resolve`, {}).pipe(
      map(normalizeReview),
      catchError((error) =>
        shouldUseLegacyFallback(error)
          ? this.api.update<ApiRecord>('reputationReviews', id, { status: 'resolved' }).pipe(map(normalizeReview))
          : throwError(() => error)
      )
    );
  }

  createReply(id: string, payload: ApiRecord): Observable<ReviewReply> {
    return this.api.post<ApiRecord>(`reputation/reviews/${id}/reply`, payload).pipe(
      map(normalizeReply),
      catchError((error) =>
        shouldUseLegacyFallback(error) ? this.legacyCreateReply(id, payload) : throwError(() => error)
      )
    );
  }

  draftReplies(id: string, payload: ApiRecord): Observable<AiDraftReplyResponse> {
    return this.api.post<ApiRecord>(`reputation/reviews/${id}/ai-draft-replies`, payload).pipe(
      map(normalizeDraftResponse),
      catchError((error) =>
        shouldUseLegacyFallback(error)
          ? of({
              reviewId: id,
              providerStatus: 'not_configured',
              approvalRequired: true,
              drafts: [],
              message: 'AI reply provider is not configured yet. Write a manual reply and save it for approval.'
            })
          : throwError(() => error)
      )
    );
  }

  approveReply(id: string): Observable<ReviewReply> {
    if (id.startsWith('legacy_reply_')) {
      return of(normalizeReply({ id, approvalStatus: 'approved', createdAt: new Date().toISOString() }));
    }
    return this.api.post<ApiRecord>(`reputation/replies/${id}/approve`, {}).pipe(map(normalizeReply));
  }

  postReply(id: string): Observable<ApiRecord> {
    return this.api.post<ApiRecord>(`reputation/replies/${id}/post`, {}).pipe(
      catchError((error) =>
        shouldUseLegacyFallback(error)
          ? of({
              status: 'not_configured',
              postedToPlatform: false,
              message: 'Google posting is not connected yet. Reply is saved internally only.'
            })
          : throwError(() => error)
      )
    );
  }

  syncPlatform(id: string): Observable<ApiRecord> {
    return this.api.post<ApiRecord>(`reputation/platforms/${id}/sync`, {}).pipe(
      catchError((error) =>
        shouldUseLegacyFallback(error)
          ? of({ status: 'not_configured', synced: false, message: 'Reputation platform API is not active. Restart backend or configure provider adapter.' })
          : throwError(() => error)
      )
    );
  }

  connectPlatform(code: string, branchId: string, payload: ApiRecord = {}): Observable<ApiRecord> {
    return this.api.post<ApiRecord>(`reputation/platforms/connect/${code}`, { branchId, ...payload }).pipe(
      catchError((error) =>
        shouldUseLegacyFallback(error)
          ? of({
              providerStatus: 'not_configured',
              oauthRequired: true,
              message: 'Reputation backend route is not active. Restart the backend, then connect the platform again.'
            })
          : throwError(() => error)
      )
    );
  }

  sendReviewRequest(appointmentId: string, payload: ApiRecord = {}): Observable<ApiRecord> {
    return this.api.post<ApiRecord>(`reputation/requests/send/${appointmentId}`, payload);
  }

  customerFeedbackReport(params: ApiRecord = {}): Observable<ApiRecord> {
    return this.api.list<ApiRecord>('reports/customer-feedback', params);
  }

  customerFeedbackStaffScore(params: ApiRecord = {}): Observable<ApiRecord> {
    return this.api.list<ApiRecord>('reports/customer-feedback/staff-score', params);
  }

  customerFeedbackServiceScore(params: ApiRecord = {}): Observable<ApiRecord> {
    return this.api.list<ApiRecord>('reports/customer-feedback/service-score', params);
  }

  sendFeedbackRecoveryMessage(id: string, payload: ApiRecord = {}): Observable<ApiRecord> {
    return this.api.post<ApiRecord>(`reports/customer-feedback/${encodeURIComponent(id)}/send-recovery-message`, payload);
  }

  markFeedbackReviewed(id: string, payload: ApiRecord = {}): Observable<ApiRecord> {
    return this.api.post<ApiRecord>(`reports/customer-feedback/${encodeURIComponent(id)}/mark-reviewed`, payload);
  }

  selectedBranchId(): string {
    return this.api.selectedBranchId();
  }

  private legacyDashboard(params: ApiRecord): Observable<ReputationDashboard> {
    return this.legacyReviews(params).pipe(map(dashboardFromReviews));
  }

  private legacyReviews(params: ApiRecord): Observable<ReputationReview[]> {
    return this.api
      .list<ApiRecord[]>('reputationReviews', params)
      .pipe(map((rows) => rows.map((row) => normalizeReview({ ...record(row), source: 'legacy' }))));
  }

  private legacyCreateReply(id: string, payload: ApiRecord): Observable<ReviewReply> {
    const replyText = string(payload['replyText'] ?? payload['reply_text'] ?? payload['text']);
    const createdAt = new Date().toISOString();
    return this.api.update<ApiRecord>('reputationReviews', id, {
      aiReply: {
        reply: replyText,
        approvalStatus: 'pending',
        createdAt
      },
      status: 'replied'
    }).pipe(
      map(() => normalizeReply({
        id: `legacy_reply_${id}`,
        reviewId: id,
        replyText,
        replyLanguage: string(payload['replyLanguage'], 'en'),
        approvalStatus: 'pending',
        postedToPlatform: false,
        createdAt
      }))
    );
  }
}

function normalizeDashboard(value: ApiRecord = {}): ReputationDashboard {
  const rawMetrics = record(value['metrics']);
  return {
    score: normalizeScore(record(value['score'])),
    metrics: {
      averageRating: number(rawMetrics['averageRating']),
      totalReviews: number(rawMetrics['totalReviews']),
      replyRate: number(rawMetrics['replyRate']),
      avgReplyTimeHours: number(rawMetrics['avgReplyTimeHours']),
      unresolvedNegative: number(rawMetrics['unresolvedNegative']),
      pendingReplyApprovals: number(rawMetrics['pendingReplyApprovals'])
    },
    platforms: array(value['platforms']).map(normalizePlatformSummary),
    recentReviews: array(value['recentReviews']).map(normalizeReview),
    alerts: array(value['alerts']).map(normalizeAlert),
    approvalRequiredByDefault: boolean(value['approvalRequiredByDefault'], true)
  };
}

function normalizeScore(value: ApiRecord = {}): ReputationScore {
  return {
    source: string(value['source'], 'computed'),
    branchId: string(value['branchId']),
    scoreDate: string(value['scoreDate']),
    overallScore: number(value['overallScore']),
    avgRating: number(value['avgRating']),
    totalReviews: number(value['totalReviews']),
    positivePct: number(value['positivePct']),
    negativePct: number(value['negativePct']),
    replyRate: number(value['replyRate']),
    netPromoterScore: number(value['netPromoterScore']),
    segments: record(value['segments']) as Record<string, number>
  };
}

function normalizePlatformSummary(input: unknown = {}): PlatformSummary {
  const value = record(input);
  return {
    platformId: string(value['platformId']),
    platformCode: string(value['platformCode']),
    platformName: string(value['platformName'], 'Review platform'),
    connected: boolean(value['connected']),
    reviewCount: number(value['reviewCount']),
    averageRating: number(value['averageRating']),
    lastSyncedAt: string(value['lastSyncedAt']),
    lastSyncStatus: string(value['lastSyncStatus'])
  };
}

function normalizeReview(input: unknown = {}): ReputationReview {
  const value = record(input);
  const platformName = string(value['platformName'] ?? value['platform'], 'Review platform');
  const reviewerName = string(value['reviewerName'] ?? value['reviewer'], 'Anonymous client');
  return {
    id: string(value['id']),
    source: string(value['source'], 'legacy'),
    branchId: string(value['branchId']),
    platformId: string(value['platformId']),
    platformCode: string(value['platformCode'] ?? value['platform'], platformName.toLowerCase()),
    platformName,
    reviewerName,
    reviewerAvatar: string(value['reviewerAvatar']),
    reviewerVerified: boolean(value['reviewerVerified']),
    customerId: string(value['customerId']),
    appointmentId: string(value['appointmentId']),
    invoiceId: string(value['invoiceId']),
    primaryStaffId: string(value['primaryStaffId']),
    serviceIds: array(value['serviceIds']).map((item) => String(item)),
    rating: number(value['rating']),
    ratingMax: number(value['ratingMax'], 5),
    title: string(value['title']),
    reviewText: string(value['reviewText']),
    reviewLanguage: string(value['reviewLanguage']),
    reviewTranslatedText: string(value['reviewTranslatedText']),
    sentiment: string(value['sentiment']) as ReputationReview['sentiment'],
    sentimentScore: number(value['sentimentScore']),
    sentimentConfidence: number(value['sentimentConfidence']),
    emotionPrimary: string(value['emotionPrimary']),
    topics: array(value['topics']).map((item) => String(item)),
    aspects: record(value['aspects']),
    intentDetected: string(value['intentDetected']),
    toxicityScore: number(value['toxicityScore']),
    fakeProbability: number(value['fakeProbability']),
    status: string(value['status'], 'new'),
    priority: string(value['priority'], 'normal'),
    assignedTo: string(value['assignedTo']),
    hasReply: boolean(value['hasReply']) || Boolean(value['replyText']),
    replyText: string(value['replyText']),
    replyApprovalStatus: string(value['replyApprovalStatus'], value['replyText'] ? 'pending' : '') as ReputationReview['replyApprovalStatus'],
    reviewedAt: string(value['reviewedAt']),
    createdAt: string(value['createdAt'] ?? value['reviewedAt'] ?? value['updatedAt']),
    updatedAt: string(value['updatedAt']),
    isFlagged: boolean(value['isFlagged']),
    flaggedReason: string(value['flaggedReason']),
    alerts: array(value['alerts']).map(normalizeAlert),
    replies: array(value['replies']).map(normalizeReply),
    staffAttribution: array(value['staffAttribution']).map(record)
  };
}

function normalizeReply(input: unknown = {}): ReviewReply {
  const value = record(input);
  return {
    id: string(value['id']),
    reviewId: string(value['reviewId']),
    branchId: string(value['branchId']),
    replyText: string(value['replyText']),
    replyLanguage: string(value['replyLanguage'], 'en'),
    aiGenerated: boolean(value['aiGenerated']),
    approvalStatus: string(value['approvalStatus'], 'pending') as ReviewReply['approvalStatus'],
    postedToPlatform: boolean(value['postedToPlatform']),
    createdBy: string(value['createdBy']),
    createdAt: string(value['createdAt'])
  };
}

function normalizeAlert(input: unknown = {}): ReputationAlert {
  const value = record(input);
  return {
    id: string(value['id']),
    branchId: string(value['branchId']),
    reviewId: string(value['reviewId']),
    severity: string(value['severity'], 'normal'),
    acknowledged: boolean(value['acknowledged']),
    resolutionAction: string(value['resolutionAction']),
    createdAt: string(value['createdAt'])
  };
}

function normalizePlatformsResponse(value: ApiRecord = {}): ReputationPlatformsResponse {
  return {
    platforms: array(value['platforms']).map(normalizePlatform),
    supported: array(value['supported']).map(normalizeSupportedPlatform)
  };
}

function normalizePlatform(input: unknown = {}): ReviewPlatform {
  const value = record(input);
  const providerConfig = record(value['providerConfig']);
  return {
    id: string(value['id']),
    branchId: string(value['branchId']),
    platformCode: string(value['platformCode']),
    platformName: string(value['platformName'], 'Review platform'),
    platformUrl: string(value['platformUrl']),
    businessListingId: string(value['businessListingId']),
    businessListingUrl: string(value['businessListingUrl']),
    autoSyncEnabled: boolean(value['autoSyncEnabled']),
    lastSyncedAt: string(value['lastSyncedAt']),
    lastSyncStatus: string(value['lastSyncStatus'], 'not_configured'),
    providerStatus: string(value['providerStatus'] ?? providerConfig['providerStatus'], 'not_configured'),
    tokenEnvKey: string(value['tokenEnvKey'] ?? providerConfig['tokenEnvKey']),
    accountId: string(value['accountId'] ?? providerConfig['accountId']),
    locationId: string(value['locationId'] ?? providerConfig['locationId']),
    pageAccountId: string(value['pageAccountId'] ?? providerConfig['pageId'] ?? providerConfig['instagramAccountId']),
    rateLimitPerDay: number(value['rateLimitPerDay']),
    providerConfig,
    isActive: boolean(value['isActive'], true)
  };
}

function normalizeSupportedPlatform(input: unknown = {}): SupportedPlatform {
  const value = record(input);
  return {
    code: string(value['code']),
    name: string(value['name'], 'Review platform'),
    rateLimitPerDay: number(value['rateLimitPerDay'])
  };
}

function normalizeDraftResponse(value: ApiRecord = {}): AiDraftReplyResponse {
  return {
    reviewId: string(value['reviewId']),
    providerStatus: string(value['providerStatus'], 'not_configured'),
    approvalRequired: boolean(value['approvalRequired'], true),
    drafts: array(value['drafts']).map((item) => String(item)),
    message: string(value['message'])
  };
}

const LEGACY_SUPPORTED_PLATFORMS: SupportedPlatform[] = [
  { code: 'google', name: 'Google Business Profile', rateLimitPerDay: 100 },
  { code: 'justdial', name: 'Justdial', rateLimitPerDay: 100 },
  { code: 'zomato', name: 'Zomato', rateLimitPerDay: 100 },
  { code: 'facebook', name: 'Facebook Pages', rateLimitPerDay: 100 },
  { code: 'instagram', name: 'Instagram', rateLimitPerDay: 100 },
  { code: 'whatsapp', name: 'WhatsApp', rateLimitPerDay: 500 },
  { code: 'sms', name: 'SMS', rateLimitPerDay: 500 },
  { code: 'internal', name: 'Internal Reviews', rateLimitPerDay: 0 }
];

function dashboardFromReviews(reviews: ReputationReview[]): ReputationDashboard {
  const totalReviews = reviews.length;
  const averageRating = average(reviews.map((review) => review.rating).filter((rating) => rating > 0));
  const repliedReviews = reviews.filter((review) => review.hasReply || review.replyText).length;
  const negativeReviews = reviews.filter(isNegativeReview);
  const positiveReviews = reviews.filter(isPositiveReview);
  const replyRate = percentage(repliedReviews, totalReviews);
  const positivePct = percentage(positiveReviews.length, totalReviews);
  const negativePct = percentage(negativeReviews.length, totalReviews);

  return {
    score: {
      source: 'legacy',
      branchId: string(reviews[0]?.branchId),
      scoreDate: new Date().toISOString().slice(0, 10),
      overallScore: scoreFromAverage(averageRating, replyRate, negativePct),
      avgRating: averageRating,
      totalReviews,
      positivePct,
      negativePct,
      replyRate,
      netPromoterScore: positivePct - negativePct,
      segments: {
        quantity: Math.min(100, totalReviews * 4),
        quality: Math.round((averageRating / 5) * 100),
        recency: Math.min(100, reviews.filter(isRecentReview).length * 12),
        response: replyRate,
        sentiment: Math.max(0, positivePct - negativePct)
      }
    },
    metrics: {
      averageRating,
      totalReviews,
      replyRate,
      avgReplyTimeHours: 0,
      unresolvedNegative: negativeReviews.filter((review) => review.status !== 'resolved').length,
      pendingReplyApprovals: reviews.filter((review) => review.replyApprovalStatus === 'pending').length
    },
    platforms: platformSummariesFromReviews(reviews),
    recentReviews: [...reviews].sort(sortByNewest).slice(0, 8),
    alerts: [],
    approvalRequiredByDefault: true
  };
}

function platformSummariesFromReviews(reviews: ReputationReview[]): PlatformSummary[] {
  const grouped = new Map<string, ReputationReview[]>();
  reviews.forEach((review) => {
    const code = platformCode(review);
    grouped.set(code, [...(grouped.get(code) || []), review]);
  });

  return Array.from(grouped.entries()).map(([code, platformReviews]) => ({
    platformId: code,
    platformCode: code,
    platformName: titleCase(platformReviews[0]?.platformName || code),
    connected: true,
    reviewCount: platformReviews.length,
    averageRating: average(platformReviews.map((review) => review.rating).filter((rating) => rating > 0)),
    lastSyncedAt: newestDate(platformReviews),
    lastSyncStatus: 'legacy'
  }));
}

function shouldUseLegacyFallback(error: unknown): boolean {
  const response = record(error);
  const body = record(response['error']);
  const message = string(
    body['error'] ?? body['message'] ?? response['message'] ?? response['statusText'] ?? response['name']
  ).toLowerCase();
  const status = number(response['status']);

  return status === 404 || message.includes('unknown api resource: reputation') || message.includes('unknown api resource');
}

function isPositiveReview(review: ReputationReview): boolean {
  return review.rating >= 4 || review.sentiment === 'positive' || review.sentiment === 'very_positive';
}

function isNegativeReview(review: ReputationReview): boolean {
  return review.rating <= 2 || review.sentiment === 'negative' || review.sentiment === 'very_negative';
}

function isRecentReview(review: ReputationReview): boolean {
  const value = reviewDate(review);
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= 30 * 24 * 60 * 60 * 1000;
}

function platformCode(review: ReputationReview): string {
  return string(review.platformCode || review.platformName, 'internal').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function reviewDate(review: ReputationReview): string {
  return review.reviewedAt || review.createdAt || review.updatedAt;
}

function sortByNewest(left: ReputationReview, right: ReputationReview): number {
  return new Date(reviewDate(right)).getTime() - new Date(reviewDate(left)).getTime();
}

function newestDate(reviews: ReputationReview[]): string {
  return reviews.map(reviewDate).filter(Boolean).sort().at(-1) || '';
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function scoreFromAverage(averageRating: number, replyRate: number, negativePct: number): number {
  const ratingScore = (averageRating / 5) * 70;
  const responseScore = Math.min(replyRate, 100) * 0.2;
  const sentimentPenalty = Math.min(negativePct, 100) * 0.25;
  return Math.max(0, Math.min(100, Math.round(ratingScore + responseScore + 10 - sentimentPenalty)));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function record(value: unknown): ApiRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ApiRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown, fallback = ''): string {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}
