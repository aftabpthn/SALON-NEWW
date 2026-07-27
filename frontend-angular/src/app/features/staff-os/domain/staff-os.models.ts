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
  columns?: string[];
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
      { title: 'Floor control', path: '/staff-enterprise/floor-control?date={today}', columns: ['staffId', 'staffName', 'scheduleStatus', 'shift1Start', 'shift1End', 'shift2Start', 'shift2End'] },
      { title: 'Roster coverage', path: '/staff/roster/coverage?{period}' },
      { title: 'Attendance report', path: '/staff/reports/attendance?{period}', columns: ['staffName', 'staffId', 'days', 'presentDays', 'workedMinutes', 'breakMinutes', 'lateMinutes', 'overtimeMinutes'] },
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
    actions: [
      { label: 'Add adjustment rule', icon: 'bi-plus-lg', route: '/staff/payroll?tab=setup&section=adjustments&create=1' },
      { label: 'Add statutory rule', icon: 'bi-shield-plus', route: '/staff/payroll?tab=setup&section=statutory' },
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
    endpoints: [
      { title: 'Fine rules', path: '/staff/payroll-adjustment-rules?kind=fine' },
      { title: 'Deduction rules', path: '/staff/payroll-adjustment-rules?kind=deduction' },
    ],
    actions: [
      { label: 'Add fine rule', icon: 'bi-plus-lg', route: '/staff/payroll?tab=setup&section=adjustments&kind=fine&create=1' },
      { label: 'Add deduction rule', icon: 'bi-dash-circle', route: '/staff/payroll?tab=setup&section=adjustments&kind=deduction&create=1' },
      { label: 'Apply staff fine', icon: 'bi-person-check', route: '/staff/attendance-summary' },
    ],
  },
  'target-incentive': {
    key: 'target-incentive',
    eyebrow: 'Performance',
    title: 'Target incentives',
    icon: 'bi-bullseye',
    endpoints: [
      { title: 'Incentive rules', path: '/staff/incentive-rules' },
      { title: 'Staff performance', path: '/staff/performance?date_from={periodStart}&date_to={periodEnd}' },
    ],
    actions: [{ label: 'Add incentive rule', icon: 'bi-plus-lg', route: '/staff/payroll?tab=setup&section=incentives' }],
  },
  leaderboard: {
    key: 'leaderboard',
    eyebrow: 'Performance',
    title: 'Leaderboard',
    icon: 'bi-trophy',
    endpoints: [
      { title: 'Command center ranking', path: '/staff-enterprise/command-center?{period}' },
      { title: 'Staff performance', path: '/staff/performance?date_from={periodStart}&date_to={periodEnd}' },
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
    actions: [
      { label: 'Assign training', icon: 'bi-plus-lg', postPath: '/staff-enterprise/training/assign', fields: [{ key: 'staffId', label: 'Staff ID' }, { key: 'title', label: 'Training title' }, { key: 'priority', label: 'Priority', value: 'medium' }] },
      { label: 'Add coaching goal', icon: 'bi-bullseye', postPath: '/staff/coach/goals', fields: [{ key: 'staffId', label: 'Staff ID' }, { key: 'goalType', label: 'Goal type' }, { key: 'metricUnit', label: 'Metric unit' }, { key: 'targetValue', label: 'Target value' }, { key: 'dueDate', label: 'Due date YYYY-MM-DD', value: '{today}' }, { key: 'actionTitle', label: 'Action title' }, { key: 'priority', label: 'Priority', value: 'medium' }] },
    ],
  },
  tasks: {
    key: 'tasks',
    eyebrow: 'Development',
    title: 'Tasks',
    icon: 'bi-list-check',
    endpoints: [
      {
        title: 'Service targets',
        path: '/staff/service-targets',
        columns: ['staffName', 'serviceName', 'targetCount', 'achievedCount', 'progressPercent', 'startsOn', 'endsOn', 'progressStatus', 'rewardType'],
      },
      {
        title: 'Manual tasks',
        path: '/staff/tasks',
        columns: ['staffName', 'title', 'description', 'taskType', 'priority', 'dueAt', 'status', 'createdAt'],
      },
    ],
    actions: [{ label: 'Add task', icon: 'bi-plus-lg', postPath: '/staff/tasks' }],
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
