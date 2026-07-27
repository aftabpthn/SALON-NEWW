"use client";

import { useState } from "react";
import { MessageSquare, PhoneCall, Sparkles, X, ArrowRight, CheckCircle2 } from "lucide-react";
import { soundEngine } from "@/components/ui/SoundEffects";

export function FloatingConversionDock() {
  const [modalOpen, setModalOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.trim()) {
      soundEngine.playSuccess();
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setModalOpen(false);
        setPhone("");
      }, 3000);
    }
  };

  const handleWhatsApp = () => {
    soundEngine.playSuccess();
    window.open("https://wa.me/919999999999?text=Hi%20Aura!%20I%20want%20to%20book%20a%20free%20live%20demo%20for%20my%20salon.", "_blank");
  };

  return (
    <>
      {/* Floating Bottom Conversion Bar */}
      <div className="fixed bottom-6 right-6 z-[9990] flex items-center gap-2">
        <button
          type="button"
          onClick={handleWhatsApp}
          className="flex h-11 items-center gap-2 rounded-full bg-emerald-600 px-4 text-xs font-bold text-white shadow-xl transition-transform hover:scale-105 active:scale-95"
        >
          <MessageSquare className="h-4 w-4" />
          <span className="hidden sm:inline">WhatsApp Us</span>
        </button>

        <button
          type="button"
          onClick={() => { setModalOpen(true); soundEngine.playClick(); }}
          className="flex h-11 items-center gap-2 rounded-full bg-aura-burgundy px-5 text-xs font-bold text-white shadow-xl transition-transform hover:scale-105 active:scale-95"
        >
          <Sparkles className="h-4 w-4" />
          <span>Book Free Demo</span>
        </button>
      </div>

      {/* Instant Callback / Demo Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="relative w-full max-w-md rounded-3xl border border-aura-border bg-white p-6 shadow-2xl text-aura-text">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-full bg-aura-surface-muted text-aura-text-muted hover:text-aura-text"
            >
              <X className="h-4 w-4" />
            </button>

            {submitted ? (
              <div className="py-8 text-center space-y-3">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold">Callback Request Received!</h3>
                <p className="text-xs text-aura-text-secondary">Our salon specialist will call you at {phone} within 15 minutes.</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-aura-burgundy uppercase tracking-wider">
                  <PhoneCall className="h-4 w-4" />
                  <span>Instant Salon Onboarding</span>
                </div>
                <h3 className="mt-2 text-xl font-display font-bold">Get 14 Days Free Access</h3>
                <p className="mt-1 text-xs text-aura-text-secondary">Enter your phone number for instant login access & live guided walkthrough.</p>

                <form onSubmit={handleSubmit} className="mt-6 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-aura-text-secondary mb-1">Phone Number / WhatsApp</label>
                    <input
                      type="tel"
                      required
                      placeholder="+91 98765 43210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full rounded-2xl border border-aura-border bg-aura-surface-muted px-4 py-3 text-sm text-aura-text outline-none focus:border-aura-burgundy"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 rounded-2xl bg-aura-burgundy py-3 text-sm font-bold text-white shadow-md hover:bg-aura-burgundy-strong transition-colors"
                  >
                    <span>Request Callback & Demo</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
