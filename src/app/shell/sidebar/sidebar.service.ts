import { Injectable } from '@angular/core';

export type EnterpriseNavItem = {
  path: string;
  label: string;
  icon: string;
};

export type SidebarGroup = {
  id: string;
  label: string;
  hint: string;
  accent: 'green' | 'amber' | 'coral' | 'blue' | 'neutral';
  items: EnterpriseNavItem[];
};

type GroupConfig = {
  id: string;
  label: string;
  hint: string;
  accent: SidebarGroup['accent'];
  paths: string[];
};

const GROUPS: GroupConfig[] = [
  {
    id: 'today',
    label: 'Today',
    hint: 'Live floor',
    accent: 'green',
    paths: ['/dashboard', '/appointments', '/pos', '/smart-booking', '/queue-system', '/booking-portal']
  },
  {
    id: 'operate',
    label: 'Operate',
    hint: 'Core salon ops',
    accent: 'neutral',
    paths: ['/clients', '/customer-360', '/staff', '/staff-os', '/inventory', '/services', '/memberships', '/packages']
  },
  {
    id: 'ai',
    label: 'AI Command',
    hint: 'Autonomous control',
    accent: 'coral',
    paths: ['/command-center', '/ai', '/future-features', '/growth-advisor', '/recommendation-engine', '/predictive-forecasting', '/knowledge-base']
  },
  {
    id: 'grow',
    label: 'Grow',
    hint: 'Marketing engine',
    accent: 'amber',
    paths: ['/marketing', '/whatsapp', '/message-logs', '/reputation', '/dynamic-pricing', '/gamification']
  },
  {
    id: 'manage',
    label: 'Manage',
    hint: 'Finance and control',
    accent: 'blue',
    paths: ['/finance', '/billing', '/commissions', '/reports', '/reports/enterprise', '/analytics', '/data-warehouse', '/kpi-monitoring', '/audit-logs']
  },
  {
    id: 'admin',
    label: 'Admin',
    hint: 'SaaS and platform',
    accent: 'neutral',
    paths: ['/super-admin', '/saas', '/branches', '/settings', '/permissions', '/security', '/compliance', '/deployment', '/data-migration', '/marketplace-integrations', '/plugins', '/app-marketplace']
  }
];

@Injectable({ providedIn: 'root' })
export class SidebarService {
  group(items: EnterpriseNavItem[], query = ''): SidebarGroup[] {
    const lookup = new Map(items.map((item) => [item.path, item]));
    const used = new Set<string>();
    const groups = GROUPS.map((config) => {
      const grouped = config.paths
        .map((path) => lookup.get(path))
        .filter((item): item is EnterpriseNavItem => Boolean(item));
      grouped.forEach((item) => used.add(item.path));
      return { id: config.id, label: config.label, hint: config.hint, accent: config.accent, items: grouped };
    });
    const more = items.filter((item) => !used.has(item.path));
    if (more.length) {
      groups.push({ id: 'more', label: 'More', hint: 'All modules', accent: 'neutral', items: more });
    }
    return this.filter(groups, query);
  }

  favorites(items: EnterpriseNavItem[], paths: string[], query = ''): EnterpriseNavItem[] {
    const lookup = new Map(items.map((item) => [item.path, item]));
    return this.filterItems(paths.map((path) => lookup.get(path)).filter((item): item is EnterpriseNavItem => Boolean(item)), query);
  }

  recents(items: EnterpriseNavItem[], paths: string[], query = ''): EnterpriseNavItem[] {
    const lookup = new Map(items.map((item) => [item.path, item]));
    return this.filterItems(paths.map((path) => lookup.get(path)).filter((item): item is EnterpriseNavItem => Boolean(item)), query).slice(0, 5);
  }

  private filter(groups: SidebarGroup[], query: string): SidebarGroup[] {
    if (!query.trim()) return groups;
    return groups
      .map((group) => ({ ...group, items: this.filterItems(group.items, query) }))
      .filter((group) => group.items.length);
  }

  groupForPath(path: string): string[] {
    const matched = GROUPS.filter((g) => g.paths.some((p) => path.startsWith(p)));
    return matched.length ? matched.map((g) => g.id) : ['more'];
  }

  private filterItems(items: EnterpriseNavItem[], query: string): EnterpriseNavItem[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => `${item.label} ${item.path}`.toLowerCase().includes(normalized));
  }
}
