---
type: "query"
date: "2026-07-13T12:40:05.907284+00:00"
question: "staff app mein usko uske attendance ka yeh bhi aana chaiye kaunse time pe login kiya, kaunse time pe logged out kiya, and overtime ka calculation bhi hona chaiye"
contributor: "graphify"
outcome: "useful"
source_nodes: ["StaffAttendancePage", "StaffAppService", "staff-os.service.js"]
---

# Q: staff app mein usko uske attendance ka yeh bhi aana chaiye kaunse time pe login kiya, kaunse time pe logged out kiya, and overtime ka calculation bhi hona chaiye

## Answer

Expanded from original query via graph vocab: attendance, login, logout, staff, shift, calculate, duration, hour, payroll, time, timestamp, worked. The staff app already stores clockInAt and clockOutAt and the attendance table already has overtime_minutes. Implement automatic break-adjusted overtime in the shared staffOsService clock-out path using assigned schedule duration, expose derived workedMinutes in attendance reads, and show today plus 30-day attendance history and OT totals in StaffAttendancePage.

## Outcome

- Signal: useful

## Source Nodes

- StaffAttendancePage
- StaffAppService
- staff-os.service.js