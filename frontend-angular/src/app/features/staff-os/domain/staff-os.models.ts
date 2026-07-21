export type StaffOsRow = Record<string, unknown>;

export type StaffOsAction = {
  label: string;
  icon: string;
  route?: string;
  postPath?: string;
  fields?: Array<{ key: string; label: string; value?: string }>;
};

export type StaffOsEndpoint = {
  title: string;
  path: string;
};

export type StaffOsViewConfig = {
  key: string;
  eyebrow: string;
  title: string;
  icon: string;
  endpoints: StaffOsEndpoint[];
  actions?: StaffOsAction[];
};

export type StaffOsSection = StaffOsEndpoint & {
  rows: StaffOsRow[];
  summary: Array<{ key: string; value: unknown }>;
  columns: string[];
  error?: string;
};

export const STAFF_OS_VIEWS: Record<string, StaffOsViewConfig> = {
  'face-punch': {
    key: 'face-punch',
    eyebrow: 'Attendance',
    title: 'Face punch',
    icon: 'bi-fingerprint',
    endpoints: [
      { title: 'Biometric events', path: '/staff/biometric/events' },
      { title: 'Biometric exceptions', path: '/staff/biometric/exceptions' },
    ],
    actions: [
      { label: 'Clock in', icon: 'bi-box-arrow-in-right', postPath: '/staff-attendance/clock-in', fields: [{ key: 'staffId', label: 'Staff ID' }, { key: 'businessDate', label: 'Business date', value: '{today}' }, { key: 'source', label: 'Source', value: 'manual' }] },
      { label: 'Clock out', icon: 'bi-box-arrow-right', postPath: '/staff-attendance/clock-out', fields: [{ key: 'staffId', label: 'Staff ID' }, { key: 'businessDate', label: 'Business date', value: '{today}' }] },
    ],
  },
  heatmaps: {
    key: 'heatmaps',
    eyebrow: 'Workforce',
    title: 'Staff heatmaps',
    icon: 'bi-grid-3x3-gap',
    endpoints: [
      { title: 'Floor control', path: '/staff-enterprise/floor-control?date={today}' },
      { title: 'Roster coverage', path: '/staff/roster/coverage?{period}' },
      { title: 'Attendance report', path: '/staff/reports/attendance?{period}' },
    ],
  },
  'salary-structure': {
    key: 'salary-structure',
    eyebrow: 'Payroll',
    title: 'Salary structure',
    icon: 'bi-cash-coin',
    endpoints: [
      { title: 'Payroll structure', path: '/staff/payroll-structure' },
      { title: 'Employees', path: '/staff/list?page=1&pageSize=100&active=true&sortBy=firstName&sortDirection=asc' },
    ],
  },
  'salary-rules': {
    key: 'salary-rules',
    eyebrow: 'Payroll',
    title: 'Salary rules',
    icon: 'bi-sliders',
    endpoints: [
      { title: 'Payroll adjustment rules', path: '/staff/payroll-adjustment-rules' },
      { title: 'Statutory payroll rules', path: '/staff/payroll-compliance/rules' },
    ],
  },
  'salary-history': {
    key: 'salary-history',
    eyebrow: 'Payroll',
    title: 'Salary history',
    icon: 'bi-clock-history',
    endpoints: [
      { title: 'Payroll runs', path: '/staff-payroll/runs' },
      { title: 'Salary revisions', path: '/staff/salary-revisions' },
    ],
    actions: [{ label: 'Open Payroll', icon: 'bi-wallet2', route: '/staff/payroll' }],
  },
  'fines-deductions': {
    key: 'fines-deductions',
    eyebrow: 'Payroll',
    title: 'Fines & deductions',
    icon: 'bi-receipt-cutoff',
    endpoints: [{ title: 'Deduction rules', path: '/staff/payroll-adjustment-rules?kind=deduction' }],
  },
  'target-incentive': {
    key: 'target-incentive',
    eyebrow: 'Performance',
    title: 'Target incentives',
    icon: 'bi-bullseye',
    endpoints: [
      { title: 'Incentive rules', path: '/staff/incentive-rules' },
      { title: 'Staff performance', path: '/staff/performance' },
    ],
  },
  leaderboard: {
    key: 'leaderboard',
    eyebrow: 'Performance',
    title: 'Leaderboard',
    icon: 'bi-trophy',
    endpoints: [
      { title: 'Command center ranking', path: '/staff-enterprise/command-center?{period}' },
      { title: 'Staff performance', path: '/staff/performance' },
    ],
  },
  training: {
    key: 'training',
    eyebrow: 'Development',
    title: 'Training',
    icon: 'bi-mortarboard',
    endpoints: [
      { title: 'Training assignments', path: '/staff-enterprise/training' },
      { title: 'Coaching goals', path: '/staff/coach/goals' },
    ],
  },
  tasks: {
    key: 'tasks',
    eyebrow: 'Development',
    title: 'Tasks',
    icon: 'bi-list-check',
    endpoints: [{ title: 'Staff tasks', path: '/staff/tasks' }],
  },
  'mobile-preview': {
    key: 'mobile-preview',
    eyebrow: 'Mobile',
    title: 'Mobile preview',
    icon: 'bi-phone',
    endpoints: [
      { title: 'Self-service dashboard', path: '/staff/self/dashboard?date={today}' },
      { title: 'Mobile conflicts', path: '/staff/mobile/conflicts?status=open' },
    ],
    actions: [
      { label: 'Staff Kiosk', icon: 'bi-fingerprint', route: '/staff-os/face-punch' },
      { label: 'Customer Kiosk', icon: 'bi-person-badge', route: '/clients' },
      { label: 'Team Chat', icon: 'bi-chat-dots', route: '/notifications' },
    ],
  },
};
