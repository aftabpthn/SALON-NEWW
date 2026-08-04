import { CommonModule } from "@angular/common";
import { Component, inject, OnDestroy, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";

import { StaffAppService, StaffScribeSession, StaffScribeSuggestion } from "../../core/staff-app.service";

/**
 * AI Scribe: record a treatment, review what it heard, then submit the form.
 *
 * The order on screen is the order the rules require. Consent is a gate, not a
 * checkbox further down: nothing can record until the guest has answered, and a
 * refusal is submitted too so the salon can show it asked. After transcription
 * the suggested values are editable text, because what reaches the guest's
 * record is what the staff member approves, never what the provider guessed.
 */
@Component({
  selector: "staff-scribe-page",
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: "./staff-app.styles.css",
  template: `
    <section class="page">
      <header class="page-head">
        <h1>AI Scribe</h1>
        <p>Record a treatment, review the draft, then submit the form. Audio is never stored.</p>
      </header>

      @if (error()) { <div class="alert error">{{ error() }}</div> }
      @if (notice()) { <div class="alert">{{ notice() }}</div> }

      @if (!session()) {
        <article class="card">
          <h2>1 · Ask for consent</h2>
          <p>Read the consent statement aloud. Record the answer either way — a refusal is evidence that you asked.</p>
          <label>Appointment ID<input [(ngModel)]="draft.appointmentId" placeholder="Appointment being treated" /></label>
          <label>Client ID<input [(ngModel)]="draft.clientId" placeholder="Guest record" /></label>
          <label>Staff ID<input [(ngModel)]="draft.staffId" placeholder="Provider delivering the treatment" /></label>
          <label>Form<input [(ngModel)]="draft.formDefinitionId" placeholder="Treatment form definition" /></label>
          <label>Name of the person consenting<input [(ngModel)]="draft.consentName" placeholder="Required to grant" /></label>
          <label class="row"><input type="checkbox" [(ngModel)]="draft.guestParticipant" /> Guest is present</label>
          <div class="actions">
            <button type="button" [disabled]="busy() || !canStart()" (click)="start('granted')">Consent granted</button>
            <button type="button" class="ghost" [disabled]="busy()" (click)="start('refused')">Consent refused</button>
          </div>
        </article>
      } @else {
        <article class="card">
          <h2>Session</h2>
          <p>
            <b>{{ statusLabel(session()!.status) }}</b>
            · consent {{ session()!.consentStatus }}
            @if (session()!.consentName) { · {{ session()!.consentName }} }
          </p>
          @if (session()!.providerErrorCode) { <p class="alert error">Provider error: {{ session()!.providerErrorCode }}</p> }
        </article>

        @if (session()!.consentStatus === 'granted' && (session()!.status === 'consent_granted' || session()!.status === 'failed')) {
          <article class="card">
            <h2>2 · Record</h2>
            <p>{{ recording() ? 'Recording…' : 'The recording is sent for transcription and then discarded.' }}</p>
            <div class="actions">
              @if (!recording()) {
                <button type="button" [disabled]="busy()" (click)="startRecording()">Start recording</button>
              } @else {
                <button type="button" (click)="stopRecording()">Stop and transcribe</button>
              }
            </div>
          </article>
        }

        @if (session()!.status === 'draft_ready') {
          <article class="card">
            <h2>3 · Review before it is saved</h2>
            <p>Every value below is editable. What you submit is what is written to the guest's record.</p>
            @for (suggestion of session()!.formSuggestions; track suggestion.fieldKey) {
              <label>
                {{ suggestion.label }}
                <textarea rows="2" [ngModel]="responses[suggestion.fieldKey] ?? suggestion.value"
                          (ngModelChange)="responses[suggestion.fieldKey] = $event"></textarea>
                <small>Heard: “{{ suggestion.evidence }}”</small>
              </label>
            }
            @if (!session()!.formSuggestions.length) {
              <p class="muted">Nothing was matched to a form field. Fill the form as usual; the transcript is below.</p>
            }
            <details>
              <summary>Transcript</summary>
              <p class="transcript">{{ session()!.transcript }}</p>
            </details>
            <label>Signature name<input [(ngModel)]="signatureName" placeholder="If the form requires it" /></label>
            <div class="actions">
              <button type="button" [disabled]="busy()" (click)="approve()">Submit reviewed form</button>
              <button type="button" class="ghost" [disabled]="busy()" (click)="revoke()">Guest withdrew consent</button>
            </div>
          </article>
        }

        @if (session()!.status === 'approved') {
          <article class="card">
            <h2>Saved</h2>
            <p>The form was submitted{{ session()!.formSubmissionId ? ' (' + session()!.formSubmissionId + ')' : '' }}.</p>
            <div class="actions"><button type="button" (click)="reset()">New session</button></div>
          </article>
        }

        @if (session()!.status === 'revoked' || session()!.status === 'refused') {
          <article class="card">
            <h2>{{ session()!.status === 'revoked' ? 'Consent withdrawn' : 'Consent refused' }}</h2>
            <p>{{ session()!.status === 'revoked' ? 'The transcript has been destroyed.' : 'No recording was made.' }}</p>
            <div class="actions"><button type="button" (click)="reset()">New session</button></div>
          </article>
        }
      }
    </section>
  `,
})
export class StaffScribePage implements OnDestroy {
  private readonly api = inject(StaffAppService);
  private readonly route = inject(ActivatedRoute);

  readonly session = signal<StaffScribeSession | null>(null);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly recording = signal(false);

  draft = {
    appointmentId: this.route.snapshot.queryParamMap.get("appointmentId") || "",
    clientId: this.route.snapshot.queryParamMap.get("clientId") || "",
    staffId: this.route.snapshot.queryParamMap.get("staffId") || "",
    formDefinitionId: "",
    consentName: "",
    guestParticipant: true,
  };
  responses: Record<string, string> = {};
  signatureName = "";

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  ngOnDestroy() { this.releaseRecorder(); }

  canStart() {
    return !!(this.draft.appointmentId.trim() && this.draft.clientId.trim() && this.draft.staffId.trim() && this.draft.formDefinitionId.trim());
  }

  statusLabel(status: StaffScribeSession["status"]) {
    return {
      consent_granted: "Consent granted", refused: "Consent refused", recording: "Recording",
      processing: "Transcribing", draft_ready: "Draft ready for review", approved: "Approved",
      revoked: "Consent withdrawn", discarded: "Discarded", failed: "Transcription failed",
    }[status] ?? status;
  }

  async start(consentStatus: "granted" | "refused") {
    if (this.busy()) return;
    if (consentStatus === "granted" && !this.draft.consentName.trim()) {
      this.error.set("Record the name of the person granting consent.");
      return;
    }
    this.busy.set(true); this.error.set(""); this.notice.set("");
    try {
      this.session.set(await this.api.startScribeSession({
        appointmentId: this.draft.appointmentId.trim(),
        clientId: this.draft.clientId.trim(),
        staffId: this.draft.staffId.trim(),
        formDefinitionId: this.draft.formDefinitionId.trim(),
        guestParticipant: this.draft.guestParticipant,
        consentStatus,
        consentName: this.draft.consentName.trim(),
      }));
    } catch (error) { this.error.set(this.message(error, "The session could not be started.")); }
    finally { this.busy.set(false); }
  }

  async startRecording() {
    this.error.set("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.recorder = new MediaRecorder(stream);
      this.recorder.ondataavailable = (event) => { if (event.data.size) this.chunks.push(event.data); };
      this.recorder.onstop = () => void this.uploadRecording();
      this.startedAt = Date.now();
      this.recorder.start();
      this.recording.set(true);
    } catch { this.error.set("Microphone access was refused, so nothing was recorded."); }
  }

  stopRecording() {
    this.recording.set(false);
    this.recorder?.stop();
  }

  private async uploadRecording() {
    const session = this.session();
    if (!session) return;
    const durationSeconds = Math.round((Date.now() - this.startedAt) / 1000);
    const recording = new Blob(this.chunks, { type: this.chunks[0]?.type || "audio/webm" });
    // Drop the local copy before the upload resolves: the browser has no reason
    // to hold treatment audio any longer than the backend does.
    this.chunks = [];
    this.releaseRecorder();
    this.busy.set(true); this.notice.set("Transcribing…");
    try {
      this.session.set(await this.api.uploadScribeRecording(session.id, recording, durationSeconds));
      this.notice.set("");
    } catch (error) {
      this.notice.set("");
      this.error.set(this.message(error, "The recording could not be transcribed."));
      try { this.session.set(await this.api.scribeSession(session.id)); } catch { /* keep the last known state */ }
    } finally { this.busy.set(false); }
  }

  async approve() {
    const session = this.session();
    if (!session || this.busy()) return;
    const responses: Record<string, string> = {};
    for (const suggestion of session.formSuggestions as StaffScribeSuggestion[]) {
      responses[suggestion.fieldKey] = this.responses[suggestion.fieldKey] ?? suggestion.value;
    }
    for (const [key, value] of Object.entries(this.responses)) responses[key] = value;
    this.busy.set(true); this.error.set("");
    try {
      this.session.set(await this.api.approveScribeDraft(session.id, responses, session.version, this.signatureName.trim()));
      this.notice.set("The reviewed form was submitted.");
    } catch (error) { this.error.set(this.message(error, "The form could not be submitted.")); }
    finally { this.busy.set(false); }
  }

  async revoke() {
    const session = this.session();
    if (!session || this.busy()) return;
    this.busy.set(true); this.error.set("");
    try {
      await this.api.revokeScribeConsent(session.id, "withdrawn by guest");
      this.session.set(await this.api.scribeSession(session.id));
      this.notice.set("Consent withdrawn and the transcript destroyed.");
    } catch (error) { this.error.set(this.message(error, "Consent could not be withdrawn.")); }
    finally { this.busy.set(false); }
  }

  reset() {
    this.session.set(null);
    this.responses = {};
    this.signatureName = "";
    this.notice.set("");
    this.error.set("");
  }

  private releaseRecorder() {
    this.recorder?.stream.getTracks().forEach((track) => track.stop());
    this.recorder = null;
  }

  private message(error: unknown, fallback: string) {
    const detail = error as { error?: { error?: { message?: string } }; message?: string };
    return detail?.error?.error?.message ?? detail?.message ?? fallback;
  }
}
