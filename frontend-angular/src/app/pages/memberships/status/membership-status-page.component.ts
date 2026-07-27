
import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type PublicCredit = { serviceId: string; serviceName: string; remainingQty: number };
type AdvancedReward = { code: string; name: string; active: boolean; rewardType: string; pointsRequired: number; amountPaise: number; discountBps: number; serviceId: string; occasionType: string; validityDays: number };
type PublicStampCard = {
  programCode: string;
  programName: string;
  balance: number;
  stampsRequired: number;
  remainingStamps: number;
  rewardPointsOnCompletion: number;
  progressBps: number;
};
type PublicStatus = {
  clientName: string;
  membershipName: string;
  status: string;
  expiresAt?: string;
  tokenExpiresAt: string;
  credits: PublicCredit[];
  rewardPointsBalance: number;
  stampCards: PublicStampCard[];
  advancedRewards: AdvancedReward[];
};
type RewardQr = { token: string; points: number; amountPaise: number; status: string; expiresAt: string; qrSvg: string };

@Component({
    selector: 'page-membership-status',
    imports: [FormsModule],
    templateUrl: './membership-status-page.component.html',
    styleUrls: ['./membership-status-page.component.css']
})
export class MembershipStatusPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  status: PublicStatus | null = null;
  loading = true;
  requesting = false;
  message = '';
  error = '';
  paymentReference = '';
  creditServiceId = '';
  creditDelta: string | number = '';
  reason = '';
  redeemPoints: string | number = '';
  redeemAmountRupees: string | number = '';
  selectedRewardCode = '';
  rewardQr: RewardQr | null = null;

  ngOnInit() { void this.load(); }
  formatDate(value?: string) { if (!value) return 'No expiry'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB').format(date); }
  progress(card: PublicStampCard) { return Math.max(0, Math.min(100, Math.round((Number(card.progressBps) || 0) / 100))); }
  async requestRenewal() {
    this.requesting = true; this.error = '';
    try { await firstValueFrom(this.api.post(`/membership-enterprise/self-service/public/${this.token()}/renew`, {})); this.message = 'Renewal request submitted'; }
    catch { this.error = 'Renewal request could not be submitted'; }
    finally { this.requesting = false; }
  }
  async submitRequest(requestType: 'payment_method_update' | 'credit_adjustment') {
    if (requestType === 'payment_method_update' && !this.paymentReference.trim()) { this.error = 'Payment reference required'; return; }
    if (requestType === 'credit_adjustment' && (!this.creditServiceId || Number(this.creditDelta) === 0)) { this.error = 'Service and non-zero credit adjustment required'; return; }
    this.requesting = true; this.error = ''; this.message = '';
    try {
      await firstValueFrom(this.api.post(`/membership-enterprise/self-service/public/${this.token()}/request`, { requestType, reason: this.reason, paymentReference: this.paymentReference.trim(), serviceId: this.creditServiceId, creditDelta: Number(this.creditDelta || 0) }));
      this.message = 'Request submitted for approval'; this.paymentReference = ''; this.creditServiceId = ''; this.creditDelta = ''; this.reason = '';
    } catch { this.error = 'Request could not be submitted'; }
    finally { this.requesting = false; }
  }
  async createRewardQr() {
    const reward = this.status?.advancedRewards?.find((item) => item.code === this.selectedRewardCode);
    const points = Number(reward?.pointsRequired || this.redeemPoints || 0);
    const amountPaise = Number(reward?.amountPaise || Math.round(Number(this.redeemAmountRupees || 0) * 100));
    if (points <= 0 || amountPaise <= 0) { this.error = 'Points and amount required'; return; }
    if (this.status && points > (this.status.rewardPointsBalance || 0)) { this.error = 'Insufficient reward points'; return; }
    this.requesting = true; this.error = ''; this.message = ''; this.rewardQr = null;
    try {
      const result = await firstValueFrom(this.api.post<ApiEnvelope<RewardQr>>(`/membership-enterprise/self-service/public/${this.token()}/reward-qr`, { points, amountPaise, idempotencyKey: this.randomKey(), rewardCode: reward?.code || '', rewardType: reward?.rewardType || 'flat_discount', rewardLabel: reward?.name || '', rewardBps: reward?.discountBps || 0, serviceId: reward?.serviceId || '', occasionType: reward?.occasionType || '' }));
      this.rewardQr = result.data || null; this.message = 'Redeem QR generated';
    } catch { this.error = 'Redeem QR could not be generated'; }
    finally { this.requesting = false; }
  }
  private async load() {
    try { const result = await firstValueFrom(this.api.get<ApiEnvelope<PublicStatus>>(`/membership-enterprise/self-service/public/${this.token()}`)); this.status = result.data || null; if (!this.status) this.error = 'Membership link is invalid or expired'; }
    catch { this.error = 'Membership link is invalid or expired'; }
    finally { this.loading = false; }
  }
  private token() { return this.route.snapshot.paramMap.get('token') || ''; }
  private randomKey() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}
