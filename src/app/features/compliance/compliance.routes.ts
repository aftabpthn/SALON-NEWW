import { Route, Routes } from '@angular/router';
import { ComplianceRouteMeta } from './domain/compliance.models';

const page = (path: string, meta: ComplianceRouteMeta): Route => ({
  path,
  loadComponent: () => import('./pages/compliance-section.page').then((m) => m.ComplianceSectionPage),
  data: { meta },
  title: meta.title
});

export const COMPLIANCE_ROUTES: Routes = [
  page('', {
    title: 'Statutory Compliance Dashboard',
    module: 'dashboard',
    primaryAction: 'Refresh status'
  }),
  page('pf', {
    title: 'Provident Fund Management',
    module: 'pf',
    primaryAction: 'Calculate PF batch'
  }),
  page('esi', {
    title: 'ESI Management',
    module: 'esi',
    primaryAction: 'Calculate ESI batch'
  }),
  page('pt', {
    title: 'Professional Tax',
    module: 'pt',
    primaryAction: 'Generate PT return'
  }),
  page('tds', {
    title: 'TDS Section 192',
    module: 'tds',
    primaryAction: 'Compare regimes'
  }),
  page('tax-declaration', {
    title: 'Tax Declaration',
    module: 'tds',
    primaryAction: 'Submit declaration'
  }),
  page('proof-verification', {
    title: 'Proof Verification',
    module: 'tds',
    primaryAction: 'Verify proofs'
  }),
  page('gratuity', {
    title: 'Gratuity Tracker',
    module: 'gratuity',
    primaryAction: 'Provision monthly'
  }),
  page('bonus', {
    title: 'Bonus Calculator',
    module: 'bonus',
    primaryAction: 'Calculate bonus'
  }),
  page('form-16', {
    title: 'Form 16 Generator',
    module: 'tds',
    primaryAction: 'Generate Form 16'
  }),
  page('form-24q', {
    title: 'Form 24Q Generator',
    module: 'tds',
    primaryAction: 'Generate 24Q'
  }),
  page('calendar', {
    title: 'Compliance Calendar',
    module: 'calendar',
    primaryAction: 'View deadlines'
  }),
  page('reports', {
    title: 'Compliance Reports',
    module: 'reports',
    primaryAction: 'Export report'
  }),
  page('fy-closure', {
    title: 'FY Closure',
    module: 'fy',
    primaryAction: 'Check FY status'
  })
];
