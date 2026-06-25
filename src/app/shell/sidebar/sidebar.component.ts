import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import * as THREE from 'three';
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
export class EnterpriseSidebarComponent implements AfterViewInit, OnDestroy {
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
  @ViewChild('threeContainer', { static: true }) threeContainer?: ElementRef<HTMLDivElement>;

  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private animationId?: number;
  private mouseX = 0;
  private mouseY = 0;

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

  ngAfterViewInit(): void {
    this.initThree();
  }

  ngOnDestroy(): void {
    this.destroyThree();
  }

  private initThree(): void {
    const container = this.threeContainer?.nativeElement;
    if (!container) return;

    const w = container.clientWidth || 292;
    const h = container.clientHeight || 400;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    this.camera.position.z = 18;

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    const count = 120;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10 - 2;
      sizes[i] = Math.random() * 2 + 0.5;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      color: 0x24a47e,
      size: 0.12,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const particles = new THREE.Points(geometry, material);
    this.scene.add(particles);

    const geo2 = new THREE.IcosahedronGeometry(1.2, 0);
    const mat2 = new THREE.MeshBasicMaterial({
      color: 0x24a47e,
      wireframe: true,
      transparent: true,
      opacity: 0.08,
    });
    const icosahedron = new THREE.Mesh(geo2, mat2);
    icosahedron.position.set(0, 0, -1);
    this.scene.add(icosahedron);
    const icoData = { mesh: icosahedron, rotX: 0.003, rotY: 0.005 };

    const geo3 = new THREE.TorusKnotGeometry(0.9, 0.3, 48, 8);
    const mat3 = new THREE.MeshBasicMaterial({
      color: 0x5b8def,
      wireframe: true,
      transparent: true,
      opacity: 0.05,
    });
    const knot = new THREE.Mesh(geo3, mat3);
    knot.position.set(2.5, -3, -2);
    this.scene.add(knot);
    const knotData = { mesh: knot, rotX: 0.004, rotY: -0.006 };

    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      particles.rotation.y += 0.0006;
      particles.rotation.x += 0.0003;
      icoData.mesh.rotation.x += icoData.rotX;
      icoData.mesh.rotation.y += icoData.rotY;
      knotData.mesh.rotation.x += knotData.rotX;
      knotData.mesh.rotation.y += knotData.rotY;
      if (this.camera) {
        this.camera.position.x += (this.mouseX * 0.5 - this.camera.position.x) * 0.02;
        this.camera.position.y += (-this.mouseY * 0.3 - this.camera.position.y) * 0.02;
        this.camera.lookAt(0, 0, 0);
      }
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    };
    animate();

    const onResize = () => {
      if (!this.renderer || !this.camera || !container) return;
      const cw = container.clientWidth || 292;
      const ch = container.clientHeight || 400;
      this.camera.aspect = cw / ch;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(cw, ch);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);
    (this.renderer as any).__ro = ro;
    (this.renderer as any).__particles = particles;
    (this.renderer as any).__icoData = icoData;
    (this.renderer as any).__knotData = knotData;
  }

  private destroyThree(): void {
    this.animationId && cancelAnimationFrame(this.animationId);
    if (this.renderer) {
      (this.renderer as any).__ro?.disconnect();
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    this.mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouseY = (event.clientY / window.innerHeight) * 2 - 1;
  }

  get groups() {
    return this.sidebar.group(this.navItems, this.store.search());
  }

  get favorites() {
    return this.sidebar.favorites(this.navItems, this.store.favorites(), this.store.search());
  }

  get recents() {
    return this.sidebar.recents(this.navItems, this.store.recents(), this.store.search());
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
