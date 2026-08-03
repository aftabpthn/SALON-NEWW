import { JsonPipe } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { IonButton, IonContent, IonInput, IonItem, IonLabel, IonSelect, IonSelectOption, IonSpinner, IonTextarea } from "@ionic/angular/standalone";
import { CustomerApiService } from "../../core/customer-api.service";
import { KioskContext, KioskGuestSession } from "../../core/api.types";

@Component({
  standalone: true,
  imports: [JsonPipe, FormsModule, IonButton, IonContent, IonInput, IonItem, IonLabel, IonSelect, IonSelectOption, IonSpinner, IonTextarea],
  template: `
    <ion-content [fullscreen]="true">
      <main class="kiosk-shell" [style.--kiosk-primary]="context()?.branding?.primaryColor || '#2563eb'">
        @if (loading()) { <ion-spinner aria-label="Loading kiosk"></ion-spinner> }
        @else if (!context()) {
          <section class="kiosk-card activation">
            <h1>Activate kiosk</h1>
            <ion-item><ion-label position="stacked">Activation code</ion-label><ion-input [(ngModel)]="activationCode" maxlength="32" autocomplete="off"></ion-input></ion-item>
            <ion-button expand="block" (click)="activate()">Activate</ion-button>
            @if (message()) { <p class="status" role="status">{{ message() }}</p> }
          </section>
        } @else {
          <header class="kiosk-header">
            @if (context()!.branding.logoUrl) { <img [src]="context()!.branding.logoUrl" alt="" /> }
            <div><h1>{{ context()!.branding.appName || context()!.branch.name }}</h1><p>{{ context()!.branch.address }}</p></div>
            <button type="button" class="admin-link" (click)="adminOpen.set(!adminOpen())">Admin</button>
          </header>
          @if (adminOpen()) {
            <section class="kiosk-card admin-panel">
              <ion-item><ion-label position="stacked">Admin PIN</ion-label><ion-input type="password" inputmode="numeric" [(ngModel)]="adminPin" maxlength="8"></ion-input></ion-item>
              <ion-button fill="outline" (click)="deactivate()">Deactivate device</ion-button>
            </section>
          }
          @if (!guest()) {
            <section class="kiosk-card">
              @if (context()!.branches.length > 1) {
                <ion-item><ion-label position="stacked">Location</ion-label><ion-select [ngModel]="context()!.branch.id" (ngModelChange)="switchBranch($event)">@for (branch of context()!.branches; track branch.id) { <ion-select-option [value]="branch.id">{{ branch.name }}</ion-select-option> }</ion-select></ion-item>
              }
              <h2>Check in</h2>
              <ion-item><ion-label position="stacked">Booking reference</ion-label><ion-input [(ngModel)]="appointmentId" autocomplete="off"></ion-input></ion-item>
              <ion-item><ion-label position="stacked">Full phone number</ion-label><ion-input [(ngModel)]="phone" inputmode="tel" autocomplete="tel"></ion-input></ion-item>
              <ion-button expand="block" (click)="identify()">Find booking</ion-button>
              @if (context()!.config.allowSameDayBooking) { <ion-button expand="block" fill="outline" (click)="bookNow()">Book for today</ion-button> }
            </section>
          } @else {
            <section class="kiosk-card booking-card">
              <p class="eyebrow">Booking {{ guest()!.appointmentId }}</p>
              <h2>{{ formatDate(guest()!.startAt) }}</h2>
              @for (service of guest()!.services; track service.id) { <p>{{ service.name }} · {{ service.durationMinutes }} min</p> }
              @if (guest()!.groupCount > 1) { <p>{{ guest()!.groupCount }} guests in this booking</p> }
              @if (guest()!.queue?.position) { <p class="queue">Queue {{ guest()!.queue!.position }} · about {{ guest()!.queue!.estimatedWaitMinutes }} min</p> }
            </section>
            @if (hasMissingProfile()) {
              <section class="kiosk-card"><h2>Complete profile</h2>
                @if (guest()!.missingProfile.firstName) { <ion-item><ion-label position="stacked">First name</ion-label><ion-input [(ngModel)]="profile.firstName"></ion-input></ion-item> }
                @if (guest()!.missingProfile.lastName) { <ion-item><ion-label position="stacked">Last name</ion-label><ion-input [(ngModel)]="profile.lastName"></ion-input></ion-item> }
                @if (guest()!.missingProfile.email) { <ion-item><ion-label position="stacked">Email</ion-label><ion-input type="email" [(ngModel)]="profile.email"></ion-input></ion-item> }
                <ion-button expand="block" fill="outline" (click)="saveProfile()">Save profile</ion-button>
              </section>
            }
            @if (guest()!.pendingForms.length) {
              <section class="kiosk-card"><h2>Required forms</h2>
                @for (form of guest()!.pendingForms; track form.id) { <ion-button expand="block" fill="outline" (click)="openForm(form.id)">{{ form.name }}</ion-button> }
              </section>
            }
            @if (activeForm()) {
              <section class="kiosk-card"><h2>{{ activeForm().name }}</h2>
                @for (field of activeForm().fieldsJson || []; track field.key) {
                  @if (field.type === 'textarea') { <ion-item><ion-label position="stacked">{{ field.label }}</ion-label><ion-textarea [(ngModel)]="formDraft.responses[field.key]"></ion-textarea></ion-item> }
                  @else { <ion-item><ion-label position="stacked">{{ field.label }}</ion-label><ion-input [type]="field.type === 'number' ? 'number' : 'text'" [(ngModel)]="formDraft.responses[field.key]"></ion-input></ion-item> }
                }
                @if (activeForm().requiresSignature) { <ion-item><ion-label position="stacked">Signature name</ion-label><ion-input [(ngModel)]="formDraft.signatureName"></ion-input></ion-item><label class="consent"><input type="checkbox" [(ngModel)]="formDraft.consentAccepted" /> I consent and confirm this information.</label> }
                <ion-button expand="block" (click)="submitForm()">Submit form</ion-button>
              </section>
            }
            @if (context()!.config.allowAddOnRequest && guest()!.eligibleAddOns?.length) {
              <section class="kiosk-card"><h2>Add-on request</h2>@for (item of guest()!.eligibleAddOns!; track item.id) { <ion-button expand="block" fill="outline" (click)="requestAddOn(item.id)">{{ item.name }} · {{ money(item.pricePaise) }}</ion-button> }</section>
            }
            <section class="kiosk-card actions">
              <ion-button expand="block" (click)="checkIn()">Check in{{ guest()!.groupCount > 1 && context()!.config.allowGroupCheckIn ? ' group' : '' }}</ion-button>
              <ion-button expand="block" fill="outline" (click)="loadCheckout()">Checkout status</ion-button>
              @if (checkout()) { <pre>{{ checkout() | json }}</pre> }
              <ion-button expand="block" fill="clear" (click)="reset()">Done</ion-button>
            </section>
          }
          @if (message()) { <p class="status" role="status">{{ message() }}</p> }
        }
      </main>
    </ion-content>
  `,
  styles: [`
    :host{--ion-color-primary:var(--kiosk-primary,#2563eb)}ion-content{--background:#eef4fb}.kiosk-shell{max-width:720px;min-height:100%;margin:auto;padding:max(24px,env(safe-area-inset-top)) 18px 40px;display:grid;align-content:start;gap:14px}.kiosk-header,.kiosk-card{background:#fff;border:1px solid #d8e2ee;border-radius:18px;box-shadow:0 12px 30px rgba(20,43,74,.08)}.kiosk-header{display:flex;align-items:center;gap:14px;padding:16px}.kiosk-header img{width:52px;height:52px;object-fit:contain;border-radius:12px}.kiosk-header h1,.kiosk-card h1,.kiosk-card h2{margin:0 0 6px;color:#122033}.kiosk-header p,.booking-card p{margin:3px 0;color:#52647a}.admin-link{margin-left:auto;border:1px solid #ccd8e6;background:#fff;color:#17304f;border-radius:10px;padding:10px 12px}.kiosk-card{padding:18px}.activation{margin-top:20vh}.kiosk-card ion-item{--background:transparent;--padding-start:0;margin:6px 0}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.08em}.queue,.status{padding:12px;border-radius:10px;background:#e8f1ff;color:#173f75}.status{position:sticky;bottom:12px;margin:0}.consent{display:flex;gap:10px;align-items:flex-start;padding:14px 0}.actions pre{white-space:pre-wrap;font-size:12px;background:#f5f7fa;padding:10px;border-radius:10px}@media(max-width:480px){.kiosk-shell{padding-inline:10px}.kiosk-card{padding:14px}.kiosk-header h1{font-size:20px}}
  `]
})
export class KioskPage implements OnInit {
  readonly loading = signal(true); readonly context = signal<KioskContext | null>(null); readonly guest = signal<KioskGuestSession | null>(null); readonly message = signal(""); readonly checkout = signal<Record<string, unknown> | null>(null); readonly adminOpen = signal(false); readonly activeForm = signal<any>(null);
  activationCode = ""; appointmentId = ""; phone = ""; adminPin = ""; profile = { firstName: "", lastName: "", email: "" }; formAccess: { token: string; endpoint: string } | null = null; formDraft = { responses: {} as Record<string, unknown>, signatureName: "", consentAccepted: false };
  constructor(private readonly api: CustomerApiService, private readonly router: Router) {}
  async ngOnInit(){ try{this.context.set(await firstValueFrom(this.api.getKioskContext()));this.guest.set(await firstValueFrom(this.api.getKioskSession()).catch(()=>null));}catch{this.context.set(null);}finally{this.loading.set(false);} }
  async activate(){this.message.set("");try{await firstValueFrom(this.api.activateKiosk(this.activationCode.trim()));this.context.set(await firstValueFrom(this.api.getKioskContext()));this.activationCode="";}catch(error){this.fail(error,"Activation failed");}}
  async switchBranch(id:string){try{this.context.set(await firstValueFrom(this.api.switchKioskBranch(id)));this.guest.set(null);}catch(error){this.fail(error,"Location switch failed");}}
  async identify(){try{this.guest.set(await firstValueFrom(this.api.identifyKioskBooking(this.appointmentId.trim(),this.phone.trim())));this.phone="";}catch(error){this.fail(error,"Booking not found");}}
  async checkIn(){try{const location=await this.position();await firstValueFrom(this.api.kioskCheckIn({idempotencyKey:`kiosk:${crypto.randomUUID()}`,applyGroup:(this.guest()?.groupCount||0)>1,...location}));this.guest.set(await firstValueFrom(this.api.getKioskSession()));this.message.set("Check-in complete.");}catch(error){this.fail(error,"Check-in failed");}}
  async saveProfile(){try{await firstValueFrom(this.api.completeKioskProfile(this.profile));this.guest.set(await firstValueFrom(this.api.getKioskSession()));this.message.set("Profile updated.");}catch(error){this.fail(error,"Profile update failed");}}
  async requestAddOn(id:string){try{await firstValueFrom(this.api.requestKioskAddOn(id));this.message.set("Add-on request sent. Staff will confirm availability and price.");}catch(error){this.fail(error,"Add-on request failed");}}
  async loadCheckout(){try{this.checkout.set(await firstValueFrom(this.api.getKioskCheckout()));}catch(error){this.fail(error,"Checkout is not ready");}}
  async openForm(id:string){try{this.formAccess=await firstValueFrom(this.api.getKioskFormToken(id));this.activeForm.set(await firstValueFrom(this.api.getPublicKioskForm(this.formAccess.endpoint,this.formAccess.token)));this.formDraft={responses:{},signatureName:"",consentAccepted:false};}catch(error){this.fail(error,"Form could not be opened");}}
  async submitForm(){if(!this.formAccess)return;try{await firstValueFrom(this.api.submitPublicKioskForm(this.formAccess.endpoint,this.formAccess.token,this.formDraft));this.activeForm.set(null);this.formAccess=null;this.guest.set(await firstValueFrom(this.api.getKioskSession()));this.message.set("Form submitted.");}catch(error){this.fail(error,"Form submission failed");}}
  async reset(){try{await firstValueFrom(this.api.resetKiosk());this.guest.set(null);this.appointmentId="";this.checkout.set(null);this.activeForm.set(null);this.message.set("");}catch(error){this.fail(error,"Kiosk reset failed");}}
  async deactivate(){try{await firstValueFrom(this.api.deactivateKiosk(this.adminPin));this.context.set(null);this.guest.set(null);this.adminPin="";}catch(error){this.fail(error,"Admin PIN is invalid");}}
  bookNow(){const path=this.context()?.onlineBookingPath;if(path)void this.router.navigateByUrl(path);}
  hasMissingProfile(){const value=this.guest()?.missingProfile;return !!value&&(value.firstName||value.lastName||value.email);}
  formatDate(value:string){return new Date(value).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"});} money(value:number){return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(value/100);}
  private position(){return new Promise<Record<string,number>>((resolve,reject)=>{if(!navigator.geolocation){reject(new Error("Location is unavailable"));return;}navigator.geolocation.getCurrentPosition((p)=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracyMeters:p.coords.accuracy}),reject,{enableHighAccuracy:true,timeout:10000,maximumAge:15000});});}
  private fail(error:any,fallback:string){this.message.set(error?.error?.error?.message||error?.message||fallback);}
}
