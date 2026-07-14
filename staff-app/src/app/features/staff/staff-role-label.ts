const ROLE_LABELS: Readonly<Record<string, string>> = {
  admin: "Administrator",
  frontdesk: "Front Desk",
  manager: "Manager",
  owner: "Owner",
  receptionist: "Receptionist",
  salonmanager: "Salon Manager",
  seniorstylist: "Senior Stylist",
  staff: "Staff",
  staffappadmin: "Staff Administrator",
  staffappmanager: "Staff Manager",
  staffappuser: "Staff"
};

export function formatStaffRoleLabel(role: string | null | undefined): string {
  const source = String(role || "").trim();
  if (!source) return "Staff";
  const key = source.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  const words = source
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Staff";
}
