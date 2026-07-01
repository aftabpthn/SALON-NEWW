export interface CommandCenterMetric {
  label: string;
  value: string;
  tone: 'neutral' | 'good' | 'warning' | 'critical';
}

export interface CommandCenterRecord {
  id?: string;
  status?: string;
  riskLevel?: string;
  severity?: string;
  title?: string;
  summary?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export type CommandCenterModule =
  | 'ai-workforce'
  | 'ai-ceo'
  | 'approval-hub'
  | 'model-router'
  | 'event-ledger'
  | 'war-room'
  | 'revenue-leaks'
  | 'digital-twin'
  | 'digital-twin-v2'
  | 'owner-command'
  | 'whatsapp-campaign'
  | 'customer-super-graph'
  | 'client-memory'
  | 'voice-receptionist'
  | 'computer-vision'
  | 'whatsapp-commerce'
  | 'owner-mobile'
  | 'franchise-os'
  | 'financial-brain'
  | 'marketplace'
  | 'cloud-hardening'
  | 'inventory-autopilot'
  | 'payment-intelligence'
  | 'observability'
  | 'security-hardening'
  | 'warehouse';

export interface CommandCenterConfig {
  module: CommandCenterModule;
  title: string;
  subtitle?: string;
  primaryEndpoint: string;
  secondaryEndpoint?: string;
  actionEndpoint?: string;
  actionLabel?: string;
}
