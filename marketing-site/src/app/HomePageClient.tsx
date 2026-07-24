"use client";

import { Hero } from "@/components/landing/Hero";
import { Stats } from "@/components/landing/Stats";
import { Testimonials } from "@/components/landing/Testimonials";
import { PricingPreview } from "@/components/landing/PricingPreview";
import { CTASection } from "@/components/landing/CTASection";
import { ROICalculator } from "@/components/landing/ROICalculator";
import { EcosystemSelector } from "@/components/landing/EcosystemSelector";
import { WorkflowNarrative } from "@/components/landing/WorkflowNarrative";
import { RoleChapters } from "@/components/landing/RoleChapters";
import { ProductTour } from "@/components/landing/ProductTour";

export default function HomePage() {
  return (
    <>
      <Hero />
      <EcosystemSelector />
      <WorkflowNarrative compact />
      <RoleChapters />
      <ProductTour />
      <ROICalculator />
      <Stats />
      <Testimonials />
      <PricingPreview />
      <CTASection />
    </>
  );
}
