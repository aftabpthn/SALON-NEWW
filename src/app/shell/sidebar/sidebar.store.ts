import { Injectable, computed, effect, signal } from '@angular/core';

export type SidebarMode = 'expanded' | 'rail' | 'hidden';
export type SidebarTheme = 'system' | 'light' | 'dark' | 'high-contrast';

const STORAGE_KEY = 'aura.enterpriseSidebar.classic';

type PersistedSidebar = {
  mode?: SidebarMode;
  width?: number;
  theme?: SidebarTheme;
  expandedGroups?: string[];
  favorites?: string[];
  recents?: string[];
};

@Injectable({ providedIn: 'root' })
export class SidebarStore {
  private readonly initial = this.read();
  readonly mode = signal<SidebarMode>('expanded');
  readonly width = signal(this.clampWidth(this.initial.width || 292));
  readonly theme = signal<SidebarTheme>(this.initial.theme || 'dark');
  readonly search = signal('');
  readonly hoverPreview = signal(false);
  readonly expandedGroups = signal<Set<string>>(new Set(this.initial.expandedGroups || ['today', 'operate', 'ai']));
  readonly favorites = signal<string[]>(this.initial.favorites || ['/dashboard', '/command-center', '/appointments', '/pos']);
  readonly recents = signal<string[]>(this.initial.recents || []);

  readonly isRail = computed(() => this.mode() === 'rail');
  readonly visualWidth = computed(() => this.mode() === 'rail' ? 76 : this.width());
  readonly shellClass = computed(() => `sidebar-mode-${this.mode()}`);

  constructor() {
    effect(() => {
      const state: PersistedSidebar = {
        mode: this.mode(),
        width: this.width(),
        theme: this.theme(),
        expandedGroups: [...this.expandedGroups()],
        favorites: this.favorites(),
        recents: this.recents()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      document.documentElement.dataset.theme = this.theme();
    });
  }

  setMode(mode: SidebarMode): void {
    this.mode.set(mode);
  }

  toggleMode(): void {
    this.mode.update((mode) => mode === 'expanded' ? 'rail' : 'expanded');
  }

  setWidth(width: number): void {
    this.width.set(this.clampWidth(width));
    if (this.mode() !== 'expanded') this.mode.set('expanded');
  }

  snapWidth(): void {
    const points = [240, 280, 320, 380];
    const width = this.width();
    this.width.set(points.reduce((best, point) => Math.abs(point - width) < Math.abs(best - width) ? point : best, points[0]));
  }

  setSearch(value: string): void {
    this.search.set(value);
  }

  collapseTo(ids: string[]): void {
    this.expandedGroups.set(new Set(ids));
  }

  toggleGroup(id: string): void {
    const next = new Set(this.expandedGroups());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedGroups.set(next);
  }

  isGroupExpanded(id: string): boolean {
    return this.expandedGroups().has(id);
  }

  addRecent(path: string): void {
    if (!path) return;
    this.recents.update((items) => [path, ...items.filter((item) => item !== path)].slice(0, 8));
  }

  toggleFavorite(path: string): void {
    this.favorites.update((items) => items.includes(path) ? items.filter((item) => item !== path) : [path, ...items].slice(0, 10));
  }

  cycleTheme(): void {
    const order: SidebarTheme[] = ['dark', 'light', 'high-contrast', 'system'];
    const index = order.indexOf(this.theme());
    this.theme.set(order[(index + 1) % order.length]);
  }

  private clampWidth(width: number): number {
    return Math.min(380, Math.max(240, Number(width) || 292));
  }

  private read(): PersistedSidebar {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as PersistedSidebar;
    } catch {
      return {};
    }
  }
}
