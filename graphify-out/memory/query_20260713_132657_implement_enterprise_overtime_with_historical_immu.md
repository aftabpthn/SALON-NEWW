---
type: "query"
date: "2026-07-13T13:26:57.579695+00:00"
question: "Implement enterprise overtime with historical immutability, attendance rows, staff dashboard summaries, selected-period payroll, and one calculator across all attendance channels"
contributor: "graphify"
outcome: "useful"
source_nodes: ["StaffAttendancePage", "StaffDashboardPage", "StaffAppService", "StaffOsService", "SmartStaffService", "StaffBiometricService"]
---

# Q: Implement enterprise overtime with historical immutability, attendance rows, staff dashboard summaries, selected-period payroll, and one calculator across all attendance channels

## Answer

Expanded graph vocabulary: attendance, payroll, dashboard, biometric, mobile, sync, period, policy, schedule, shift, worked, break. Implemented standard-v1 in server/services/staff-overtime.service.js. New clock-ins create staffAttendanceOvertimeSnapshots; clock-out auto-closes active breaks, subtracts completed breaks and matched scheduled shift, clamps OT at zero, and preserves rows without snapshots. Online, offline and biometric paths converge through staff-os; legacy and admin eligible records use the same calculator. Dashboard summaries aggregate persisted OT for today, IST week, rolling 30 days and lifetime. Payroll and biometric previews aggregate only the selected period. Staff UI displays detailed attendance and realtime OT cards. Focused OT tests pass and customer build passes.

## Outcome

- Signal: useful

## Source Nodes

- StaffAttendancePage
- StaffDashboardPage
- StaffAppService
- StaffOsService
- SmartStaffService
- StaffBiometricService