"use client";

import { useState } from "react";
import { Building2, TrendingUp, Users, Package, ArrowUpRight, CheckCircle } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

type BranchData = {
  id: string;
  name: string;
  city: string;
  todayRevenue: string;
  appointments: number;
  activeStaff: number;
  stockStatus: string;
};

const BRANCHES: BranchData[] = [
  { id: "b1", name: "Bandra West Flagship", city: "Mumbai", todayRevenue: "₹1,48,200", appointments: 42, activeStaff: 12, stockStatus: "Optimal (98%)" },
  { id: "b2", name: "Indiranagar Salon & Spa", city: "Bengaluru", todayRevenue: "₹1,12,500", appointments: 36, activeStaff: 9, stockStatus: "Optimal (95%)" },
  { id: "b3", name: "Jubilee Hills Luxury", city: "Hyderabad", todayRevenue: "₹1,85,400", appointments: 51, activeStaff: 15, stockStatus: "Low Stock Alert (3 items)" },
  { id: "b4", name: "Connaught Place Central", city: "New Delhi", todayRevenue: "₹1,24,000", appointments: 38, activeStaff: 10, stockStatus: "Optimal (97%)" },
];

export function MultiBranchShowcase() {
  const [selectedBranch, setSelectedBranch] = useState<BranchData>(BRANCHES[0]);

  return (
    <section className="bg-aura-surface py-20 md:py-28 overflow-hidden">
      <Container>
        <SectionHeading
          badge="Enterprise Chain Management"
          title="Manage 1 or 50+ Salon Branches from One Screen"
          subtitle="Real-time multi-location sales aggregation, staff transfer, cross-branch booking, and centralized inventory control."
        />

        {/* Branch Pills Switcher */}
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {BRANCHES.map((branch) => (
            <button
              key={branch.id}
              type="button"
              onClick={() => setSelectedBranch(branch)}
              className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold transition-all ${
                selectedBranch.id === branch.id
                  ? "bg-aura-burgundy text-white shadow-md scale-105"
                  : "border border-aura-border bg-white text-aura-text hover:bg-aura-surface-muted"
              }`}
            >
              <Building2 className="h-4 w-4" />
              <span>{branch.name} ({branch.city})</span>
            </button>
          ))}
        </div>

        {/* Interactive Stats Dashboard Card */}
        <div className="mt-10 mx-auto max-w-4xl rounded-3xl border border-aura-border bg-white p-6 md:p-8 shadow-xl">
          <div className="flex flex-wrap items-center justify-between border-b border-aura-border pb-4 gap-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-aura-burgundy">Active Branch View</span>
              <h3 className="text-xl font-display font-bold text-aura-text">{selectedBranch.name}</h3>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5" /> Synchronized IST
            </span>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-aura-surface-muted p-4 border border-aura-border">
              <div className="flex items-center justify-between text-aura-text-secondary">
                <span className="text-xs font-semibold">Today's Revenue</span>
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="mt-2 text-2xl font-display font-bold text-aura-text">{selectedBranch.todayRevenue}</p>
              <p className="mt-1 text-[10px] text-emerald-600 font-bold">+18.4% vs last week</p>
            </div>

            <div className="rounded-2xl bg-aura-surface-muted p-4 border border-aura-border">
              <div className="flex items-center justify-between text-aura-text-secondary">
                <span className="text-xs font-semibold">Appointments</span>
                <Users className="h-4 w-4 text-aura-burgundy" />
              </div>
              <p className="mt-2 text-2xl font-display font-bold text-aura-text">{selectedBranch.appointments} Bookings</p>
              <p className="mt-1 text-[10px] text-aura-text-secondary font-bold">100% Digital Checked-in</p>
            </div>

            <div className="rounded-2xl bg-aura-surface-muted p-4 border border-aura-border">
              <div className="flex items-center justify-between text-aura-text-secondary">
                <span className="text-xs font-semibold">Active Staff</span>
                <Users className="h-4 w-4 text-blue-600" />
              </div>
              <p className="mt-2 text-2xl font-display font-bold text-aura-text">{selectedBranch.activeStaff} Stylists</p>
              <p className="mt-1 text-[10px] text-blue-600 font-bold">Mobile Attendance Synced</p>
            </div>

            <div className="rounded-2xl bg-aura-surface-muted p-4 border border-aura-border">
              <div className="flex items-center justify-between text-aura-text-secondary">
                <span className="text-xs font-semibold">Inventory Recipes</span>
                <Package className="h-4 w-4 text-purple-600" />
              </div>
              <p className="mt-2 text-sm font-bold text-aura-text">{selectedBranch.stockStatus}</p>
              <p className="mt-1 text-[10px] text-purple-600 font-bold">WMA Costing Enabled</p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
