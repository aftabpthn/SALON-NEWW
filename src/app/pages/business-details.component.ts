import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';

type BusinessNotificationProfile = {
  branchId?: string;
  businessName?: string;
  logoUrl?: string;
  adminEmail?: string;
  reportingEmails?: string[];
  ownerEmails?: string[];
  ownerMobiles?: string[];
  clientChannels?: string[];
  ownerChannels?: string[];
  mobileNumber?: string;
  telephoneNumber?: string;
  appointmentNumber?: string;
  address?: string;
  country?: string;
  state?: string;
  city?: string;
  postalCode?: string;
  aboutUs?: string;
  socialLinks?: Record<string, unknown>;
  businessHours?: Record<string, BusinessHour>;
  providerMode?: string;
  invoiceClientEnabled?: boolean;
  invoiceOwnerEnabled?: boolean;
};

type BusinessHour = {
  open: boolean;
  opensAt: string;
  closesAt: string;
  note?: string;
};

type TimeOption = {
  value: string;
  label: string;
};

type BusinessMediaUploadResponse = {
  url: string;
  kind: 'cover' | 'gallery';
  mimeType: string;
  sizeBytes: number;
};

type ContactListKey = 'reportingEmails' | 'ownerEmails' | 'ownerMobiles';

@Component({
  selector: 'app-business-details',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="module-hero">
      <div>
        <p class="eyebrow">Business details</p>
        <h2>SMS routing and business profile</h2>
        <p>Salon identity, owner mobile, provider mode and delivery channels control client, staff and owner SMS.</p>
      </div>
      <div class="hero-actions">
        <a class="ghost-button link-button" routerLink="/clients">Client page</a>
        <a class="ghost-button link-button" routerLink="/staff">Staff page</a>
        <button class="ghost-button" type="button" (click)="load()" [disabled]="loading()">Refresh</button>
        <button class="primary-button" type="button" (click)="save()" [disabled]="saving()">Save business details</button>
      </div>
    </section>

    <p *ngIf="error()" class="alert error">{{ error() }}</p>
    <p *ngIf="saved()" class="alert success">Saved. SMS routing is ready for appointment client/staff/owner queues and invoice client/owner queues.</p>

    <section class="sms-command-grid">
      <article class="sms-route-card client">
        <span class="route-kicker">Client SMS</span>
        <h3>Client profile phone</h3>
        <p>Appointment confirmations use the mobile number saved on the client profile.</p>
        <div class="route-status">
          <strong [class.ready]="clientSmsReady()">{{ clientSmsReady() ? 'SMS enabled' : 'SMS off' }}</strong>
          <small>{{ channelList(form.clientChannels) }}</small>
        </div>
        <a routerLink="/clients">Open client page</a>
      </article>

      <article class="sms-route-card staff">
        <span class="route-kicker">Staff SMS</span>
        <h3>Staff profile phone</h3>
        <p>Staff reminders use the mobile number saved on the staff profile.</p>
        <div class="route-status">
          <strong class="ready">Connected</strong>
          <small>Uses saved staff records</small>
        </div>
        <a routerLink="/staff">Open staff page</a>
      </article>

      <article class="sms-route-card owner">
        <span class="route-kicker">Owner SMS</span>
        <h3>Owner mobile routing</h3>
        <p>Owner booking alerts and invoice alerts will queue to the saved owner mobile numbers below.</p>
        <div class="route-status">
          <strong [class.ready]="ownerSmsReady()">{{ ownerSmsReady() ? ownerMobileCount() + ' mobile(s)' : 'Add owner mobile' }}</strong>
          <small>{{ channelList(form.ownerChannels) }}</small>
        </div>
        <a routerLink="/business-details">Stay on settings</a>
      </article>

      <article class="sms-route-card logs">
        <span class="route-kicker">Delivery queue</span>
        <h3>Message logs</h3>
        <p>Queued SMS rows are stored in real message logs with recipient, branch, client and appointment payload.</p>
        <div class="route-status">
          <strong class="ready">{{ providerLabel() }}</strong>
          <small>Outbound SMS queue</small>
        </div>
        <a routerLink="/message-logs">Open message logs</a>
      </article>
    </section>

    <section class="settings-grid">
      <article class="panel">
        <p class="eyebrow">Salon identity</p>
        <h3>Business info</h3>
        <div class="form-grid two">
          <label>
            Business name
            <input [(ngModel)]="form.businessName" placeholder="Aura Salon" />
          </label>
          <label>
            Logo URL
            <input [(ngModel)]="form.logoUrl" placeholder="https://..." />
          </label>
          <label>
            Admin email
            <input type="email" inputmode="email" autocomplete="email" [(ngModel)]="form.adminEmail" placeholder="owner@salon.com" />
          </label>
          <label>
            Appointment number
            <input type="tel" inputmode="tel" autocomplete="tel" [(ngModel)]="form.appointmentNumber" placeholder="+91..." />
          </label>
          <label>
            Mobile number
            <input type="tel" inputmode="tel" autocomplete="tel" [(ngModel)]="form.mobileNumber" placeholder="+91..." />
          </label>
          <label>
            Telephone number
            <input type="tel" inputmode="tel" autocomplete="tel" [(ngModel)]="form.telephoneNumber" placeholder="080..." />
          </label>
        </div>
        <label>
          Address
          <textarea rows="3" [(ngModel)]="form.address" placeholder="Full branch/salon address"></textarea>
        </label>
        <div class="form-grid three">
          <label>
            Country
            <input [(ngModel)]="form.country" />
          </label>
          <label>
            State
            <input [(ngModel)]="form.state" />
          </label>
          <label>
            City
            <input [(ngModel)]="form.city" />
          </label>
          <label>
            Postal code
            <input [(ngModel)]="form.postalCode" />
          </label>
        </div>
        <label>
          About us
          <textarea rows="4" [(ngModel)]="form.aboutUs" placeholder="Short salon description"></textarea>
        </label>

        <div class="public-profile-grid">
          <div class="media-upload-card">
            <div class="media-upload-header">
              <div>
                <strong>Cover photo</strong>
                <span>JPG, JPEG, PNG and common photo files</span>
              </div>
              <input #coverPhotoInput type="file" [accept]="imageAccept" (change)="uploadCoverPhoto($event)" hidden />
              <button class="ghost-button compact" type="button" (click)="coverPhotoInput.click()" [disabled]="coverUploading()">
                {{ coverUploading() ? 'Uploading...' : 'Upload cover' }}
              </button>
            </div>
            <img *ngIf="coverImageText" class="cover-preview" [src]="coverImageText" alt="Business cover preview" />
            <button *ngIf="coverImageText" class="ghost-button compact remove-media-button" type="button" (click)="clearCoverPhoto()">Remove cover</button>
          </div>
          <label>
            Website URL
            <input [(ngModel)]="websiteUrl" placeholder="https://your-salon.com" />
          </label>
          <label>
            Instagram URL
            <input [(ngModel)]="instagramUrl" placeholder="https://instagram.com/..." />
          </label>
          <label>
            Google Maps / directions URL
            <input [(ngModel)]="mapsUrl" placeholder="https://maps.google.com/..." />
          </label>
        </div>

        <div class="gallery-upload-card">
          <div class="media-upload-header">
            <div>
              <strong>Gallery photos</strong>
              <span>Upload from gallery or file manager</span>
            </div>
            <input #galleryPhotoInput type="file" [accept]="imageAccept" multiple (change)="uploadGalleryPhotos($event)" hidden />
            <button class="ghost-button compact" type="button" (click)="galleryPhotoInput.click()" [disabled]="galleryUploading()">
              {{ galleryUploading() ? 'Uploading...' : 'Add photos' }}
            </button>
          </div>
          <div *ngIf="galleryImageList().length" class="gallery-preview-grid">
            <div *ngFor="let image of galleryImageList()" class="gallery-preview-tile">
              <img [src]="image" alt="Business gallery preview" loading="lazy" />
              <button class="remove-media-button" type="button" (click)="removeGalleryImage(image)">Remove</button>
            </div>
          </div>
        </div>

        <div class="hours-editor">
          <div class="hours-copy">
            <p class="eyebrow">Customer app timings</p>
            <h3>Business Hours</h3>
            <p>Specify your opening closing time for your business.</p>
            <label class="switch-row">
              <span>Show/Hide Business Hours</span>
              <input class="switch-input" type="checkbox" [(ngModel)]="showBusinessHours" />
              <span class="switch-track" aria-hidden="true"></span>
            </label>
          </div>

          <div class="hours-table-wrap">
            <table class="hours-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Start Time</th>
                  <th>End Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let day of businessHourDays">
                  <td>{{ day.label }}</td>
                  <td>
                    <select [ngModel]="businessHours[day.key].opensAt" (ngModelChange)="setBusinessHourTime(day.key, 'opensAt', $event)" [disabled]="!businessHours[day.key].open">
                      <option *ngFor="let option of timeOptions" [value]="option.value">{{ option.label }}</option>
                    </select>
                  </td>
                  <td>
                    <select [ngModel]="businessHours[day.key].closesAt" (ngModelChange)="setBusinessHourTime(day.key, 'closesAt', $event)" [disabled]="!businessHours[day.key].open">
                      <option *ngFor="let option of timeOptions" [value]="option.value">{{ option.label }}</option>
                    </select>
                  </td>
                  <td>
                    <select [ngModel]="businessHours[day.key].open ? 'open' : 'closed'" (ngModelChange)="setBusinessHourStatus(day.key, $event)">
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="hours-actions">
              <label class="apply-all-row">
                <input type="checkbox" [(ngModel)]="applyTimingsToAll" />
                <span>Automatically apply timings to all days</span>
              </label>
              <button class="ghost-button compact" type="button" (click)="copyMondayToWeek()">Apply Monday to all</button>
            </div>
          </div>
        </div>
      </article>

      <article class="panel owner-routing-panel">
        <div class="panel-title-row">
          <div>
            <p class="eyebrow">Owners and reporting</p>
            <h3>Alert recipients</h3>
          </div>
          <span class="recipient-count">{{ contactList(reportingEmailsText).length + contactList(ownerEmailsText).length + contactList(ownerMobilesText).length }} saved</span>
        </div>

        <div class="owner-signal-grid">
          <div>
            <span>Owner mobiles</span>
            <strong>{{ contactList(ownerMobilesText).length }}</strong>
          </div>
          <div>
            <span>Owner emails</span>
            <strong>{{ contactList(ownerEmailsText).length }}</strong>
          </div>
          <div>
            <span>Reports</span>
            <strong>{{ contactList(reportingEmailsText).length }}</strong>
          </div>
        </div>

        <div class="toggle-panel route-toggle-panel">
          <label class="check-card">
            <input type="checkbox" [(ngModel)]="form.invoiceClientEnabled" />
            <span class="checkmark" aria-hidden="true"></span>
            <span>
              <strong>Client invoice close</strong>
              <small>Send invoice alert to selected client channels</small>
            </span>
          </label>
          <label class="check-card">
            <input type="checkbox" [(ngModel)]="form.invoiceOwnerEnabled" />
            <span class="checkmark" aria-hidden="true"></span>
            <span>
              <strong>Owner invoice close</strong>
              <small>Send summary to owners and reporting contacts</small>
            </span>
          </label>
        </div>

        <div class="contact-section">
          <label class="token-label" for="reportingEmailInput">
            Reporting email IDs
            <span>Paste comma, semicolon, space or newline separated emails.</span>
          </label>
          <div class="token-editor" [class.has-error]="invalidEmailChips(reportingEmailsText).length">
            <span *ngFor="let email of contactList(reportingEmailsText)" class="contact-chip" [class.invalid]="!isEmailTokenValid(email)">
              {{ email }}
              <button type="button" (click)="removeContactToken('reportingEmails', email)" aria-label="Remove reporting email">x</button>
            </span>
            <input
              id="reportingEmailInput"
              type="text"
              inputmode="email"
              autocomplete="email"
              [(ngModel)]="reportingEmailDraft"
              (keydown)="handleContactKeydown($event, 'reportingEmails')"
              (paste)="handleContactPaste($event, 'reportingEmails')"
              (blur)="commitContactDraft('reportingEmails')"
              placeholder="reporting@salon.com"
            />
          </div>
          <small class="input-hint">Supports common international email formats, plus aliases and Unicode domains.</small>
        </div>

        <div class="contact-section">
          <label class="token-label" for="ownerEmailInput">
            Owner email IDs
            <span>Each email becomes a separate recipient box.</span>
          </label>
          <div class="token-editor" [class.has-error]="invalidEmailChips(ownerEmailsText).length">
            <span *ngFor="let email of contactList(ownerEmailsText)" class="contact-chip" [class.invalid]="!isEmailTokenValid(email)">
              {{ email }}
              <button type="button" (click)="removeContactToken('ownerEmails', email)" aria-label="Remove owner email">x</button>
            </span>
            <input
              id="ownerEmailInput"
              type="text"
              inputmode="email"
              autocomplete="email"
              [(ngModel)]="ownerEmailDraft"
              (keydown)="handleContactKeydown($event, 'ownerEmails')"
              (paste)="handleContactPaste($event, 'ownerEmails')"
              (blur)="commitContactDraft('ownerEmails')"
              placeholder="owner@salon.com"
            />
          </div>
          <small class="input-hint">Example: owner+branch@salon.co.in or unicode-name@idn.example</small>
        </div>

        <div class="contact-section">
          <label class="token-label" for="ownerMobileInput">
            Owner mobile numbers
            <span>Choose country code for local numbers, or paste full international numbers.</span>
          </label>
          <div class="phone-entry-row">
            <select [(ngModel)]="ownerMobileCountryCode" aria-label="Owner mobile country code">
              <option *ngFor="let country of countryDialCodes" [value]="country.code">{{ country.label }} {{ country.code }}</option>
            </select>
            <input
              id="ownerMobileInput"
              type="tel"
              inputmode="tel"
              autocomplete="tel"
              [(ngModel)]="ownerMobileDraft"
              (keydown)="handleContactKeydown($event, 'ownerMobiles')"
              (paste)="handleContactPaste($event, 'ownerMobiles')"
              (blur)="commitContactDraft('ownerMobiles')"
              placeholder="90000 00000"
            />
            <button class="ghost-button compact" type="button" (click)="commitContactDraft('ownerMobiles')">Add</button>
          </div>
          <div class="token-editor phone-chip-editor" [class.has-error]="invalidPhoneChips().length">
            <span *ngFor="let phone of contactList(ownerMobilesText)" class="contact-chip phone" [class.invalid]="!isPhoneTokenValid(phone)">
              {{ phone }}
              <button type="button" (click)="removeContactToken('ownerMobiles', phone)" aria-label="Remove owner mobile">x</button>
            </span>
            <span *ngIf="!contactList(ownerMobilesText).length" class="empty-token">No owner mobile added</span>
          </div>
          <small class="input-hint">Numbers are saved in international format. Length is checked using the selected or pasted country code.</small>
        </div>

        <div class="channel-grid improved-channel-grid">
          <div>
            <strong>Client channels</strong>
            <label class="check-card mini"><input type="checkbox" [checked]="hasChannel('client', 'whatsapp')" (change)="toggleChannel('client', 'whatsapp')" /><span class="checkmark" aria-hidden="true"></span><span>WhatsApp</span></label>
            <label class="check-card mini"><input type="checkbox" [checked]="hasChannel('client', 'sms')" (change)="toggleChannel('client', 'sms')" /><span class="checkmark" aria-hidden="true"></span><span>SMS</span></label>
            <label class="check-card mini"><input type="checkbox" [checked]="hasChannel('client', 'email')" (change)="toggleChannel('client', 'email')" /><span class="checkmark" aria-hidden="true"></span><span>Email</span></label>
          </div>
          <div>
            <strong>Owner channels</strong>
            <label class="check-card mini"><input type="checkbox" [checked]="hasChannel('owner', 'email')" (change)="toggleChannel('owner', 'email')" /><span class="checkmark" aria-hidden="true"></span><span>Email</span></label>
            <label class="check-card mini"><input type="checkbox" [checked]="hasChannel('owner', 'sms')" (change)="toggleChannel('owner', 'sms')" /><span class="checkmark" aria-hidden="true"></span><span>SMS</span></label>
            <label class="check-card mini"><input type="checkbox" [checked]="hasChannel('owner', 'whatsapp')" (change)="toggleChannel('owner', 'whatsapp')" /><span class="checkmark" aria-hidden="true"></span><span>WhatsApp</span></label>
          </div>
        </div>

        <label>
          Provider mode
          <select [(ngModel)]="form.providerMode">
            <option value="queued">Queued / manual send</option>
            <option value="draft">Draft only</option>
            <option value="provider-ready">Provider ready</option>
          </select>
        </label>
      </article>

      <article class="panel full">
        <p class="eyebrow">Preview</p>
        <h3>What will happen after Save sale and invoice?</h3>
        <div class="preview-grid">
          <div>
            <strong>Client receives</strong>
            <p>Invoice number, total, paid, due, salon contact and thank-you message.</p>
          </div>
          <div>
            <strong>Staff receives</strong>
            <p>Appointment time, client name, service list and chair/room handoff from the live booking drawer.</p>
          </div>
          <div>
            <strong>Owners receive</strong>
            <p>Invoice closed alert with client, branch, total, paid, due and invoice document id.</p>
          </div>
          <div>
            <strong>Safety</strong>
            <p>Messages are queued per invoice, channel and recipient. Existing sent rows are not overwritten.</p>
          </div>
        </div>
      </article>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .module-hero, .panel, .sms-route-card {
      background: #fff;
      border: 1px solid #d9e3e1;
      border-radius: 8px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.06);
    }
    .module-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding: 24px;
      margin-bottom: 24px;
      background:
        linear-gradient(135deg, rgba(15, 127, 115, 0.08), rgba(37, 99, 235, 0.04) 46%, rgba(245, 158, 11, 0.06)),
        #fff;
    }
    .module-hero h2, .panel h3 { margin: 4px 0 8px; color: #071524; }
    .module-hero p, .panel p { color: #516075; }
    .eyebrow {
      margin: 0;
      color: #587089;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .02em;
      text-transform: uppercase;
    }
    .hero-actions { display: flex; gap: 12px; flex-wrap: wrap; }
    .link-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
    }
    .sms-command-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }
    .sms-route-card {
      display: grid;
      gap: 12px;
      padding: 18px;
      min-height: 220px;
      border-top: 4px solid #0f7f73;
    }
    .sms-route-card.client { border-top-color: #2563eb; }
    .sms-route-card.staff { border-top-color: #0f7f73; }
    .sms-route-card.owner { border-top-color: #b45309; }
    .sms-route-card.logs { border-top-color: #be185d; }
    .sms-route-card h3 {
      margin: 0;
      color: #071524;
      font-size: 19px;
    }
    .sms-route-card p {
      margin: 0;
      color: #516075;
      line-height: 1.5;
    }
    .sms-route-card a {
      align-self: end;
      width: fit-content;
      border: 1px solid #d6dfdd;
      border-radius: 999px;
      padding: 9px 13px;
      color: #0f5f56;
      font-weight: 800;
      text-decoration: none;
      background: #f7fffc;
    }
    .route-kicker {
      width: fit-content;
      border-radius: 999px;
      background: #eef6ff;
      color: #1d4ed8;
      padding: 5px 9px;
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .route-status {
      display: grid;
      gap: 2px;
      border-radius: 8px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 10px;
    }
    .route-status strong {
      color: #b42318;
    }
    .route-status strong.ready {
      color: #067647;
    }
    .route-status small {
      color: #64748b;
      font-weight: 700;
    }
    .settings-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 440px);
      gap: 24px;
    }
    .panel { padding: 24px; }
    .panel.full { grid-column: 1 / -1; }
    .form-grid { display: grid; gap: 14px; }
    .form-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .form-grid.three { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    label { display: grid; gap: 6px; margin: 14px 0; color: #40516a; font-weight: 700; }
    input, textarea, select {
      width: 100%;
      border: 1px solid #d6dfdd;
      border-radius: 8px;
      padding: 12px 14px;
      font: inherit;
      color: #071524;
      background: #fff;
    }
    textarea { resize: vertical; }
    .primary-button, .ghost-button {
      border: 1px solid #d6dfdd;
      border-radius: 8px;
      padding: 12px 18px;
      font-weight: 700;
      cursor: pointer;
    }
    .primary-button { background: #0f7f73; color: #fff; border-color: #0f7f73; }
    .ghost-button { background: #fff; color: #071524; }
    .alert { padding: 14px 18px; border-radius: 8px; margin-bottom: 18px; }
    .alert.error { background: #fff1f0; color: #b42318; border: 1px solid #ffc9c2; }
    .alert.success { background: #ecfdf3; color: #05603a; border: 1px solid #abefc6; }
    .toggle-panel {
      display: grid;
      gap: 8px;
      padding: 12px;
      border-radius: 8px;
      background: #f6faf9;
      border: 1px solid #d9e3e1;
    }
    .toggle-panel label, .channel-grid label { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
    .channel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 18px 0; }
    .channel-grid > div, .preview-grid > div {
      border: 1px solid #d9e3e1;
      border-radius: 8px;
      padding: 14px;
      background: #fbfdfc;
    }
    .owner-routing-panel {
      align-self: start;
      display: grid;
      gap: 16px;
      background:
        linear-gradient(180deg, rgba(15, 127, 115, 0.035), transparent 260px),
        #fff;
    }
    .panel-title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
    }
    .panel-title-row h3 {
      margin: 4px 0 0;
      font-size: 22px;
    }
    .recipient-count {
      flex: 0 0 auto;
      border: 1px solid #bfe5df;
      border-radius: 999px;
      padding: 6px 10px;
      background: #ecfdf9;
      color: #0f5f56;
      font-size: 12px;
      font-weight: 900;
    }
    .owner-signal-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .owner-signal-grid div {
      display: grid;
      gap: 3px;
      min-width: 0;
      border: 1px solid #d9e3e1;
      border-radius: 8px;
      padding: 10px;
      background: #fbfdfc;
    }
    .owner-signal-grid span {
      color: #64748b;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .owner-signal-grid strong {
      color: #071524;
      font-size: 22px;
      line-height: 1;
    }
    .route-toggle-panel {
      padding: 10px;
      background: #f8fbfb;
    }
    .check-card {
      position: relative;
      display: grid !important;
      grid-template-columns: 32px minmax(0, 1fr);
      gap: 10px !important;
      align-items: center !important;
      margin: 0 !important;
      border: 1px solid #d9e3e1;
      border-radius: 8px;
      padding: 10px;
      background: #fff;
      color: #071524;
      cursor: pointer;
    }
    .check-card input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
    .checkmark {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border: 1px solid #b7c7c4;
      border-radius: 7px;
      background: #fff;
      color: transparent;
      font-weight: 900;
    }
    .checkmark::after {
      content: "";
      width: 7px;
      height: 13px;
      border: solid currentColor;
      border-width: 0 3px 3px 0;
      transform: rotate(45deg) translate(-1px, -1px);
    }
    .check-card input:checked + .checkmark {
      border-color: #0f7f73;
      background: #0f7f73;
      color: #fff;
    }
    .check-card strong {
      display: block;
      color: #071524;
      line-height: 1.2;
    }
    .check-card small {
      display: block;
      margin-top: 3px;
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.35;
    }
    .contact-section {
      display: grid;
      gap: 8px;
    }
    .token-label {
      gap: 3px;
      margin: 0;
      color: #34445c;
    }
    .token-label span,
    .input-hint {
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.35;
    }
    .token-editor {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-height: 50px;
      border: 1px solid #cfdedb;
      border-radius: 8px;
      padding: 8px;
      background: #fff;
      box-shadow: inset 0 1px 0 rgba(15, 23, 42, 0.02);
    }
    .token-editor:focus-within {
      border-color: #0f7f73;
      box-shadow: 0 0 0 3px rgba(15, 127, 115, 0.12);
    }
    .token-editor.has-error {
      border-color: #f04438;
      box-shadow: 0 0 0 3px rgba(240, 68, 56, 0.08);
    }
    .token-editor input {
      flex: 1 1 180px;
      min-width: 140px;
      border: 0;
      border-radius: 0;
      padding: 7px 4px;
      background: transparent;
      box-shadow: none;
      outline: 0;
    }
    .contact-chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      max-width: 100%;
      border: 1px solid #bfe5df;
      border-radius: 999px;
      padding: 7px 8px 7px 11px;
      background: #ecfdf9;
      color: #0b4f48;
      font-size: 13px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .contact-chip.phone {
      background: #f7fbff;
      border-color: #bfd7ff;
      color: #1d4ed8;
    }
    .contact-chip.invalid {
      background: #fff1f0;
      border-color: #fecdca;
      color: #b42318;
    }
    .contact-chip button {
      display: grid;
      place-items: center;
      width: 20px;
      height: 20px;
      border: 0;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.09);
      color: inherit;
      font-size: 12px;
      font-weight: 900;
      cursor: pointer;
    }
    .phone-entry-row {
      display: grid;
      grid-template-columns: minmax(116px, 0.7fr) minmax(150px, 1fr) auto;
      gap: 8px;
      align-items: center;
    }
    .phone-entry-row select,
    .phone-entry-row input {
      margin: 0;
    }
    .phone-chip-editor {
      min-height: 44px;
    }
    .empty-token {
      color: #64748b;
      font-size: 13px;
      font-weight: 700;
    }
    .improved-channel-grid {
      margin: 0;
    }
    .improved-channel-grid > div {
      display: grid;
      gap: 8px;
    }
    .check-card.mini {
      grid-template-columns: 28px minmax(0, 1fr);
      padding: 8px;
      font-size: 14px;
    }
    .check-card.mini .checkmark {
      width: 24px;
      height: 24px;
      border-radius: 6px;
    }
    .public-profile-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .media-upload-card,
    .gallery-upload-card {
      border: 1px solid #d6dfdd;
      border-radius: 8px;
      padding: 14px;
      background: #fbfdfc;
    }
    .media-upload-card {
      grid-column: 1 / -1;
      display: grid;
      gap: 12px;
    }
    .gallery-upload-card {
      display: grid;
      gap: 12px;
      margin: 14px 0;
    }
    .media-upload-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }
    .media-upload-header div {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .media-upload-header strong {
      color: #071524;
      font-size: 15px;
    }
    .media-upload-header span {
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
    }
    .cover-preview {
      width: 100%;
      max-height: 260px;
      border-radius: 8px;
      object-fit: cover;
      border: 1px solid #d9e3e1;
      background: #eef4f3;
    }
    .gallery-preview-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 12px;
    }
    .gallery-preview-tile {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .gallery-preview-tile img {
      width: 100%;
      aspect-ratio: 4 / 3;
      border-radius: 8px;
      object-fit: cover;
      border: 1px solid #d9e3e1;
      background: #eef4f3;
    }
    .remove-media-button {
      justify-self: start;
      border: 1px solid #f5b7b1;
      border-radius: 8px;
      background: #fff8f7;
      color: #b42318;
      padding: 8px 10px;
      font-weight: 800;
      cursor: pointer;
    }
    .hours-editor {
      display: grid;
      grid-template-columns: minmax(220px, 0.36fr) minmax(520px, 1fr);
      gap: 28px;
      align-items: start;
      margin-top: 28px;
      border-top: 1px solid #d6dfdd;
      padding-top: 26px;
      background: #fff;
    }
    .hours-copy h3 {
      margin: 4px 0 6px;
      color: #071524;
      font-size: 22px;
      letter-spacing: 0;
    }
    .hours-copy p:not(.eyebrow) {
      margin: 0 0 22px;
      color: #071524;
    }
    .compact {
      padding: 8px 12px;
      min-height: 36px;
    }
    .switch-row {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 48px;
      gap: 14px;
      align-items: center;
      margin: 0;
      color: #071524;
      font-weight: 800;
    }
    .switch-input {
      position: absolute;
      right: 0;
      width: 48px;
      height: 26px;
      margin: 0;
      opacity: 0;
      cursor: pointer;
      z-index: 2;
    }
    .switch-track {
      position: relative;
      width: 48px;
      height: 26px;
      border-radius: 999px;
      background: #c7c9cc;
      transition: background .18s ease;
    }
    .switch-track::after {
      content: "";
      position: absolute;
      top: 4px;
      left: 4px;
      width: 18px;
      height: 18px;
      border-radius: 999px;
      background: #fff;
      box-shadow: 0 1px 3px rgba(15, 23, 42, .2);
      transition: transform .18s ease;
    }
    .switch-input:checked + .switch-track {
      background: #2f9bf0;
    }
    .switch-input:checked + .switch-track::after {
      transform: translateX(22px);
    }
    .hours-table-wrap {
      min-width: 0;
      overflow-x: auto;
    }
    .hours-table {
      width: 100%;
      min-width: 640px;
      border-collapse: collapse;
      color: #071524;
      background: #fff;
      font-size: 14px;
    }
    .hours-table th,
    .hours-table td {
      border: 1px solid #cfd4d7;
      padding: 6px 7px;
      text-align: left;
      vertical-align: middle;
    }
    .hours-table th {
      background: #ececec;
      color: #071524;
      font-weight: 800;
    }
    .hours-table td:first-child {
      padding-left: 20px;
      font-weight: 500;
    }
    .hours-table select {
      width: auto;
      min-width: 92px;
      height: 29px;
      border: 1px solid #d6dadd;
      border-radius: 7px;
      padding: 3px 8px;
      color: #1f2937;
      background: #fff;
      font: inherit;
    }
    .hours-table select:disabled {
      color: #8792a0;
      background: #f3f4f6;
    }
    .hours-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      justify-content: flex-end;
      flex-wrap: wrap;
      margin-top: 14px;
    }
    .apply-all-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 auto 0 0;
      color: #071524;
      font-weight: 800;
    }
    .apply-all-row input {
      width: 18px;
      height: 18px;
      margin: 0;
      accent-color: #2f9bf0;
    }
    .preview-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
    @media (max-width: 980px) {
      .settings-grid, .sms-command-grid, .form-grid.two, .form-grid.three, .preview-grid, .public-profile-grid, .hours-editor { grid-template-columns: 1fr; }
      .module-hero { align-items: flex-start; flex-direction: column; }
      .media-upload-header { align-items: flex-start; flex-direction: column; }
    }
    @media (min-width: 981px) and (max-width: 1280px) {
      .sms-command-grid, .preview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `]
})
export class BusinessDetailsComponent implements OnInit {
  loading = signal(false);
  saving = signal(false);
  coverUploading = signal(false);
  galleryUploading = signal(false);
  error = signal('');
  saved = signal(false);

  form: BusinessNotificationProfile = this.emptyForm();
  reportingEmailsText = '';
  ownerEmailsText = '';
  ownerMobilesText = '';
  reportingEmailDraft = '';
  ownerEmailDraft = '';
  ownerMobileDraft = '';
  ownerMobileCountryCode = '+91';
  coverImageText = '';
  galleryImagesText = '';
  websiteUrl = '';
  instagramUrl = '';
  mapsUrl = '';
  showBusinessHours = true;
  applyTimingsToAll = false;
  businessHours: Record<string, BusinessHour> = this.defaultBusinessHours();
  readonly imageAccept = 'image/jpeg,image/jpg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,image/bmp,image/tiff';
  private readonly maxImageBytes = 5 * 1024 * 1024;
  readonly countryDialCodes = [
    { code: '+91', label: 'India', min: 10, max: 10 },
    { code: '+1', label: 'US / Canada', min: 10, max: 10 },
    { code: '+44', label: 'UK', min: 9, max: 10 },
    { code: '+971', label: 'UAE', min: 8, max: 9 },
    { code: '+966', label: 'Saudi Arabia', min: 8, max: 9 },
    { code: '+65', label: 'Singapore', min: 8, max: 8 },
    { code: '+61', label: 'Australia', min: 9, max: 9 },
    { code: '+49', label: 'Germany', min: 5, max: 11 },
    { code: '+33', label: 'France', min: 9, max: 9 },
    { code: '+', label: 'Other', min: 6, max: 15 }
  ];
  readonly businessHourDays = [
    { key: 'sunday', label: 'Sunday' },
    { key: 'monday', label: 'Monday' },
    { key: 'tuesday', label: 'Tuesday' },
    { key: 'wednesday', label: 'Wednesday' },
    { key: 'thursday', label: 'Thursday' },
    { key: 'friday', label: 'Friday' },
    { key: 'saturday', label: 'Saturday' }
  ];
  readonly timeOptions = this.makeTimeOptions();

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<BusinessNotificationProfile>('invoice-notifications/profile')
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (profile) => this.patchForm(profile),
        error: (err) => this.error.set(err?.error?.message || err?.message || 'Unable to load business details')
      });
  }

  save(): void {
    this.saving.set(true);
    this.error.set('');
    this.saved.set(false);
    this.commitAllContactDrafts();
    const validationError = this.contactValidationError();
    if (validationError) {
      this.saving.set(false);
      this.error.set(validationError);
      return;
    }
    const payload: BusinessNotificationProfile = {
      ...this.form,
      reportingEmails: this.lines(this.reportingEmailsText),
      ownerEmails: this.lines(this.ownerEmailsText),
      ownerMobiles: this.contactList(this.ownerMobilesText),
      socialLinks: this.publicProfileLinks(),
      businessHours: this.normalizedBusinessHours()
    };
    this.api.put<BusinessNotificationProfile>('invoice-notifications/profile', payload)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (profile) => {
          this.patchForm(profile);
          this.saved.set(true);
        },
        error: (err) => this.error.set(err?.error?.message || err?.message || 'Unable to save business details')
      });
  }

  hasChannel(type: 'client' | 'owner', channel: string): boolean {
    return (type === 'client' ? this.form.clientChannels : this.form.ownerChannels)?.includes(channel) || false;
  }

  toggleChannel(type: 'client' | 'owner', channel: string): void {
    const key = type === 'client' ? 'clientChannels' : 'ownerChannels';
    const set = new Set(this.form[key] || []);
    set.has(channel) ? set.delete(channel) : set.add(channel);
    this.form[key] = [...set];
  }

  clientSmsReady(): boolean {
    return this.hasChannel('client', 'sms');
  }

  ownerSmsReady(): boolean {
    return this.hasChannel('owner', 'sms') && this.ownerMobileCount() > 0;
  }

  ownerMobileCount(): number {
    return this.lines(this.ownerMobilesText).length;
  }

  channelList(channels: string[] = []): string {
    return channels.length ? channels.map((item) => this.label(item)).join(', ') : 'No channels selected';
  }

  providerLabel(): string {
    return this.label(this.form.providerMode || 'queued');
  }

  uploadCoverPhoto(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.coverUploading.set(true);
    this.error.set('');
    this.saved.set(false);
    this.uploadProfileImage(file, 'cover')
      .then((url) => {
        this.coverImageText = url;
      })
      .catch((err) => this.error.set(this.errorText(err, 'Unable to upload cover photo')))
      .finally(() => this.coverUploading.set(false));
  }

  async uploadGalleryPhotos(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    this.galleryUploading.set(true);
    this.error.set('');
    this.saved.set(false);
    try {
      const uploaded: string[] = [];
      for (const file of files) {
        uploaded.push(await this.uploadProfileImage(file, 'gallery'));
      }
      this.galleryImagesText = [...new Set([...this.galleryImageList(), ...uploaded])].join('\n');
    } catch (err) {
      this.error.set(this.errorText(err, 'Unable to upload gallery photos'));
    } finally {
      this.galleryUploading.set(false);
    }
  }

  clearCoverPhoto(): void {
    this.coverImageText = '';
    this.saved.set(false);
  }

  removeGalleryImage(image: string): void {
    this.galleryImagesText = this.galleryImageList().filter((item) => item !== image).join('\n');
    this.saved.set(false);
  }

  galleryImageList(): string[] {
    return this.lines(this.galleryImagesText);
  }

  contactList(value: string): string[] {
    return this.lines(value);
  }

  invalidEmailChips(value: string): string[] {
    return this.contactList(value).filter((item) => !this.isEmailTokenValid(item));
  }

  invalidPhoneChips(): string[] {
    return this.contactList(this.ownerMobilesText).filter((item) => !this.isPhoneTokenValid(item));
  }

  isEmailTokenValid(value: string): boolean {
    const email = String(value || '').trim();
    if (!email || email.length > 254 || /[\u0000-\u001f<>]/u.test(email)) return false;
    const atIndex = this.findEmailAtIndex(email);
    if (atIndex <= 0 || atIndex === email.length - 1) return false;
    const local = email.slice(0, atIndex);
    const domain = email.slice(atIndex + 1);
    if (!local || !domain || /\s/u.test(domain) || domain.startsWith('.') || domain.endsWith('.')) return false;
    if (local.startsWith('"')) return /^"[\s\S]+"$/u.test(local);
    return !/\s/u.test(local) && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..');
  }

  isPhoneTokenValid(value: string): boolean {
    const parsed = this.parsePhoneToken(value);
    if (!parsed) return false;
    const country = this.countryDialCodes
      .filter((item) => item.code !== '+' && parsed.normalized.startsWith(item.code))
      .sort((a, b) => b.code.length - a.code.length)[0];
    const nationalLength = country ? parsed.digits.length - country.code.replace(/\D/g, '').length : parsed.digits.length;
    const limits = country || this.countryDialCodes[this.countryDialCodes.length - 1];
    return nationalLength >= limits.min && nationalLength <= limits.max;
  }

  handleContactKeydown(event: KeyboardEvent, key: ContactListKey): void {
    if (['Enter', 'Tab', ',', ';'].includes(event.key)) {
      event.preventDefault();
      this.commitContactDraft(key);
    }
    if (event.key === 'Backspace' && !this.contactDraftValue(key)) {
      const items = this.contactList(this.contactTextValue(key));
      if (!items.length) return;
      this.setContactTextValue(key, items.slice(0, -1));
    }
  }

  handleContactPaste(event: ClipboardEvent, key: ContactListKey): void {
    const pasted = event.clipboardData?.getData('text') || '';
    if (!pasted || !/[\n,;\t]/.test(pasted)) return;
    event.preventDefault();
    this.addContactTokens(key, pasted);
  }

  commitContactDraft(key: ContactListKey): void {
    const draft = this.contactDraftValue(key);
    if (!draft.trim()) return;
    this.addContactTokens(key, draft);
    this.setContactDraftValue(key, '');
  }

  removeContactToken(key: ContactListKey, token: string): void {
    this.setContactTextValue(key, this.contactList(this.contactTextValue(key)).filter((item) => item !== token));
    this.saved.set(false);
  }

  private commitAllContactDrafts(): void {
    this.commitContactDraft('reportingEmails');
    this.commitContactDraft('ownerEmails');
    this.commitContactDraft('ownerMobiles');
  }

  private contactValidationError(): string {
    const invalidReporting = this.invalidEmailChips(this.reportingEmailsText);
    if (invalidReporting.length) return `Fix reporting email format: ${invalidReporting[0]}`;
    const invalidOwnerEmails = this.invalidEmailChips(this.ownerEmailsText);
    if (invalidOwnerEmails.length) return `Fix owner email format: ${invalidOwnerEmails[0]}`;
    const invalidOwnerMobiles = this.invalidPhoneChips();
    if (invalidOwnerMobiles.length) return `Fix owner mobile number format: ${invalidOwnerMobiles[0]}`;
    return '';
  }

  private addContactTokens(key: ContactListKey, rawValue: string): void {
    const existing = this.contactList(this.contactTextValue(key));
    const incoming = String(rawValue || '')
      .split(/[\n,;\t]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => key === 'ownerMobiles' ? this.normalizePhoneToken(item) : item)
      .filter(Boolean);
    this.setContactTextValue(key, [...new Set([...existing, ...incoming])]);
    this.saved.set(false);
  }

  private contactTextValue(key: ContactListKey): string {
    if (key === 'reportingEmails') return this.reportingEmailsText;
    if (key === 'ownerEmails') return this.ownerEmailsText;
    return this.ownerMobilesText;
  }

  private setContactTextValue(key: ContactListKey, values: string[]): void {
    const text = values.join('\n');
    if (key === 'reportingEmails') {
      this.reportingEmailsText = text;
    } else if (key === 'ownerEmails') {
      this.ownerEmailsText = text;
    } else {
      this.ownerMobilesText = text;
    }
  }

  private contactDraftValue(key: ContactListKey): string {
    if (key === 'reportingEmails') return this.reportingEmailDraft;
    if (key === 'ownerEmails') return this.ownerEmailDraft;
    return this.ownerMobileDraft;
  }

  private setContactDraftValue(key: ContactListKey, value: string): void {
    if (key === 'reportingEmails') {
      this.reportingEmailDraft = value;
    } else if (key === 'ownerEmails') {
      this.ownerEmailDraft = value;
    } else {
      this.ownerMobileDraft = value;
    }
  }

  private findEmailAtIndex(email: string): number {
    let quoted = false;
    let escaped = false;
    let found = -1;
    for (let index = 0; index < email.length; index += 1) {
      const character = email[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') quoted = !quoted;
      if (character === '@' && !quoted) {
        if (found !== -1) return -1;
        found = index;
      }
    }
    return found;
  }

  private normalizePhoneToken(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let cleaned = raw.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`;
    if (cleaned.startsWith('+')) return `+${cleaned.slice(1).replace(/\D/g, '')}`;

    const digits = cleaned.replace(/\D/g, '');
    const selected = this.countryDialCodes.find((item) => item.code === this.ownerMobileCountryCode) || this.countryDialCodes[0];
    const selectedDigits = selected.code.replace(/\D/g, '');
    if (selectedDigits && digits.startsWith(selectedDigits) && digits.length > selected.max) return `+${digits}`;
    return selected.code === '+' ? `+${digits.replace(/^0+/, '')}` : `${selected.code}${digits.replace(/^0+/, '')}`;
  }

  private parsePhoneToken(value: string): { normalized: string; digits: string } | null {
    const normalized = this.normalizePhoneToken(value);
    const digits = normalized.replace(/\D/g, '');
    if (!normalized.startsWith('+') || digits.length < 6 || digits.length > 15) return null;
    return { normalized, digits };
  }

  private patchForm(profile: BusinessNotificationProfile): void {
    this.form = { ...this.emptyForm(), ...profile, socialLinks: profile.socialLinks || {} };
    this.reportingEmailsText = (this.form.reportingEmails || []).join('\n');
    this.ownerEmailsText = (this.form.ownerEmails || []).join('\n');
    this.ownerMobilesText = (this.form.ownerMobiles || []).join('\n');
    const links = this.form.socialLinks || {};
    this.coverImageText = String(links['coverImage'] || links['coverImageUrl'] || '');
    this.galleryImagesText = Array.isArray(links['galleryImages']) ? (links['galleryImages'] as string[]).join('\n') : String(links['galleryImages'] || '');
    this.websiteUrl = String(links['website'] || '');
    this.instagramUrl = String(links['instagram'] || '');
    this.mapsUrl = String(links['mapsUrl'] || links['googleMaps'] || '');
    this.showBusinessHours = links['showBusinessHours'] !== false;
    this.businessHours = this.mergeBusinessHours(profile.businessHours);
  }

  private emptyForm(): BusinessNotificationProfile {
    return {
      businessName: '',
      logoUrl: '',
      adminEmail: '',
      reportingEmails: [],
      ownerEmails: [],
      ownerMobiles: [],
      clientChannels: ['whatsapp', 'sms', 'email'],
      ownerChannels: ['email', 'sms'],
      mobileNumber: '',
      telephoneNumber: '',
      appointmentNumber: '',
      address: '',
      country: 'India - IN',
      state: '',
      city: '',
      postalCode: '',
      aboutUs: '',
      socialLinks: {},
      businessHours: this.defaultBusinessHours(),
      providerMode: 'queued',
      invoiceClientEnabled: true,
      invoiceOwnerEnabled: true
    };
  }

  copyMondayToWeek(): void {
    const monday = { ...this.businessHours['monday'] };
    this.businessHourDays.forEach((day) => {
      this.businessHours[day.key] = { ...monday };
    });
  }

  setBusinessHourTime(dayKey: string, field: 'opensAt' | 'closesAt', value: string): void {
    this.businessHours[dayKey] = {
      ...this.businessHours[dayKey],
      [field]: value
    };
    if (this.applyTimingsToAll) {
      this.applyBusinessHourToAll(dayKey);
    }
  }

  setBusinessHourStatus(dayKey: string, status: string): void {
    this.businessHours[dayKey] = {
      ...this.businessHours[dayKey],
      open: status === 'open'
    };
    if (this.applyTimingsToAll) {
      this.applyBusinessHourToAll(dayKey);
    }
  }

  private applyBusinessHourToAll(sourceDayKey: string): void {
    const source = { ...this.businessHours[sourceDayKey] };
    this.businessHourDays.forEach((day) => {
      this.businessHours[day.key] = { ...source };
    });
  }

  private async uploadProfileImage(file: File, kind: 'cover' | 'gallery'): Promise<string> {
    if (!this.isSupportedPhoto(file)) {
      throw new Error('Only JPG, JPEG, PNG and common photo files are allowed');
    }
    if (file.size > this.maxImageBytes) {
      throw new Error('Photo size must be 5 MB or less');
    }
    const dataUrl = await this.readFileAsDataUrl(file);
    const response = await firstValueFrom(this.api.post<BusinessMediaUploadResponse>('invoice-notifications/profile/media', {
      kind,
      fileName: file.name,
      mimeType: file.type || this.mimeTypeFromFileName(file.name),
      sizeBytes: file.size,
      dataUrl
    }));
    if (!response.url) throw new Error('Upload did not return an image URL');
    return response.url;
  }

  private isSupportedPhoto(file: File): boolean {
    return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|hei[cf]|bmp|tiff?)$/i.test(file.name);
  }

  private mimeTypeFromFileName(fileName: string): string {
    const extension = String(fileName || '').toLowerCase().split('.').pop();
    const byExtension: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      avif: 'image/avif',
      heic: 'image/heic',
      heif: 'image/heif',
      bmp: 'image/bmp',
      tif: 'image/tiff',
      tiff: 'image/tiff'
    };
    return byExtension[extension || ''] || '';
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Unable to read selected photo'));
      reader.readAsDataURL(file);
    });
  }

  private errorText(error: unknown, fallback: string): string {
    const err = error as { error?: { message?: unknown; error?: unknown }; message?: unknown };
    return String(err?.error?.message || err?.error?.error || err?.message || fallback);
  }

  private lines(value: string): string[] {
    return [...new Set(String(value || '').split(/[\n,;]/).map((item) => item.trim()).filter(Boolean))];
  }

  private label(value = ''): string {
    return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
  }

  private publicProfileLinks(): Record<string, unknown> {
    return {
      ...(this.form.socialLinks || {}),
      coverImage: this.coverImageText.trim(),
      galleryImages: this.lines(this.galleryImagesText),
      website: this.websiteUrl.trim(),
      instagram: this.instagramUrl.trim(),
      mapsUrl: this.mapsUrl.trim(),
      showBusinessHours: this.showBusinessHours
    };
  }

  private defaultBusinessHours(): Record<string, BusinessHour> {
    return {
      sunday: { open: true, opensAt: '07:00', closesAt: '21:00' },
      monday: { open: true, opensAt: '11:00', closesAt: '21:00' },
      tuesday: { open: true, opensAt: '11:00', closesAt: '21:00' },
      wednesday: { open: true, opensAt: '11:00', closesAt: '21:00' },
      thursday: { open: true, opensAt: '11:00', closesAt: '21:00' },
      friday: { open: true, opensAt: '11:00', closesAt: '21:00' },
      saturday: { open: true, opensAt: '11:00', closesAt: '21:00' }
    };
  }

  private mergeBusinessHours(value?: Record<string, BusinessHour>): Record<string, BusinessHour> {
    const defaults = this.defaultBusinessHours();
    this.businessHourDays.forEach((day) => {
      const incoming = value?.[day.key];
      defaults[day.key] = {
        open: incoming?.open !== false,
        opensAt: this.normalizeTimeValue(incoming?.opensAt || defaults[day.key].opensAt),
        closesAt: this.normalizeTimeValue(incoming?.closesAt || defaults[day.key].closesAt),
        note: incoming?.note || ''
      };
    });
    return defaults;
  }

  private normalizedBusinessHours(): Record<string, BusinessHour> {
    return this.mergeBusinessHours(this.businessHours);
  }

  private makeTimeOptions(): TimeOption[] {
    return Array.from({ length: 96 }, (_item, index) => {
      const minutes = index * 15;
      return {
        value: this.minutesToValue(minutes),
        label: this.minutesToLabel(minutes)
      };
    });
  }

  private normalizeTimeValue(value = ''): string {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return '10:00';
    const hours = Math.max(0, Math.min(Number(match[1]), 23));
    const minutes = Math.max(0, Math.min(Math.round(Number(match[2]) / 15) * 15, 45));
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private minutesToValue(minutes: number): string {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private minutesToLabel(minutes: number): string {
    const hour24 = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const hour = hour24 % 12 || 12;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${suffix}`;
  }
}
