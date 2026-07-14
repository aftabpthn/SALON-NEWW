---
type: "query"
date: "2026-07-13T12:51:35.326036+00:00"
question: "Implement enterprise overtime for attendance rows, staff dashboard, payroll-period-only usage, historical immutability, and one calculator across all attendance channels"
contributor: "graphify"
outcome: "useful"
source_nodes: ["StaffAttendancePage", "StaffDashboardPage", "StaffAppService", "StaffOsService", "SmartStaffService", "StaffBiometricService"]
---

# Q: Implement enterprise overtime for attendance rows, staff dashboard, payroll-period-only usage, historical immutability, and one calculator across all attendance channels

## Answer

Expanded vocabulary: attendance, payroll, dashboard, biometric, mobile, sync, period, policy, schedule, shift, worked, break. Use a new versioned staff overtime service as the only calculator. New clock-ins receive an eligibility/audit snapshot; only those rows are calculated and persisted at clock-out. Existing rows and OT values remain untouched. Online, offline and biometric clock-out converge in staff-os closeAttendance. Dashboard summaries aggregate persisted OT for today, IST week, rolling 30 days and lifetime; payroll uses only explicit selected-period aggregation. Legacy smart-staff creation calls the same pure calculator. Customer attendance rows expose worked, completed breaks, scheduled duration and persisted OT, with realtime refresh through the existing socket.

## Outcome

- Signal: useful

## Source Nodes

- StaffAttendancePage
- StaffDashboardPage
- StaffAppService
- StaffOsService
- SmartStaffService
- StaffBiometricService