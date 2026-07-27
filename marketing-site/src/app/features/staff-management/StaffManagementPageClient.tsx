"use client";

import { FEATURE_PAGES } from "@/lib/constants";
import { FeaturePageTemplate } from "@/components/features/FeaturePageTemplate";

export default function StaffManagementPage() {
  return <FeaturePageTemplate data={FEATURE_PAGES["staff-management"]} />;
}
