import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiRecord } from '../../../core/api.service';
import { StaffOsApi } from '../data/staff-os.api';
import { StaffOsShiftMaster, StaffOsStaff } from '../domain/staff-os.models';

type PunchType = 'in' | 'out';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="face-page">
      <header class="hero">
        <div>
          <span class="eyebrow">Attendance / Mobile biometric</span>
          <h1>Face Punch</h1>
          <p>Staff mobile camera se punch in/out karega. Shift duration ke baad extra time OT preview me calculate hota hai.</p>
        </div>
        <button class="primary" type="button" (click)="openCamera()" [disabled]="cameraOn()">Start camera</button>
      </header>

      <p class="banner err" *ngIf="error()">{{ error() }}</p>
      <p class="banner ok" *ngIf="message()">{{ message() }}</p>

      <section class="grid">
        <article class="panel camera">
          <div class="camera-frame">
            <video #video autoplay muted playsinline></video>
            <div class="camera-empty" *ngIf="!cameraOn()">Camera preview will appear here</div>
          </div>
          <canvas #canvas width="320" height="240" hidden></canvas>
          <div class="actions">
            <button type="button" [class.active]="punchType() === 'in'" (click)="punchType.set('in')">Punch In</button>
            <button type="button" [class.active]="punchType() === 'out'" (click)="punchType.set('out')">Punch Out</button>
            <button class="primary" type="button" [disabled]="saving() || !selectedStaffId()" (click)="submitPunch()">{{ cameraOn() ? 'Face Scan Punch' : 'Manual Punch' }}</button>
          </div>
        </article>

        <article class="panel">
          <h2>Shift setup</h2>
          <div class="form-grid">
            <label><span>Staff</span>
              <select [ngModel]="selectedStaffId()" (ngModelChange)="selectedStaffId.set($event)">
                <option value="">Select staff</option>
                <option *ngFor="let person of staff()" [value]="person.id">{{ person.fullName || (person.firstName + ' ' + (person.lastName || '')) }}</option>
              </select>
            </label>
            <label><span>Shift template</span>
              <select [ngModel]="selectedShiftId()" (ngModelChange)="selectShift($event)">
                <option value="">Manual shift</option>
                <option *ngFor="let shift of shifts()" [value]="shift.id">{{ shift.name }} · {{ shift.startTime }} - {{ shift.endTime }}</option>
              </select>
            </label>
            <label><span>Punch in time</span><input type="time" [ngModel]="punchIn()" (ngModelChange)="punchIn.set($event)" /></label>
            <label><span>Punch out time</span><input type="time" [ngModel]="punchOut()" (ngModelChange)="punchOut.set($event)" /></label>
            <label><span>Shift hours</span><input type="number" min="1" step="0.5" [ngModel]="shiftHours()" (ngModelChange)="shiftHours.set(+$event)" /></label>
            <label><span>OT after minutes</span><input type="number" min="0" step="5" [ngModel]="otAfterMinutes()" (ngModelChange)="otAfterMinutes.set(+$event)" /></label>
            <label><span>Hourly salary ₹</span><input type="number" min="0" step="1" [ngModel]="hourlySalary()" (ngModelChange)="hourlySalary.set(+$event)" /></label>
            <label><span>OT multiplier</span><input type="number" min="1" step="0.25" [ngModel]="otMultiplier()" (ngModelChange)="otMultiplier.set(+$event)" /></label>
          </div>
        </article>
      </section>

      <section class="cards" *ngIf="preview() as p">
        <article><span>Worked</span><strong>{{ p.workedLabel }}</strong></article>
        <article><span>Required</span><strong>{{ p.requiredLabel }}</strong></article>
        <article><span>OT</span><strong>{{ p.otLabel }}</strong></article>
        <article><span>OT Amount</span><strong>₹{{ p.otAmount }}</strong></article>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Today punch preview</h2>
          <span>{{ today() }}</span>
        </div>
        <div class="table">
          <div class="row head"><span>Staff</span><span>In</span><span>Out</span><span>Worked</span><span>OT</span><span>Status</span></div>
          <div class="row" *ngFor="let row of localRows()">
            <span>{{ row.staffName }}</span><span>{{ row.inTime }}</span><span>{{ row.outTime || '-' }}</span><span>{{ row.worked }}</span><span>{{ row.ot }}</span><span>{{ row.status }}</span>
          </div>
          <div class="empty" *ngIf="!localRows().length">No face punch preview yet.</div>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .face-page { display: grid; gap: 16px; color: #122033; }
    .hero, .panel, .cards article { background: #fff; border: 1px solid #d8e4ea; border-radius: 8px; box-shadow: 0 16px 34px rgba(15, 23, 42, .06); }
    .hero { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 22px 24px; }
    h1 { margin: 4px 0 6px; font-size: 32px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    p { margin: 0; color: #607086; }
    .eyebrow { color: #0f8f79; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: 420px minmax(0, 1fr); gap: 14px; }
    .panel { padding: 16px; }
    .camera-frame { min-height: 300px; background: #0f172a; border-radius: 8px; overflow: hidden; position: relative; display: grid; place-items: center; }
    video { width: 100%; height: 100%; object-fit: cover; min-height: 300px; }
    .camera-empty { position: absolute; color: #dbeafe; font-weight: 800; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
    button, .primary { min-height: 40px; border: 1px solid #9fb2b8; border-radius: 6px; padding: 0 14px; background: #fff; color: #0f172a; font-weight: 900; cursor: pointer; }
    button.active, .primary { background: #0f8f79; border-color: #0f8f79; color: #fff; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 5px; color: #31445c; font-weight: 900; }
    label span { font-size: 12px; text-transform: uppercase; }
    input, select { min-height: 40px; border: 1px solid #b7c5cf; border-radius: 6px; padding: 0 10px; font: inherit; background: #fff; color: #122033; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .cards article { padding: 16px; border-top: 4px solid #0f8f79; }
    .cards span { display: block; color: #607086; font-weight: 800; }
    .cards strong { display: block; margin-top: 8px; font-size: 26px; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; }
    .table { border: 1px solid #d8e4ea; border-radius: 8px; overflow: hidden; }
    .row { display: grid; grid-template-columns: 1.2fr repeat(5, 1fr); }
    .row span { padding: 10px 12px; border-bottom: 1px solid #e8eff3; }
    .row.head { background: #eef7f5; font-weight: 900; }
    .empty { padding: 26px; text-align: center; color: #607086; }
    .banner { margin: 0; padding: 10px 14px; border-radius: 8px; font-weight: 800; }
    .banner.err { background: #fee2e2; color: #991b1b; }
    .banner.ok { background: #dcfce7; color: #166534; }
    @media (max-width: 920px) { .hero, .grid { grid-template-columns: 1fr; } .hero { flex-direction: column; align-items: stretch; } .form-grid, .cards { grid-template-columns: 1fr; } .row { grid-template-columns: 1fr; } }
  `]
})
export class FacePunchPage implements OnInit, OnDestroy {
  @ViewChild('video') video?: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvas?: ElementRef<HTMLCanvasElement>;

  readonly staff = signal<StaffOsStaff[]>([]);
  readonly shifts = signal<StaffOsShiftMaster[]>([]);
  readonly selectedStaffId = signal('');
  readonly selectedShiftId = signal('');
  readonly punchType = signal<PunchType>('in');
  readonly punchIn = signal('09:00');
  readonly punchOut = signal('18:20');
  readonly shiftHours = signal(9);
  readonly otAfterMinutes = signal(0);
  readonly hourlySalary = signal(100);
  readonly otMultiplier = signal(1.5);
  readonly cameraOn = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly localRows = signal<Array<{ staffName: string; inTime: string; outTime: string; worked: string; ot: string; status: string }>>([]);
  private stream?: MediaStream;

  readonly today = signal(new Date().toISOString().slice(0, 10));

  readonly selectedStaff = computed(() => this.staff().find((person) => person.id === this.selectedStaffId()) || null);
  readonly preview = computed(() => {
    const worked = Math.max(0, minutesBetween(this.punchIn(), this.punchOut()));
    const required = Math.round(Number(this.shiftHours() || 0) * 60);
    const ot = Math.max(0, worked - required - Number(this.otAfterMinutes() || 0));
    const otAmount = Math.round((ot / 60) * Number(this.hourlySalary() || 0) * Number(this.otMultiplier() || 1));
    return {
      worked,
      required,
      ot,
      workedLabel: labelMinutes(worked),
      requiredLabel: labelMinutes(required),
      otLabel: labelMinutes(ot),
      otAmount
    };
  });

  constructor(private readonly api: StaffOsApi) {}

  ngOnInit(): void {
    forkJoin({
      staff: this.api.staff({ limit: 500 }),
      shifts: this.api.shiftMasters({ includeArchived: 'true', limit: 500 })
    }).subscribe({
      next: ({ staff, shifts }) => {
        this.staff.set(staff || []);
        this.shifts.set(shifts || []);
      },
      error: () => this.error.set('Unable to load staff and shift list. Refresh and try again.')
    });
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  selectShift(id: string): void {
    this.selectedShiftId.set(id);
    const shift = this.shifts().find((item) => item.id === id);
    if (!shift) return;
    this.punchIn.set(shift.startTime || this.punchIn());
    const duration = Math.max(1, minutesBetween(shift.startTime, shift.endTime) - Number(shift.breakMinutes || 0));
    this.shiftHours.set(Math.round((duration / 60) * 10) / 10);
    this.punchOut.set(addMinutes(shift.startTime, duration + 20));
  }

  async openCamera(): Promise<void> {
    try {
      this.error.set('');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is not supported.');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      if (this.video?.nativeElement) this.video.nativeElement.srcObject = this.stream;
      this.cameraOn.set(true);
    } catch (error: any) {
        this.error.set((error?.message || 'Camera permission was not granted.') + ' You can use manual punch fallback.');
    }
  }

  async submitPunch(): Promise<void> {
    const staff = this.selectedStaff();
    if (!staff) {
      this.error.set('Select staff.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    const image = this.captureImage();
    const preview = this.preview();
    const payload: ApiRecord = {
      staffId: staff.id,
      employeeCode: staff.employeeCode || staff.id,
      punchType: this.punchType(),
      eventType: this.punchType() === 'in' ? 'punch_in' : 'punch_out',
      businessDate: this.today(),
      punchTime: this.punchType() === 'in' ? this.punchIn() : this.punchOut(),
      shiftHours: this.shiftHours(),
      overtimeMinutes: preview.ot,
      captureMode: image ? 'face_camera' : 'manual_fallback',
      image
    };
    this.api.cameraPunch(payload).subscribe({
      next: () => {
        this.message.set('Face punch saved. Attendance/OT preview updated.');
        this.addLocalRow(staff, preview);
        this.saving.set(false);
      },
      error: (error) => {
        this.message.set('');
        this.error.set(error?.error?.error || error?.message || 'Punch was not saved. Check backend settings or connectivity.');
        this.saving.set(false);
      }
    });
  }

  private addLocalRow(staff: StaffOsStaff, preview: { workedLabel: string; otLabel: string }): void {
    this.localRows.set([
      {
        staffName: staff.fullName || `${staff.firstName} ${staff.lastName || ''}`.trim(),
        inTime: this.punchIn(),
        outTime: this.punchType() === 'out' ? this.punchOut() : '',
        worked: preview.workedLabel,
        ot: preview.otLabel,
        status: this.punchType() === 'in' ? 'Present' : 'Completed'
      },
      ...this.localRows()
    ]);
  }

  private captureImage(): string {
    const video = this.video?.nativeElement;
    const canvas = this.canvas?.nativeElement;
    if (!video || !canvas || !this.cameraOn()) return '';
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  }

  private stopCamera(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  let startMinutes = sh * 60 + sm;
  let endMinutes = eh * 60 + em;
  if (endMinutes < startMinutes) endMinutes += 24 * 60;
  return endMinutes - startMinutes;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = ((h * 60 + m + minutes) % (24 * 60) + (24 * 60)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function labelMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}
