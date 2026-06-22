import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';

export type DiscountRuleStatus = 'draft' | 'pending_approval' | 'active' | 'paused' | 'expired';
export type DiscountRuleOperator = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'between';
export type DiscountRuleActionType = 'percent' | 'flat' | 'bundle_price';

export interface DiscountRuleCondition extends ApiRecord {
  field: string;
  operator: DiscountRuleOperator | string;
  value: unknown;
}

export interface DiscountRuleAction extends ApiRecord {
  type: DiscountRuleActionType | string;
  value: number;
  maxDiscountPaise?: number;
  applyTo?: string;
  targetIds?: string[];
}

export interface DiscountRule extends ApiRecord {
  id: number;
  name: string;
  description?: string;
  conditions?: string | DiscountRuleCondition[];
  conditionsJson?: DiscountRuleCondition[];
  conditionLogic?: 'AND' | 'OR';
  action?: string | DiscountRuleAction;
  actionJson?: DiscountRuleAction;
  priority?: number;
  stackable?: boolean | number;
  status?: DiscountRuleStatus;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface DiscountRulesListResult {
  rows: DiscountRule[];
  limit?: number;
  offset?: number;
}

export interface DiscountRuleEvaluation extends ApiRecord {
  context?: ApiRecord;
  appliedRules: number[];
  totalDiscountPaise: number;
  breakdown: ApiRecord[];
}

export interface DiscountRulePayload extends ApiRecord {
  name: string;
  description?: string;
  conditions: DiscountRuleCondition[];
  conditionLogic: 'AND' | 'OR';
  action: DiscountRuleAction;
  priority: number;
  stackable: boolean;
  status: DiscountRuleStatus;
  validFrom?: string | null;
  validTo?: string | null;
}

@Injectable({ providedIn: 'root' })
export class DiscountRulesService {
  private readonly resource = 'discount-rules';

  constructor(private readonly api: ApiService) {}

  list(params: ApiRecord = {}): Observable<DiscountRulesListResult> {
    return this.api.list<DiscountRulesListResult>(this.resource, params);
  }

  get(id: number | string): Observable<DiscountRule> {
    return this.api.get<DiscountRule>(this.resource, String(id));
  }

  create(payload: DiscountRulePayload): Observable<DiscountRule> {
    return this.api.create<DiscountRule>(this.resource, payload);
  }

  update(id: number | string, payload: DiscountRulePayload): Observable<DiscountRule> {
    return this.api.update<DiscountRule>(this.resource, String(id), payload);
  }

  delete(id: number | string): Observable<ApiRecord> {
    return this.api.delete<ApiRecord>(this.resource, String(id));
  }

  status(id: number | string, status: DiscountRuleStatus): Observable<ApiRecord> {
    return this.api.patch<ApiRecord>(`${this.resource}/${id}/status`, { status });
  }

  evaluate(context: ApiRecord): Observable<DiscountRuleEvaluation> {
    return this.api.post<DiscountRuleEvaluation>(`${this.resource}/evaluate`, context);
  }
}
