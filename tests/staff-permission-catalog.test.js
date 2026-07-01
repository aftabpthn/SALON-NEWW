import test from "node:test";
import assert from "node:assert/strict";
import { staffPermissionCatalog, permissionResources } from "../server/config/staff-permission-catalog.js";

const requiredLabels = [
  "Quicksale",
  "Book Services",
  "Export Option on reports",
  "Delete Product",
  "Campaigns",
  "Staff can assign permission",
  "Sales Graph"
];

test("staff permission catalog covers visible Salonist permission groups and labels", () => {
  const groupLabels = new Set(staffPermissionCatalog.map((item) => item.groupLabel));
  [
    "Dashboard",
    "Quicksale Permission",
    "Reports Permission",
    "Add & Delete",
    "Marketing Permission",
    "Micro Permission",
    "Micro Permission - Home Screen"
  ].forEach((label) => assert.equal(groupLabels.has(label), true, `${label} group should exist`));

  const labels = new Set(staffPermissionCatalog.map((item) => item.label));
  requiredLabels.forEach((label) => assert.equal(labels.has(label), true, `${label} permission should exist`));
});

test("staff permission catalog keeps stable resource and action mappings for high-risk controls", () => {
  assert.deepEqual(
    staffPermissionCatalog.find((item) => item.label === "Delete Product"),
    {
      groupKey: "add-delete",
      groupLabel: "Add & Delete",
      resource: "products",
      action: "delete",
      label: "Delete Product",
      category: "addDelete",
      uiTargets: ["/inventory/products"],
      apiTargets: ["DELETE /resources/products"]
    }
  );
  assert.equal(staffPermissionCatalog.find((item) => item.label === "Staff can assign permission")?.resource, "limited-permission-assignment");
  assert.equal(staffPermissionCatalog.find((item) => item.label === "Staff can assign permission")?.action, "allow");
  assert.equal(permissionResources.includes("limited-permission-assignment"), true);
});

