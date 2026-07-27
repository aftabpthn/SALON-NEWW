import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type BonusRuleForm = { minBillRupees: number | string; rewardType: 'percentage' | 'flat'; rewardValue: number | string };

type RewardsSettings = {
  allowNonMembers: boolean;
  enableForProducts: boolean;
  enableForPackages: boolean;
  enableForMemberships: boolean;
  enableForServices: boolean;
  rewardValuePaise: number;
  rewardPoints: number;
  minimumRedemptionPoints: number;
  bonusRules: Array<{ minBillPaise: number; rewardType: string; rewardValue: number }>;
};

type StampCardLineTypes = { service: boolean; product: boolean; package: boolean; membership: boolean };

type StampCardSettings = {
  code: string;
  name: string;
  active: boolean;
  stampsRequired: number;
  rewardPointsOnCompletion: number;
  earnRule: { minimumBillPaise: number; eligibleLineTypes: StampCardLineTypes };
};

/// Owner-facing form row. Minimum bill is edited in rupees and stored in paise.
type StampCardForm = {
  code: string;
  name: string;
  active: boolean;
  stampsRequired: number | string;
  rewardPointsOnCompletion: number | string;
  minimumBillRupees: number | string;
  service: boolean;
  product: boolean;
  package: boolean;
  membership: boolean;
};

type MembershipSettingsPayload = Record<string, unknown> & {
  rewards?: RewardsSettings;
  stampCards?: StampCardSettings[];
};

