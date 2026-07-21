import { staffOsService } from "./staff-os.service.js";
import { assertStaffAttendanceVerification } from "./attendance-verification-policy.service.js";

const attendanceMethods = {
  clockIn(payload = {}, access = {}) {
    assertStaffAttendanceVerification(payload, access, "clock_in");
    return staffOsService.clockIn(payload, access);
  },
  clockOut(payload = {}, access = {}) {
    assertStaffAttendanceVerification(payload, access, "clock_out");
    return staffOsService.clockOut(payload, access);
  }
};

export const staffAttendanceService = new Proxy(staffOsService, {
  get(target, property) {
    if (Object.hasOwn(attendanceMethods, property)) return attendanceMethods[property];
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  }
});
