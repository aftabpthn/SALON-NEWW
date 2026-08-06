"use client";

import { useState } from "react";
import { Receipt, Plus, Trash2, CheckCircle2, ShieldCheck, Printer, ArrowRight, Sparkles } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

type ServiceItem = {
  id: string;
  name: string;
  category: string;
  price: number;
};

const AVAILABLE_SERVICES: ServiceItem[] = [
  { id: "s1", name: "Stylist Haircut & Blowdry", category: "Hair", price: 1200 },
  { id: "s2", name: "Keratin Gloss Spa Treatment", category: "Hair", price: 2800 },
  { id: "s3", name: "Olaplex Hair Repair Add-on", category: "Add-on", price: 1500 },
  { id: "s4", name: "Radiance Facial Spa", category: "Skin", price: 2200 },
  { id: "s5", name: "Beard Trim & Hot Towel", category: "Grooming", price: 600 },
];

export function POSSandbox() {
  const [cart, setCart] = useState<ServiceItem[]>([AVAILABLE_SERVICES[0], AVAILABLE_SERVICES[1]]);
  const [gstEnabled, setGstEnabled] = useState(true);
  const [printed, setPrinted] = useState(false);

  const addItem = (item: ServiceItem) => {
    setCart((prev) => [...prev, item]);
    setPrinted(false);
  };

  const removeItem = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
    setPrinted(false);
  };

  const subtotal = cart.reduce((acc, item) => acc + item.price, 0);
  const gstAmount = gstEnabled ? Math.round(subtotal * 0.18) : 0;
  const total = subtotal + gstAmount;

  return (
    <section className="bg-aura-dark py-20 text-white md:py-28 overflow-hidden">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[.45fr_.55fr] lg:items-center">
          {/* Left Info */}
          <div>
            <SectionHeading
              badge="Express POS Terminal"
              title="Checkout & Billing in Under 10 Seconds"
              subtitle="Designed for fast-moving front desks. Print GST invoices, track staff attribution, and connect inventory records without an unsupported latency promise."
              align="left"
              className="[&_h2]:text-white [&_p]:text-white/60 [&>span]:text-aura-copper"
            />
            <div className="mt-8 space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-aura-burgundy text-white font-bold text-xs">
                  ⚡
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Instant WhatsApp + Print Receipt</h4>
                  <p className="text-[11px] text-white/50">Auto-sends digital bills to client WhatsApp while printing thermal paper receipts.</p>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white font-bold text-xs">
                  ₹
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Split Payments & Dual QR Code</h4>
                  <p className="text-[11px] text-white/50">Accept Cash, UPI, Credit Cards, and Loyalty Points in a single bill transaction.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Live Clickable POS Sandbox UI */}
          <div className="overflow-hidden rounded-3xl border border-white/15 bg-aura-bg text-aura-text shadow-2xl p-5 md:p-6">
            <div className="flex items-center justify-between border-b border-aura-border pb-4">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-aura-burgundy" />
                <span className="font-display text-lg font-bold">Express POS Terminal</span>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-aura-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={gstEnabled}
                  onChange={(e) => setGstEnabled(e.target.checked)}
                  className="rounded border-aura-border text-aura-burgundy focus:ring-aura-burgundy"
                />
                <span>GST (18%)</span>
              </label>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {/* Service Catalog Picker */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-aura-text-muted mb-2">Tap to Add Service</p>
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {AVAILABLE_SERVICES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addItem(item)}
                      className="w-full flex items-center justify-between rounded-xl border border-aura-border bg-white p-3 text-left transition-transform hover:scale-[1.02] active:scale-98 shadow-sm"
                    >
                      <div>
                        <p className="text-xs font-bold text-aura-text">{item.name}</p>
                        <p className="text-[10px] text-aura-text-secondary">{item.category}</p>
                      </div>
                      <span className="text-xs font-bold text-aura-burgundy flex items-center gap-1">
                        +₹{item.price}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Cart & Billing Summary */}
              <div className="flex flex-col justify-between rounded-2xl bg-white border border-aura-border p-4 shadow-sm">
                <div>
                  <div className="flex items-center justify-between pb-2 border-b border-aura-border">
                    <span className="text-xs font-bold text-aura-text">Current Invoice</span>
                    <span className="text-[10px] text-aura-text-muted">{cart.length} Services</span>
                  </div>

                  <div className="mt-3 space-y-2 max-h-[140px] overflow-y-auto">
                    {cart.length === 0 ? (
                      <p className="text-center py-6 text-xs text-aura-text-muted">Tap a service on the left to add to bill.</p>
                    ) : (
                      cart.map((item, idx) => (
                        <div key={`${item.id}-${idx}`} className="flex items-center justify-between text-xs">
                          <span className="truncate pr-2 font-medium text-aura-text">{item.name}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-bold text-aura-text">₹{item.price}</span>
                            <button
                              type="button"
                              onClick={() => removeItem(idx)}
                              className="text-red-400 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Calculation Totals */}
                <div className="pt-3 border-t border-aura-border space-y-1.5 text-xs">
                  <div className="flex justify-between text-aura-text-secondary">
                    <span>Subtotal</span>
                    <span>₹{subtotal}</span>
                  </div>
                  {gstEnabled && (
                    <div className="flex justify-between text-aura-text-secondary">
                      <span>GST (18%)</span>
                      <span>+₹{gstAmount}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-sm text-aura-burgundy pt-1 border-t border-aura-border">
                    <span>Total Payable</span>
                    <span>₹{total}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPrinted(true)}
                    className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-aura-burgundy py-2.5 text-xs font-bold text-white shadow-md hover:bg-aura-burgundy-strong transition-colors"
                  >
                    <Printer className="h-4 w-4" />
                    <span>{printed ? "Receipt Generated ✓" : "Generate & Print Invoice"}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
