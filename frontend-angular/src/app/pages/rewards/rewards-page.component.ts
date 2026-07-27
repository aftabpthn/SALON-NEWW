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

type MembershipSettingsPayload = Record<string, unknown> & { rewards?: RewardsSettings };

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
