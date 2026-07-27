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
import { WhatsAppSimulator } from "@/components/landing/WhatsAppSimulator";
import { POSSandbox } from "@/components/landing/POSSandbox";
import { MultiBranchShowcase } from "@/components/landing/MultiBranchShowcase";
import { LiveActivityTicker } from "@/components/landing/LiveActivityTicker";
import { BeforeAfterSlider } from "@/components/landing/BeforeAfterSlider";
import { CompetitorMatrix } from "@/components/landing/CompetitorMatrix";
import { PersonalizedDemoModal } from "@/components/landing/PersonalizedDemoModal";
import { InstantQuotationModal } from "@/components/landing/InstantQuotationModal";
import { InteractiveFAQ } from "@/components/landing/InteractiveFAQ";
import { HardwareShowcase } from "@/components/landing/HardwareShowcase";

export default function HomePage() {
  return (
    <>
      <LiveActivityTicker />
      <Hero />
      <EcosystemSelector />
      <WorkflowNarrative compact />
      <WhatsAppSimulator />
      <POSSandbox />
      <BeforeAfterSlider />
      <RoleChapters />
      <ProductTour />
      <HardwareShowcase />
      <MultiBranchShowcase />
      <InstantQuotationModal />
      <ROICalculator />
      <CompetitorMatrix />
      <PersonalizedDemoModal />
      <InteractiveFAQ />
      <Stats />
      <Testimonials />
      <PricingPreview />
      <CTASection />
    </>
  );
}
