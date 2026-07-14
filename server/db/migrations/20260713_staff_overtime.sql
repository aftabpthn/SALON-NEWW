CREATE TABLE IF NOT EXISTS staffAttendanceOvertimeSnapshots (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  attendanceSource TEXT NOT NULL DEFAULT 'staff_attendance_logs',
  attendanceId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  businessDate TEXT NOT NULL,
  policyVersion TEXT NOT NULL DEFAULT 'standard-v1',
  scheduleId TEXT DEFAULT '',
  grossMinutes INTEGER DEFAULT 0,
  completedBreakMinutes INTEGER DEFAULT 0,
  workedMinutes INTEGER DEFAULT 0,
  scheduledMinutes INTEGER DEFAULT 0,
  overtimeMinutes INTEGER DEFAULT 0,
  calculationStatus TEXT DEFAULT 'eligible',
  reviewReason TEXT DEFAULT '',
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  completedAt TEXT,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenantId, attendanceSource, attendanceId)
);

CREATE INDEX IF NOT EXISTS idx_staff_overtime_snapshot_staff_date
  ON staffAttendanceOvertimeSnapshots(tenantId, branchId, staffId, businessDate);
