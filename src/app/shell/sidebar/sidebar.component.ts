import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Subject, filter, takeUntil } from 'rxjs';
import { AppStateService, UserRole } from '../../core/state/app-state.service';
import { WebSocketService } from '../../core/websocket.service';
import { EnterpriseNavItem, SidebarService } from './sidebar.service';
import { SidebarStore } from './sidebar.store';

type ScopeRecord = {
  id?: string;
  name?: string;
  [key: string]: unknown;
};

@Component({
  selector: 'app-enterprise-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css']
})
export class EnterpriseSidebarComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  @Input() navItems: EnterpriseNavItem[] = [];
  @Input() tenants: ScopeRecord[] = [];
  @Input() branches: ScopeRecord[] = [];
  @Input() selectedTenantId = 'tenant_aura';
  @Input() selectedBranchId = '';
  @Input() userRole: UserRole = 'owner';
  @Input() tenantScopeLabel = 'tenant_aura';
  @Output() tenantChange = new EventEmitter<string>();
  @Output() branchChange = new EventEmitter<string>();
  @Output() roleChange = new EventEmitter<UserRole>();
  @Output() logout = new EventEmitter<void>();
  @ViewChild('sidebarSearch') sidebarSearch?: ElementRef<HTMLInputElement>;

  resizing = false;
  private resizeStartX = 0;
  private resizeStartWidth = 292;

  readonly roles: UserRole[] = ['owner', 'superAdmin', 'admin', 'manager', 'receptionist', 'frontDesk', 'staff', 'accountant', 'inventoryManager', 'analyst', 'customMarketingLead'];
  readonly railItems = [
    { label: 'Home', path: '/dashboard', icon: 'H' },
    { label: 'Calendar', path: '/appointments', icon: 'C' },
    { label: 'POS', path: '/pos', icon: 'P' },
    { label: 'Clients', path: '/clients', icon: 'U' },
    { label: 'AI', path: '/command-center', icon: 'AI' },
    { label: 'Staff', path: '/staff-os', icon: 'S' },
    { label: 'Reports', path: '/reports', icon: 'R' },
    { label: 'More', path: '/settings', icon: 'M' }
  ];

  constructor(
    readonly store: SidebarStore,
    readonly sidebar: SidebarService,
    readonly state: AppStateService,
    readonly realtime: WebSocketService,
    private readonly router: Router
  ) {}

  get groups() {
    return this.sidebar.group(this.navItems, this.store.search());
  }

  get favorites() {
    return this.sidebar.favorites(this.navItems, this.store.favorites(), this.store.search());
  }

  get recents() {
    return this.sidebar.recents(this.navItems, this.store.recents(), this.store.search());
  }

  ngOnInit(): void {
    this.syncExpanded(this.router.url);
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntil(this.destroy$)).subscribe((e) => this.syncExpanded(e.urlAfterRedirects));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private syncExpanded(url: string): void {
    this.store.collapseTo(this.sidebar.groupForPath(url));
  }

  navigate(path: string): void {
    this.store.addRecent(path);
  }

  trackItem(_index: number, item: EnterpriseNavItem): string {
    return item.path;
  }

  trackGroup(_index: number, group: { id: string }): string {
    return group.id;
  }

  isFavorite(path: string): boolean {
    return this.store.favorites().includes(path);
  }

  roleLabel(role: string): string {
    return role.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
  }

  startResize(event: PointerEvent): void {
    this.resizing = true;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.store.width();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  resize(event: PointerEvent): void {
    if (!this.resizing) return;
    this.store.setWidth(this.resizeStartWidth + event.clientX - this.resizeStartX);
  }

  endResize(): void {
    if (!this.resizing) return;
    this.resizing = false;
    this.store.snapWidth();
  }

  focusSearch(): void {
    this.store.setMode('expanded');
    queueMicrotask(() => this.sidebarSearch?.nativeElement.focus());
  }

  openCommandCenter(): void {
    this.router.navigateByUrl('/command-center');
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const inInput = ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName || '');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      this.store.toggleMode();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.openCommandCenter();
      return;
    }
    if (!inInput && event.key === '/') {
      event.preventDefault();
      this.focusSearch();
    }
  }
}
