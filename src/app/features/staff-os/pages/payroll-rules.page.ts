import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DEFAULT_STAFF_PAYROLL_RULES, normalizeStaffPayrollRules, readStaffPayrollRules, STAFF_PAYROLL_RULES_KEY, type StaffPayrollRules, validateStaffPayrollRules } from './payroll-rules.store';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="rules-page">
      <header class="topbar">
        <div>
          <span>Staff OS / Payroll</span>
          <h1>Payroll Rules</h1>
          <p>Set attendance, week off, shift, commission and advance deduction rules for Salary Generate.</p>
        </div>
        <div class="top-actions">
          <a routerLink="/staff-os/salary-workspace">Salary Setup</a>
          <a routerLink="/staff-os/salary-generate">Salary Generate</a>
          <button type="button" (click)="resetDefaults()">Reset</button>
          <button type="button" (click)="save()">Save Rules</button>
        </div>
      </header>

      <p class="msg" *ngIf="message()">{{ message() }}</p>
      <p class="msg err" *ngIf="error()">{{ error() }}</p>

      <section class="grid">
        <article>
          <h2>Week Off & Attendance</h2>
          <label><span>Default week off day</span>
            <select [(ngModel)]="rules.weekOffDay">
              <option [ngValue]="1">Monday</option><option [ngValue]="2">Tuesday</option><option [ngValue]="3">Wednesday</option><option [ngValue]="4">Thursday</option><option [ngValue]="5">Friday</option><option [ngValue]="6">Saturday</option><option [ngValue]="0">Sunday</option>
            </select>
          </label>
          <label class="check"><input type="checkbox" [(ngModel)]="rules.paidWeekOff" /> Paid week off enabled</label>
          <label><span>Default shift hours</span><input type="number" min="1" step="0.5" [(ngModel)]="rules.defaultShiftHours" /></label>
          <label><span>Week off worked payout</span>
            <select [(ngModel)]="rules.weekOffWorkedMultiplier">
              <option [ngValue]="0">No extra pay</option><option [ngValue]="1">1x per day</option><option [ngValue]="1.5">1.5x per day</option><option [ngValue]="2">2x per day</option>
            </select>
          </label>
        </article>

        <article>
          <h2>Weekend Penalty</h2>
          <label class="check"><input type="checkbox" [(ngModel)]="rules.weekendPenalty" /> Friday/Saturday/Sunday penalty enabled</label>
          <label><span>Friday leave deduction days</span><input type="number" min="1" step="0.5" [(ngModel)]="rules.fridayPenaltyDays" /></label>
          <label><span>Saturday leave deduction days</span><input type="number" min="1" step="0.5" [(ngModel)]="rules.saturdayPenaltyDays" /></label>
          <label><span>Sunday leave deduction days</span><input type="number" min="1" step="0.5" [(ngModel)]="rules.sundayPenaltyDays" /></label>
          <label class="check"><input type="checkbox" [(ngModel)]="rules.sandwichRule" /> Adjacent week off unpaid when leave touches week off</label>
        </article>

        <article>
          <h2>Commission Rules</h2>
          <label><span>Service commission %</span><input type="number" min="0" step="0.5" [(ngModel)]="rules.serviceCommissionPct" /></label>
          <label><span>Product commission %</span><input type="number" min="0" step="0.5" [(ngModel)]="rules.productCommissionPct" /></label>
          <label><span>Membership commission %</span><input type="number" min="0" step="0.5" [(ngModel)]="rules.membershipCommissionPct" /></label>
        </article>

        <article>
          <h2>Advance Deduction</h2>
          <label class="check"><input type="checkbox" [(ngModel)]="rules.advanceSalaryCap" /> Advance deduction cannot exceed salary</label>
          <div class="example">
            <strong>Example</strong>
            <span>Advance ₹12,000, salary ₹5,000: deduct ₹5,000, balance ₹7,000 carry forward.</span>
          </div>
        </article>
      </section>
    </section>
  `,
  styles: [`
    .rules-page { display: grid; gap: 16px; color: #122033; }
    .topbar, article { background: #fff; border: 1px solid #d8e4ea; border-radius: 8px; box-shadow: 0 16px 34px rgba(15,23,42,.06); }
    .topbar { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 22px 24px; }
    .topbar span { color: #0f8f79; font-size: 12px; font-weight: 900; text-transform: uppercase; } h1 { margin: 4px 0 6px; font-size: 32px; } h2 { margin: 0 0 14px; font-size: 18px; } p { margin: 0; color: #607086; }
    .top-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    button, .top-actions a { min-height: 40px; border: 1px solid #0f8f79; border-radius: 6px; padding: 0 14px; background: #0f8f79; color: #fff; font-weight: 900; display: inline-flex; align-items: center; text-decoration: none; }
    .top-actions button:first-of-type { background: #fff; color: #0f8f79; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px; } article { padding: 16px; display: grid; gap: 12px; }
    label { display: grid; gap: 6px; font-weight: 900; color: #31445c; } label span { font-size: 12px; text-transform: uppercase; } input, select { min-height: 40px; border: 1px solid #b7c5cf; border-radius: 6px; padding: 0 10px; font: inherit; }
    .check { display: flex; align-items: center; gap: 9px; } .check input { min-height: auto; }
    .msg { padding: 10px 14px; border-radius: 8px; background: #dcfce7; color: #166534; font-weight: 900; }
    .msg.err { background: #fee2e2; color: #991b1b; }
    .example { display: grid; gap: 5px; padding: 12px; border-radius: 8px; background: #f6faf9; color: #31445c; }
    @media (max-width: 900px) { .topbar, .grid { grid-template-columns: 1fr; display: grid; } }
  `]
})
export class PayrollRulesPage {
  readonly message = signal('');
  readonly error = signal('');
  readonly rules: StaffPayrollRules = readStaffPayrollRules();

  save(): void {
    this.message.set('');
    this.error.set('');
    const normalized = normalizeStaffPayrollRules(this.rules);
    const errors = validateStaffPayrollRules(normalized);
    if (errors.length) {
      this.error.set(errors.join(' '));
      return;
    }
    Object.assign(this.rules, normalized);
    try {
      localStorage.setItem(STAFF_PAYROLL_RULES_KEY, JSON.stringify(normalized));
      this.message.set('Payroll rules saved. Salary Generate page ab ye rules use karega.');
    } catch {
      this.error.set('Payroll rules were not saved. Browser storage is unavailable.');
    }
  }

  resetDefaults(): void {
    Object.assign(this.rules, DEFAULT_STAFF_PAYROLL_RULES);
    this.message.set('Default payroll rules loaded. Save to apply them in Salary Generate.');
    this.error.set('');
  }
}
