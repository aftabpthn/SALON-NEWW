"use client";

import { FEATURE_PAGES } from "@/lib/constants";
import { FeaturePageTemplate } from "@/components/features/FeaturePageTemplate";

export default function AppointmentsPage() {
  return <FeaturePageTemplate data={FEATURE_PAGES["appointments"]} />;
}
