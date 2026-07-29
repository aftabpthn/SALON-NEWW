
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, ApiService } from '../../shared/services/api.service';

type Summary = { totalMessages: number; inboundMessages: number; outboundMessages: number; deliveredMessages: number; failedMessages: number; threadCount: number };
type Row = Record<string, any>;

@Component({
    selector: 'page-whatsapp-automation',
    imports: [FormsModule],
    templateUrl: './whatsapp-automation-page.component.html',
    styleUrls: ['./whatsapp-automation-page.component.css']
})
export class WhatsAppAutomationPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  summary: Summary = { totalMessages: 0, inboundMessages: 0, outboundMessages: 0, deliveredMessages: 0, failedMessages: 0, threadCount: 0 };
  threads: Row[] = [];
  messages: Row[] = [];
  rules: Row[] = [];
  handoffs: Row[] = [];
  templates: Row[] = [];
  tab = 'overview';
  selectedClientId = '';
  loading = false;
  busy = false;
  error = '';
  handoffReason = '';
  templateName = '';
  templateBody = '';

  ngOnInit(): void { void this.reload(); }

  async reload(): Promise<void> {
    this.loading = true; this.error = '';
    try {
      const results = await Promise.all([
        firstValueFrom(this.api.get<ApiEnvelope<Summary>>('/whatsapp/summary')),
        firstValueFrom(this.api.get<ApiEnvelope<Row[]>>('/whatsapp/threads')),
        firstValueFrom(this.api.get<ApiEnvelope<Row[]>>('/whatsapp/messages')),
        firstValueFrom(this.api.get<ApiEnvelope<Row[]>>('/whatsapp/rules')),
        firstValueFrom(this.api.get<ApiEnvelope<Row[]>>('/whatsapp/handoffs')),
        firstValueFrom(this.api.get<ApiEnvelope<Row[]>>('/message-templates?channel=whatsapp')),
      ]);
      this.summary = results[0].data ?? this.summary;
      this.threads = results[1].data ?? [];
      this.messages = results[2].data ?? [];
      this.rules = results[3].data ?? [];
      this.handoffs = results[4].data ?? [];
      this.templates = results[5].data ?? [];
      if (!this.selectedClientId) this.selectedClientId = this.threads[0]?.clientId ?? '';
    } catch (error: any) { this.error = error?.error?.error?.message || error?.error?.message || 'WhatsApp automation data could not be loaded'; }
    finally { this.loading = false; }
  }

  get selectedMessages(): Row[] { return this.messages.filter((row) => row.clientId === this.selectedClientId).slice().reverse(); }
  selectThread(row: Row): void { this.selectedClientId = row.clientId; this.tab = 'inbox'; }
  async createHandoff(): Promise<void> {
    if (!this.selectedClientId || !this.handoffReason.trim()) return;
    await this.mutate('/whatsapp/handoffs', { threadId: this.selectedClientId, clientId: this.selectedClientId, reason: this.handoffReason.trim(), priority: 'normal' });
    this.handoffReason = '';
  }
  async createTemplate(): Promise<void> {
    if (!this.templateName.trim() || !this.templateBody.trim()) return;
    await this.mutate('/message-templates', { templateKey: this.templateName.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: this.templateName.trim(), channel: 'whatsapp', audience: 'client', eventKey: 'custom', body: this.templateBody.trim() });
    this.templateName = ''; this.templateBody = '';
  }
  formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
  label(value: string): string { return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

  private async mutate(path: string, body: unknown): Promise<void> {
    this.busy = true; this.error = '';
    try { await firstValueFrom(this.api.post(path, body)); await this.reload(); }
    catch (error: any) { this.error = error?.error?.error?.message || error?.error?.message || 'WhatsApp action could not be completed'; }
    finally { this.busy = false; }
  }
}
