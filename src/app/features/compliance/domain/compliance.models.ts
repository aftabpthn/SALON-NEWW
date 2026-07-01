export interface ComplianceModuleSummary {
  pending?: number;
  total?: number;
  totalEmployee?: number;
  totalEmployer?: number;
}

export interface ComplianceDeadline {
  key: string;
  label: string;
  dueRule: string;
  module: string;
  status: string;
}

export interface ComplianceDashboard {
  ok: boolean;
  fy: string;
  asOf: string;
  modules: Record<string, ComplianceModuleSummary>;
  complianceScore: number;
  upcomingDeadlines: ComplianceDeadline[];
}

export interface ComplianceRouteMeta {
  title: string;
  subtitle?: string;
  module: string;
  primaryAction: string;
}
