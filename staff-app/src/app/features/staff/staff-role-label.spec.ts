import { describe, expect, it } from "vitest";
import { formatStaffRoleLabel } from "./staff-role-label";

describe("formatStaffRoleLabel", () => {
  it.each([
    ["STAFFAPPUSER", "Staff"],
    ["front_desk", "Front Desk"],
    ["SALON_MANAGER", "Salon Manager"],
    ["customSpecialist", "Custom Specialist"],
    ["SENIOR-STYLIST", "Senior Stylist"],
    ["", "Staff"]
  ])("formats %s as a user-facing label", (role, label) => {
    expect(formatStaffRoleLabel(role)).toBe(label);
  });
});
