import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type BrandToken = {
  key: string;
  label: string;
  value: string;
  help: string;
};

type BrandPreset = {
  name: string;
  industry: string;
  tokens: Record<string, string>;
};

@Component({
  selector: 'app-design-system',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="brand-studio" [ngStyle]="previewStyle()">
      <header class="studio-hero">
        <div>
          <h1>Salon Brand Customization Studio</h1>
        </div>
        <div class="hero-actions">
          <button type="button" class="studio-button ghost" (click)="reset()">Reset</button>
          <button type="button" class="studio-button primary" (click)="saveTheme()">Save Theme</button>
          <button type="button" class="studio-button primary" (click)="copyCss()">Copy CSS tokens</button>
        </div>
      </header>

      <div class="save-banner" *ngIf="savedMessage()">
        <strong>{{ savedMessage() }}</strong>
        <span>Saved colors are stored in this browser and remain available after page reload.</span>
      </div>

      <section class="preset-rail">
        <button
          *ngFor="let preset of presets"
          type="button"
          class="preset-card"
          (click)="applyPreset(preset)"
        >
          <strong>{{ preset.name }}</strong>
          <span>{{ preset.industry }}</span>
        </button>
      </section>

      <div class="studio-grid">
        <aside class="control-panel">
          <div class="section-title">
            <div>
              <h2>Complete color system</h2>
            </div>
          </div>

          <div class="token-editor" *ngFor="let token of tokens(); trackBy: trackToken">
            <label>
              <span>{{ token.label }}</span>
              <small>{{ token.help }}</small>
            </label>
            <div class="color-row">
              <input type="color" [(ngModel)]="token.value" [name]="token.key + '-picker'" (ngModelChange)="updateToken(token.key, $event)" />
              <input type="text" [(ngModel)]="token.value" [name]="token.key + '-text'" (ngModelChange)="updateToken(token.key, $event)" />
            </div>
          </div>

          <div class="advanced-controls">
            <label>
              <span>Border radius</span>
              <input type="range" min="4" max="28" [(ngModel)]="radius" name="radius" />
              <b>{{ radius }}px</b>
            </label>
            <label>
              <span>Card shadow</span>
              <input type="range" min="0" max="36" [(ngModel)]="shadow" name="shadow" />
              <b>{{ shadow }}px</b>
            </label>
            <label>
              <span>Sidebar width</span>
              <input type="range" min="220" max="340" [(ngModel)]="sidebarWidth" name="sidebarWidth" />
              <b>{{ sidebarWidth }}px</b>
            </label>
          </div>
        </aside>

        <main class="preview-panel">
          <div class="preview-shell">
            <aside class="preview-sidebar">
              <div class="brand-mark">AS</div>
              <strong>Aura Salon</strong>
              <span>Premium CRM / POS</span>
              <nav>
                <a class="active">Dashboard</a>
                <a>Appointments</a>
                <a>Clients</a>
                <a>Inventory</a>
                <a>Reports</a>
              </nav>
            </aside>

            <section class="preview-workspace">
              <div class="preview-topbar">
                <div>
                  <h2>Executive Dashboard</h2>
                </div>
                <button type="button" class="studio-button primary">Book appointment</button>
              </div>

              <div class="preview-kpis">
                <article><span>Today Sales</span><strong>₹48,500</strong></article>
                <article><span>Appointments</span><strong>32</strong></article>
                <article><span>Net Profit</span><strong>₹18,900</strong></article>
                <article><span>Low Stock</span><strong>4</strong></article>
              </div>

              <div class="preview-content">
                <section class="preview-card">
                  <div class="section-title">
                    <div>
                      <h3>Client booking pipeline</h3>
                    </div>
                    <button type="button" class="studio-button ghost">Filter</button>
                  </div>
                  <div class="mini-table">
                    <div><strong>Client</strong><strong>Service</strong><strong>Status</strong></div>
                    <div><span>Priya Sharma</span><span>Hair spa</span><b class="status success">Confirmed</b></div>
                    <div><span>Ayesha Khan</span><span>Facial</span><b class="status warning">Arrived</b></div>
                    <div><span>Neha Patel</span><span>Bridal makeup</span><b class="status danger">Pending</b></div>
                  </div>
                </section>

                <section class="preview-card">
                  <div class="section-title">
                    <div>
                      <h3>Theme-safe inputs</h3>
                    </div>
                  </div>
                  <label class="field"><span>Salon name</span><input value="Aura Salon" /></label>
                  <label class="field"><span>Primary module</span><select><option>Appointments</option></select></label>
                  <label class="field"><span>Owner note</span><textarea>Use brand color for high intent actions.</textarea></label>
                </section>
              </div>
            </section>
          </div>

          <section class="css-export">
            <div class="section-title">
              <div>
                <h2>Generated CSS variables</h2>
              </div>
            </div>
            <pre>{{ cssOutput() }}</pre>
          </section>
        </main>
      </div>
    </section>
  `,
  styles: [`
    .brand-studio {
      --studio-bg: var(--brand-background);
      --studio-surface: var(--brand-surface);
      --studio-text: var(--brand-text);
      --studio-muted: var(--brand-muted);
      --studio-primary: var(--brand-primary);
      --studio-hover: var(--brand-hover);
      --studio-border: var(--brand-border);
      --studio-sidebar: var(--brand-sidebar);
      --studio-sidebar-text: var(--brand-sidebar-text);
      --studio-sidebar-hover: var(--brand-sidebar-hover);
      --studio-sidebar-active: var(--brand-sidebar-active);
      --studio-button-text: var(--brand-button-text);
      --studio-input-bg: var(--brand-input-bg);
      --studio-card-hover: var(--brand-card-hover);
      --studio-table-hover: var(--brand-table-hover);
      --studio-success: var(--brand-success);
      --studio-warning: var(--brand-warning);
      --studio-danger: var(--brand-danger);
      --studio-accent: var(--brand-accent);
      display: grid;
      gap: 18px;
      padding: 16px 20px;
      color: var(--studio-text);
      -webkit-font-smoothing: antialiased;
    }

    .studio-hero,
    .control-panel,
    .preview-panel,
    .css-export,
    .preset-card {
      border: 1px solid var(--studio-border);
      border-radius: var(--brand-radius);
      background: var(--studio-input-bg);
      box-shadow: 0 var(--brand-shadow) var(--brand-shadow-blur) rgba(15, 23, 42, 0.09);
    }

    .studio-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      overflow: hidden;
      padding: 28px 32px;
      position: relative;
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--studio-primary) 12%, white), var(--studio-surface) 54%, color-mix(in srgb, var(--studio-accent) 10%, white)),
        var(--studio-surface);
    }
    .studio-hero::after {
      content: '';
      position: absolute;
      top: -60%;
      right: -10%;
      width: 360px;
      height: 360px;
      border-radius: 50%;
      background: radial-gradient(circle, color-mix(in srgb, var(--studio-primary) 6%, transparent) 0%, transparent 70%);
      pointer-events: none;
    }

    .studio-hero h1 {
      margin: 4px 0 8px;
      font-size: clamp(1.8rem, 3vw, 3rem);
      letter-spacing: -0.02em;
      line-height: 1.15;
    }

    .studio-hero p {
      max-width: 780px;
      margin: 0;
      color: var(--studio-muted);
      font-weight: 700;
      font-size: 14px;
      line-height: 1.5;
    }

    .hero-actions,
    .preview-topbar,
    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .control-panel .section-title { margin-bottom: 2px; }

    .studio-button {
      min-height: 40px;
      border: 1px solid var(--studio-border);
      border-radius: calc(var(--brand-radius) - 4px);
      padding: 0 18px;
      font-weight: 900;
      cursor: pointer;
      transition: all .2s ease;
    }

    .studio-button.primary {
      border-color: var(--studio-primary);
      background: var(--studio-primary);
      color: var(--studio-button-text);
      box-shadow: 0 2px 8px color-mix(in srgb, var(--studio-primary) 30%, transparent);
    }

    .studio-button.ghost {
      background: var(--studio-input-bg);
      color: var(--studio-text);
    }

    .studio-button:hover {
      border-color: var(--studio-hover);
      transform: translateY(-1px);
    }
    .studio-button.primary:hover {
      box-shadow: 0 4px 14px color-mix(in srgb, var(--studio-primary) 40%, transparent);
    }
    .studio-button:active { transform: scale(.97); }

    .preset-card:hover,
    .preview-card:hover,
    .preview-kpis article:hover,
    .mini-table div:hover {
      border-color: var(--studio-hover);
      background: var(--studio-card-hover);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.08);
    }

    .preset-rail {
      display: grid;
      grid-template-columns: repeat(5, minmax(150px, 1fr));
      gap: 12px;
    }

    .save-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 20px;
      border: 1px solid var(--studio-hover);
      border-radius: var(--brand-radius);
      background: var(--studio-card-hover);
      color: var(--studio-text);
      font-weight: 800;
      animation: bannerIn .3s ease;
    }
    @keyframes bannerIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .save-banner span {
      color: var(--studio-muted);
      font-size: 0.86rem;
    }

    .preset-card {
      display: grid;
      gap: 6px;
      min-height: 96px;
      padding: 16px 18px;
      text-align: left;
      cursor: pointer;
      position: relative;
      transition: all .2s ease;
    }
    .preset-card::before {
      content: '';
      width: 100%;
      height: 4px;
      border-radius: 4px;
      background: linear-gradient(90deg, var(--studio-primary), var(--studio-accent));
      opacity: .6;
      transition: opacity .2s;
    }
    .preset-card:hover::before { opacity: 1; }
    .preset-card:active { transform: scale(.97); }

    .preset-card span {
      color: var(--studio-muted);
      font-weight: 700;
      font-size: 13px;
    }

    .studio-grid {
      display: grid;
      grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }

    .control-panel { padding: 14px; }
    .preview-panel { padding: 18px; }

    .token-editor {
      display: flex;
      gap: 6px;
      padding: 5px 0;
      align-items: center;
      border-bottom: 1px solid color-mix(in srgb, var(--studio-border) 42%, transparent);
    }
    .token-editor:first-of-type { padding-top: 0; }
    .token-editor:last-of-type { border-bottom: 0; padding-bottom: 0; }

    .token-editor label {
      flex: 1;
      display: flex;
      align-items: baseline;
      gap: 4px;
      min-width: 0;
      cursor: pointer;
      order: 1;
    }
    .token-editor label span {
      font-weight: 800;
      font-size: 11px;
      white-space: nowrap;
    }
    .token-editor label small {
      color: var(--studio-muted);
      font-weight: 500;
      font-size: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .color-row {
      display: flex;
      gap: 4px;
      align-items: center;
      order: 0;
    }
    .color-row input[type="color"] {
      width: 28px;
      height: 28px;
      border: 2px solid var(--studio-border);
      border-radius: 6px;
      background: var(--studio-surface);
      cursor: pointer;
      padding: 1px;
      transition: border-color .15s;
    }
    .color-row input[type="color"]:hover { border-color: var(--studio-hover); }
    .color-row input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
    .color-row input[type="color"]::-webkit-color-swatch { border: 0; border-radius: 4px; }

    .color-row input[type="text"] {
      width: 78px;
      min-height: 28px;
      border: 1px solid var(--studio-border);
      border-radius: 6px;
      padding: 0 6px;
      background: var(--studio-surface);
      color: var(--studio-text);
      font-weight: 700;
      font-size: 11px;
      font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
      transition: border-color .15s, box-shadow .15s;
      text-align: center;
    }
    .color-row input[type="text"]:focus {
      border-color: var(--studio-hover);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--studio-hover) 15%, transparent);
      outline: none;
    }

    .advanced-controls {
      display: grid;
      gap: 8px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--studio-border);
    }
    .advanced-controls label {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .advanced-controls label span {
      font-weight: 900;
      font-size: 11px;
      min-width: 86px;
    }
    .advanced-controls input[type="range"] {
      accent-color: var(--studio-primary);
      flex: 1;
    }
    .advanced-controls b {
      color: var(--studio-primary);
      font-size: 12px;
      min-width: 32px;
      text-align: right;
    }

    .field input,
    .field select,
    .field textarea {
      width: 100%;
      min-height: 40px;
      border: 1px solid var(--studio-border);
      border-radius: 10px;
      padding: 0 12px;
      background: var(--studio-surface);
      color: var(--studio-text);
      font-weight: 800;
      transition: border-color .15s, box-shadow .15s;
    }
    .field input:focus,
    .field select:focus,
    .field textarea:focus {
      border-color: var(--studio-hover);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--studio-hover) 15%, transparent);
      outline: none;
    }

    .preview-shell {
      display: grid;
      grid-template-columns: var(--brand-sidebar-width) minmax(0, 1fr);
      overflow: hidden;
      min-height: 560px;
      border: 1px solid var(--studio-border);
      border-radius: var(--brand-radius);
      background: var(--studio-bg);
      box-shadow: 0 8px 30px rgba(15, 23, 42, 0.07);
    }

    .preview-sidebar {
      display: grid;
      align-content: start;
      gap: 6px;
      padding: 24px 20px;
      background: var(--studio-sidebar);
      color: var(--studio-sidebar-text);
    }

    .brand-mark {
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--studio-accent), var(--studio-primary));
      color: #ffffff;
      font-weight: 950;
      font-size: 18px;
      box-shadow: 0 4px 12px color-mix(in srgb, var(--studio-accent) 30%, transparent);
    }

    .preview-sidebar > strong {
      margin-top: 4px;
      font-size: 16px;
    }
    .preview-sidebar > span {
      color: color-mix(in srgb, var(--studio-sidebar-text) 60%, transparent);
      font-weight: 700;
      font-size: 12px;
    }

    .preview-sidebar nav {
      display: grid;
      gap: 6px;
      margin-top: 20px;
    }

    .preview-sidebar a {
      border: 1px solid color-mix(in srgb, var(--studio-sidebar-text) 10%, transparent);
      border-radius: 10px;
      padding: 10px 12px;
      color: var(--studio-sidebar-text);
      font-weight: 850;
      font-size: 13px;
      transition: all .15s;
      cursor: default;
    }
    .preview-sidebar a.active {
      background: var(--studio-sidebar-active);
      border-color: var(--studio-hover);
    }
    .preview-sidebar a:hover:not(.active) {
      background: var(--studio-sidebar-hover);
      border-color: color-mix(in srgb, var(--studio-sidebar-text) 20%, transparent);
    }

    .preview-workspace {
      display: grid;
      gap: 16px;
      align-content: start;
      padding: 20px;
    }

    .preview-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .preview-topbar h2 { margin: 0; font-size: 18px; }

    .preview-kpis {
      display: grid;
      grid-template-columns: repeat(4, minmax(130px, 1fr));
      gap: 12px;
    }

    .preview-kpis article,
    .preview-card {
      border: 1px solid var(--studio-border);
      border-radius: var(--brand-radius);
      background: var(--studio-surface);
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
      transition: all .2s ease;
    }

    .preview-kpis article {
      display: grid;
      gap: 4px;
      padding: 16px;
      border-top: 3px solid var(--studio-primary);
    }
    .preview-kpis article:nth-child(2) { border-top-color: var(--studio-accent); }
    .preview-kpis article:nth-child(3) { border-top-color: var(--studio-success); }
    .preview-kpis article:nth-child(4) { border-top-color: var(--studio-warning); }

    .preview-kpis span,
    .eyebrow {
      color: var(--studio-muted);
      font-size: 0.72rem;
      font-weight: 950;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .preview-kpis strong {
      font-size: 1.45rem;
      letter-spacing: -0.01em;
    }

    .preview-kpis small {
      color: var(--studio-primary);
      font-weight: 900;
      font-size: 12px;
    }

    .preview-content {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
      gap: 14px;
    }

    .preview-card {
      display: grid;
      gap: 14px;
      padding: 18px;
    }

    .preview-card h3,
    .section-title h2 {
      margin: 2px 0 0;
      letter-spacing: 0;
      font-size: 16px;
    }
    .section-title h2 { font-size: 18px; }

    .mini-table {
      display: grid;
      gap: 6px;
    }

    .mini-table div {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 10px;
      padding: 11px 14px;
      border: 1px solid var(--studio-border);
      border-radius: 10px;
      background: var(--studio-surface);
      align-items: center;
      transition: all .15s;
    }
    .mini-table div:first-child {
      background: color-mix(in srgb, var(--studio-border) 30%, transparent);
      font-size: 12px;
    }

    .mini-table b { color: var(--studio-primary); }
    .mini-table div:hover { background: var(--studio-table-hover); }

    .status {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 0 10px;
      color: #ffffff;
      font-size: 0.72rem;
      font-weight: 800;
    }
    .status.success { background: var(--studio-success); }
    .status.warning { background: var(--studio-warning); }
    .status.danger { background: var(--studio-danger); }

    .field {
      display: grid;
      gap: 5px;
      font-weight: 900;
    }
    .field span { font-size: 12px; }
    .field textarea {
      min-height: 80px;
      padding: 10px 12px;
    }

    .css-export {
      margin-top: 16px;
      padding: 18px;
      position: relative;
    }
    .css-export::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--studio-primary), var(--studio-accent));
      border-radius: var(--brand-radius) var(--brand-radius) 0 0;
    }

    .css-export pre {
      overflow: auto;
      margin: 0;
      padding: 20px;
      border: 1px solid var(--studio-border);
      border-radius: 12px;
      background: #0f172a;
      color: #d1fae5;
      font-size: 0.82rem;
      line-height: 1.7;
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
      counter-reset: line;
    }

    @media (max-width: 1200px) {
      .studio-grid,
      .preview-content {
        grid-template-columns: 1fr;
      }

      .preset-rail,
      .preview-kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .brand-studio { padding: 10px 12px; gap: 14px; }
      .studio-hero,
      .preview-topbar,
      .section-title {
        align-items: stretch;
        flex-direction: column;
      }
      .studio-hero { padding: 20px; }

      .hero-actions,
      .preset-rail,
      .preview-kpis,
      .preview-shell {
        grid-template-columns: 1fr;
      }

      .preview-sidebar {
        min-height: auto;
      }
      .control-panel,
      .preview-panel { padding: 14px; }
      .studio-hero h1 { font-size: 1.5rem; }
    }
  `]
})
export class DesignSystemComponent implements OnInit {
  radius = 16;
  shadow = 16;
  sidebarWidth = 270;
  readonly savedMessage = signal('');

  private readonly tokenState = signal<BrandToken[]>([
    { key: 'background', label: 'Background color', value: '#f4f7f6', help: 'Main app page background.' },
    { key: 'surface', label: 'Card background color', value: '#ffffff', help: 'Panels, cards, forms and tables.' },
    { key: 'text', label: 'Text color', value: '#142033', help: 'Primary readable text.' },
    { key: 'muted', label: 'Muted text color', value: '#64748b', help: 'Subtitles, labels and helper text.' },
    { key: 'primary', label: 'Primary button color', value: '#0f766e', help: 'Main actions like save and book.' },
    { key: 'buttonText', label: 'Button text color', value: '#ffffff', help: 'Text shown inside primary buttons.' },
    { key: 'hover', label: 'Hover color', value: '#14b8a6', help: 'Mouse hover and selected states.' },
    { key: 'border', label: 'Border color', value: '#dbe7e4', help: 'Card, table, input and divider borders.' },
    { key: 'sidebar', label: 'Sidebar color', value: '#071b18', help: 'Left navigation and admin shell.' },
    { key: 'sidebarText', label: 'Sidebar text color', value: '#eefcf8', help: 'Navigation text and icon color.' },
    { key: 'sidebarHover', label: 'Sidebar hover color', value: '#123f38', help: 'Menu item hover background.' },
    { key: 'sidebarActive', label: 'Sidebar active color', value: '#0f766e', help: 'Selected menu item background.' },
    { key: 'inputBg', label: 'Input background color', value: '#ffffff', help: 'Text fields, selects and textarea background.' },
    { key: 'cardHover', label: 'Card hover color', value: '#eefaf8', help: 'Cards, buttons and panels on hover.' },
    { key: 'tableHover', label: 'Table row hover color', value: '#f0fdfa', help: 'Table and list row hover state.' },
    { key: 'success', label: 'Success status color', value: '#16a34a', help: 'Confirmed, paid and completed states.' },
    { key: 'warning', label: 'Warning status color', value: '#f59e0b', help: 'Arrived, pending review and attention states.' },
    { key: 'danger', label: 'Danger status color', value: '#e11d48', help: 'Risk, failed and overdue states.' },
    { key: 'accent', label: 'Accent color', value: '#f97316', help: 'Badges, highlights and brand mark.' }
  ]);

  readonly tokens = computed(() => this.tokenState());

  readonly presets: BrandPreset[] = [
    {
      name: 'Luxury Emerald',
      industry: 'Premium salon',
      tokens: { primary: '#0f766e', hover: '#14b8a6', sidebar: '#071b18', sidebarHover: '#123f38', sidebarActive: '#0f766e', accent: '#f97316', background: '#f4f7f6', border: '#dbe7e4', cardHover: '#eefaf8', tableHover: '#f0fdfa' }
    },
    {
      name: 'Rose Studio',
      industry: 'Beauty lounge',
      tokens: { primary: '#be3455', hover: '#f06292', sidebar: '#250915', sidebarHover: '#512036', sidebarActive: '#be3455', accent: '#f59e0b', background: '#fff5f7', border: '#f3c7d3', cardHover: '#fff0f5', tableHover: '#fff1f4' }
    },
    {
      name: 'Clinic Clean',
      industry: 'Skin clinic',
      tokens: { primary: '#2563eb', hover: '#60a5fa', sidebar: '#0b1736', sidebarHover: '#17346f', sidebarActive: '#2563eb', accent: '#10b981', background: '#f4f8ff', border: '#cfe0ff', cardHover: '#eff6ff', tableHover: '#eef6ff' }
    },
    {
      name: 'Organic Spa',
      industry: 'Wellness spa',
      tokens: { primary: '#3f7d20', hover: '#84cc16', sidebar: '#12210f', sidebarHover: '#27461f', sidebarActive: '#3f7d20', accent: '#ca8a04', background: '#f7fbef', border: '#dcebc4', cardHover: '#f0f9dd', tableHover: '#f3fbe8' }
    },
    {
      name: 'Mono Elite',
      industry: 'Enterprise neutral',
      tokens: { primary: '#1f2937', hover: '#64748b', sidebar: '#080b12', sidebarHover: '#1f2937', sidebarActive: '#334155', accent: '#0ea5e9', background: '#f6f7f9', border: '#d9dee7', cardHover: '#f1f5f9', tableHover: '#f8fafc' }
    }
  ];

  readonly previewStyle = computed(() => {
    const map = this.tokenMap();
    return {
      '--brand-background': map['background'],
      '--brand-surface': map['surface'],
      '--brand-text': map['text'],
      '--brand-muted': map['muted'],
      '--brand-primary': map['primary'],
      '--brand-hover': map['hover'],
      '--brand-border': map['border'],
      '--brand-sidebar': map['sidebar'],
      '--brand-sidebar-text': map['sidebarText'],
      '--brand-sidebar-hover': map['sidebarHover'],
      '--brand-sidebar-active': map['sidebarActive'],
      '--brand-button-text': map['buttonText'],
      '--brand-input-bg': map['inputBg'],
      '--brand-card-hover': map['cardHover'],
      '--brand-table-hover': map['tableHover'],
      '--brand-success': map['success'],
      '--brand-warning': map['warning'],
      '--brand-danger': map['danger'],
      '--brand-accent': map['accent'],
      '--brand-radius': `${this.radius}px`,
      '--brand-shadow': `${this.shadow}px`,
      '--brand-shadow-blur': `${Math.round(this.shadow * 2.6)}px`,
      '--brand-sidebar-width': `${this.sidebarWidth}px`
    };
  });

  readonly cssOutput = computed(() => {
    const map = this.tokenMap();
    return `:root {
  --color-bg: ${map['background']};
  --color-surface: ${map['surface']};
  --color-text: ${map['text']};
  --color-muted: ${map['muted']};
  --color-primary: ${map['primary']};
  --color-button-text: ${map['buttonText']};
  --color-hover: ${map['hover']};
  --color-border: ${map['border']};
  --color-sidebar: ${map['sidebar']};
  --color-sidebar-text: ${map['sidebarText']};
  --color-sidebar-hover: ${map['sidebarHover']};
  --color-sidebar-active: ${map['sidebarActive']};
  --color-input-bg: ${map['inputBg']};
  --color-card-hover: ${map['cardHover']};
  --color-table-hover: ${map['tableHover']};
  --color-success: ${map['success']};
  --color-warning: ${map['warning']};
  --color-danger: ${map['danger']};
  --color-accent: ${map['accent']};
  --radius-card: ${this.radius}px;
  --shadow-card: 0 ${this.shadow}px ${this.shadow * 2.6}px rgba(15, 23, 42, 0.09);
  --sidebar-width: ${this.sidebarWidth}px;
}`;
  });

  ngOnInit(): void {
    this.loadSavedTheme();
  }

  updateToken(key: string, value: string): void {
    this.tokenState.update((tokens) =>
      tokens.map((token) => token.key === key ? { ...token, value: this.normalizeColor(value, token.value) } : token)
    );
  }

  applyPreset(preset: BrandPreset): void {
    this.tokenState.update((tokens) =>
      tokens.map((token) => preset.tokens[token.key] ? { ...token, value: preset.tokens[token.key] } : token)
    );
  }

  reset(): void {
    this.applyPreset(this.presets[0]);
    this.savedMessage.set('Default theme applied. Click Save Theme to keep it.');
  }

  saveTheme(): void {
    const payload = {
      tokens: this.tokenMap(),
      radius: this.radius,
      shadow: this.shadow,
      sidebarWidth: this.sidebarWidth,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem('auraDesignSystemTheme', JSON.stringify(payload));
    this.savedMessage.set('Theme saved and applied for this browser.');
  }

  copyCss(): void {
    navigator.clipboard?.writeText(this.cssOutput());
    this.savedMessage.set('CSS tokens copied.');
  }

  trackToken(_: number, token: BrandToken): string {
    return token.key;
  }

  private tokenMap(): Record<string, string> {
    return this.tokenState().reduce<Record<string, string>>((map, token) => {
      map[token.key] = token.value;
      return map;
    }, {});
  }

  private normalizeColor(value: string, fallback: string): string {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  }

  private loadSavedTheme(): void {
    try {
      const raw = localStorage.getItem('auraDesignSystemTheme');
      if (!raw) return;
      const saved = JSON.parse(raw) as { tokens?: Record<string, string>; radius?: number; shadow?: number; sidebarWidth?: number };
      if (saved.tokens) {
        this.tokenState.update((tokens) =>
          tokens.map((token) => saved.tokens?.[token.key] ? { ...token, value: saved.tokens[token.key] } : token)
        );
      }
      this.radius = Number(saved.radius || this.radius);
      this.shadow = Number(saved.shadow || this.shadow);
      this.sidebarWidth = Number(saved.sidebarWidth || this.sidebarWidth);
      this.savedMessage.set('Saved theme loaded.');
    } catch {
      this.savedMessage.set('');
    }
  }
}
