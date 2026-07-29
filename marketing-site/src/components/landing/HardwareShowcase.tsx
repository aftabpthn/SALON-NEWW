"use client";

import { Printer, Scan, Smartphone, Monitor, ShieldCheck, CheckCircle2 } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

type Device = {
  name: string;
  type: string;
  specs: string;
  icon: typeof Printer;
};

const HARDWARE: Device[] = [
  { name: "Thermal Receipt Printers", type: "USB / Bluetooth / LAN", specs: "Works with Epson, Star, TVS, & Xprinter (80mm & 58mm)", icon: Printer },
  { name: "Barcode & QR Scanners", type: "Wireless 1D/2D", specs: "Instant product lookup & client QR check-in scanning", icon: Scan },
  { name: "Android Staff & Billing POS", type: "Mobile & Tablet", specs: "Runs on any Android phone, iPad, tablet, or handheld POS terminal", icon: Smartphone },
  { name: "Desktop & Touch Screen POS", type: "Windows & Mac & Web", specs: "Zero driver installation needed — opens directly in Chrome / Edge", icon: Monitor },
];

export function HardwareShowcase() {
  return (
    <section className="bg-aura-dark py-20 text-white md:py-28 overflow-hidden">
      <Container>
        <SectionHeading
          badge="Hardware Plug & Play"
          title="Works with Your Existing Salon Printers & Devices"
          subtitle="No expensive proprietary hardware locks. Aura connects seamlessly with thermal printers, barcode scanners, and tablets you already own."
          align="center"
          className="[&_h2]:text-white [&_p]:text-white/60 [&>span]:text-aura-copper"
        />

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {HARDWARE.map((device, idx) => {
            const Icon = device.icon;
            return (
              <div
                key={idx}
                className="rounded-3xl border border-white/10 bg-white/5 p-6 hover:bg-white/10 transition-colors shadow-lg flex flex-col justify-between"
              >
                <div>
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-aura-burgundy text-white mb-4">
                    <Icon className="h-6 w-6" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-aura-copper">{device.type}</span>
                  <h3 className="text-base font-bold text-white mt-1">{device.name}</h3>
                  <p className="text-xs text-white/60 mt-2 leading-5">{device.specs}</p>
                </div>
                <div className="mt-6 flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 border-t border-white/10 pt-3">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Setup requirements confirmed in proposal
                </div>
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
