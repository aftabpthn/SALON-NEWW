"use client";

import { FEATURE_PAGES } from "@/lib/constants";
import { FeaturePageTemplate } from "@/components/features/FeaturePageTemplate";

export default function BillingPage() {
  return <FeaturePageTemplate data={FEATURE_PAGES["billing"]} />;
}