@Component({
    selector: 'page-rewards',
    imports: [CommonModule, FormsModule],
    templateUrl: './rewards-page.component.html',
    styleUrls: ['./rewards-page.component.css']
})
export class RewardsPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  loading = true;
  saving = false;
  error = '';
  message = '';

  allowNonMembers = false;
  enableForProducts = false;
  enableForPackages = false;
  enableForMemberships = false;
  enableForServices = false;
  rewardValueRupees: number | string = 100;
  rewardPoints: number | string = 5;
  minimumRedemptionPoints: number | string = 100;
  bonusRules: BonusRuleForm[] = [];
  stampCards: StampCardForm[] = [];

  private settings: MembershipSettingsPayload = {};

  async ngOnInit() {
    await this.loadSettings();
  }

  addBonusRule() {
    if (this.bonusRules.length >= 10) {
      this.error = 'A maximum of 10 bonus rules is supported.';
      return;
    }
    this.bonusRules = [...this.bonusRules, { minBillRupees: '', rewardType: 'percentage', rewardValue: '' }];
  }

  removeBonusRule(index: number) {
    this.bonusRules = this.bonusRules.filter((_, i) => i !== index);
  }

  addStampCard() {
    if (this.stampCards.length >= 10) {
      this.error = 'A maximum of 10 stamp card programs is supported.';
      return;
    }
    this.stampCards = [
      ...this.stampCards,
      {
        code: '',
        name: '',
        active: false,
        stampsRequired: 10,
        rewardPointsOnCompletion: 0,
        minimumBillRupees: '',
        service: true,
        product: false,
        package: false,
        membership: false,
      },
    ];
  }

  removeStampCard(index: number) {
    this.stampCards = this.stampCards.filter((_, i) => i !== index);
  }

  async save() {
    this.error = '';
    this.message = '';
    const rewardValuePaise = Math.round(Number(this.rewardValueRupees || 0) * 100);
    const rewardPoints = Math.max(0, Math.round(Number(this.rewardPoints || 0)));
    const minimumRedemptionPoints = Math.max(0, Math.round(Number(this.minimumRedemptionPoints || 0)));
    if (rewardPoints > 0 && rewardValuePaise <= 0) {
      this.error = 'Reward value must be greater than zero when reward points are set.';
      return;
    }
    for (const rule of this.bonusRules) {
      const value = Math.round(Number(rule.rewardValue || 0));
      if (value < 0 || (rule.rewardType === 'percentage' && value > 1000)) {
        this.error = 'Bonus values must be positive; percentages cannot exceed 1000.';
        return;
      }
    }
    const stampCodes = new Set<string>();
    for (const card of this.stampCards) {
      const code = card.code.trim().toLowerCase();
      if (card.active && !code) {
        this.error = 'An active stamp card needs a code.';
        return;
      }
      if (code && stampCodes.has(code)) {
        this.error = 'Stamp card codes must be unique.';
        return;
      }
      if (code) stampCodes.add(code);
      if (card.active && Math.round(Number(card.stampsRequired || 0)) < 1) {
        this.error = 'Stamps required must be at least 1 for an active stamp card.';
        return;
      }
    }
    this.saving = true;
    try {
      const payload: MembershipSettingsPayload = {
        ...this.settings,
        rewards: {
          allowNonMembers: this.allowNonMembers,
          enableForProducts: this.enableForProducts,
          enableForPackages: this.enableForPackages,
          enableForMemberships: this.enableForMemberships,
          enableForServices: this.enableForServices,
          rewardValuePaise: Math.max(0, rewardValuePaise),
          rewardPoints,
          minimumRedemptionPoints,
          bonusRules: this.bonusRules.map((rule) => ({
            minBillPaise: Math.max(0, Math.round(Number(rule.minBillRupees || 0) * 100)),
            rewardType: rule.rewardType,
            rewardValue: Math.max(0, Math.round(Number(rule.rewardValue || 0))),
          })),
        },
        stampCards: this.stampCards.map((card) => ({
          code: card.code.trim(),
          name: card.name.trim(),
          active: card.active,
          stampsRequired: Math.max(1, Math.round(Number(card.stampsRequired || 0))),
          rewardPointsOnCompletion: Math.max(0, Math.round(Number(card.rewardPointsOnCompletion || 0))),
          earnRule: {
            minimumBillPaise: Math.max(0, Math.round(Number(card.minimumBillRupees || 0) * 100)),
            eligibleLineTypes: {
              service: card.service,
              product: card.product,
              package: card.package,
              membership: card.membership,
            },
          },
        })),
      };
      const result = await firstValueFrom(
        this.api.patch<ApiEnvelope<MembershipSettingsPayload>>('/membership-enterprise/settings', payload),
      );
      if (result.success && result.data) {
        this.applySettings(result.data);
        this.message = 'Reward settings saved.';
      } else {
        this.error = 'Failed to save reward settings.';
      }
    } catch (err: any) {
      this.error = err?.error?.error?.message || 'Failed to save reward settings.';
    } finally {
      this.saving = false;
    }
  }

  private async loadSettings() {
    this.loading = true;
    this.error = '';
    try {
      const result = await firstValueFrom(
        this.api.get<ApiEnvelope<MembershipSettingsPayload>>('/membership-enterprise/settings'),
      );
      if (result.success && result.data) {
        this.applySettings(result.data);
      } else {
        this.error = 'Failed to load reward settings.';
      }
    } catch {
      this.error = 'Failed to load reward settings.';
    } finally {
      this.loading = false;
    }
  }

  private applySettings(settings: MembershipSettingsPayload) {
    this.settings = settings;
    this.stampCards = (settings.stampCards || [])
      // Skip the blank inactive template the backend ships as the default.
      .filter((card) => (card.code || '').trim().length > 0)
      .map((card) => ({
        code: card.code || '',
        name: card.name || '',
        active: !!card.active,
        stampsRequired: Number(card.stampsRequired) || 10,
        rewardPointsOnCompletion: Number(card.rewardPointsOnCompletion) || 0,
        minimumBillRupees: (Number(card.earnRule?.minimumBillPaise) || 0) / 100,
        service: !!card.earnRule?.eligibleLineTypes?.service,
        product: !!card.earnRule?.eligibleLineTypes?.product,
        package: !!card.earnRule?.eligibleLineTypes?.package,
        membership: !!card.earnRule?.eligibleLineTypes?.membership,
      }));
    const rewards = settings.rewards;
    if (!rewards) return;
    this.allowNonMembers = !!rewards.allowNonMembers;
    this.enableForProducts = !!rewards.enableForProducts;
    this.enableForPackages = !!rewards.enableForPackages;
    this.enableForMemberships = !!rewards.enableForMemberships;
    this.enableForServices = !!rewards.enableForServices;
    this.rewardValueRupees = (Number(rewards.rewardValuePaise) || 0) / 100;
    this.rewardPoints = Number(rewards.rewardPoints) || 0;
    this.minimumRedemptionPoints = Number(rewards.minimumRedemptionPoints) || 0;
    this.bonusRules = (rewards.bonusRules || [])
      .filter((rule) => Number(rule.rewardValue) > 0 || Number(rule.minBillPaise) > 0)
      .map((rule) => ({
        minBillRupees: (Number(rule.minBillPaise) || 0) / 100,
        rewardType: rule.rewardType === 'flat' ? 'flat' : 'percentage',
        rewardValue: Number(rule.rewardValue) || 0,
      }));
  }
}
