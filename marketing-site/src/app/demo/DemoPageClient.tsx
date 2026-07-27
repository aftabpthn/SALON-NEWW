"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Calendar, Clock, User, Building2, CheckCircle, ArrowRight, Phone } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { GridBackground } from "@/components/ui/GridBackground";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { DEMO_BENEFITS_HI } from "@/lib/translations";

const TIME_SLOTS = [
  "10:00 AM", "11:00 AM", "12:00 PM",
  "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM",
];

const BENEFITS = [
  "15-minute personalized walkthrough",
  "See features relevant to your salon size",
  "Get your questions answered live",
  "Clear guidance on setup and migration",
];

export default function DemoPage() {
  const { businessType, language, t } = useLanguage();
  const [status, setStatus] = useState<"idle" | "sending" | "submitted" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState({
    name: "", email: "", phone: "", salon: "", size: "1-2", date: "", time: "",
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    setErrorMessage("");
    const message = [
      t("demo.messageIntro"),
      `${t("demo.messageSize")}: ${form.size}`,
      `${t("demo.messageDate")}: ${form.date}`,
      `${t("demo.messageTime")}: ${form.time} IST`,
      `${t("demo.messageBusiness")}: ${t(`business.${businessType}`)}`,
    ].join("\n");
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, email: form.email, phone: form.phone, salonName: form.salon, message }),
      });
      const payload = await response.json().catch(() => null) as { code?: string; error?: string } | null;
      if (!response.ok) {
        setErrorMessage(payload?.code === "DELIVERY_NOT_CONFIGURED" ? t("demo.deliveryMissing") : t("demo.error"));
        setStatus("error");
        return;
      }
      setStatus("submitted");
    } catch {
      setErrorMessage(t("demo.error"));
      setStatus("error");
    }
  };

  if (status === "submitted") {
    return (
      <section className="min-h-[80vh] flex items-center justify-center bg-aura-bg">
        <Container>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center max-w-md mx-auto"
          >
            <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-emerald-500" />
            </div>
             <h1 className="text-2xl font-bold text-aura-text mb-3">{t("demo.done")}</h1>
            <p className="text-aura-text-secondary mb-6">
               {t("demo.doneBody").replace("{email}", form.email).replace("{time}", form.time).replace("{date}", form.date)}
            </p>
            <a href="/" className="text-sm font-semibold text-neon-violet hover:underline">
               ← {t("common.backHome")}
            </a>
          </motion.div>
        </Container>
      </section>
    );
  }

  return (
    <>
      <section className="relative pt-28 pb-16 md:pt-36 md:pb-20 bg-gradient-to-b from-aura-bg to-white overflow-hidden">
        <GridBackground className="opacity-30" />
        <Container className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="max-w-3xl mx-auto text-center"
          >
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-neon-violet/10 text-neon-violet mb-6">
              <Calendar className="w-3 h-3" />
               {t("demo.badge")}
            </span>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-aura-text leading-[1.1]">
               {t("demo.titleA")} <span className="gradient-text">{t("demo.titleB")}</span>
            </h1>
            <p className="mt-5 text-lg text-aura-text-secondary max-w-xl mx-auto">
               {t("demo.body")}
            </p>
          </motion.div>
        </Container>
      </section>

      <section className="pb-20 md:pb-28 bg-white">
        <Container>
          <div className="grid md:grid-cols-5 gap-12 max-w-5xl mx-auto">
            {/* Form */}
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="md:col-span-3"
            >
              <form onSubmit={handleSubmit} className="space-y-5" aria-busy={status === "sending"} aria-describedby={errorMessage ? "demo-submit-error" : undefined}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                     <label htmlFor="demo-name" className="block text-sm font-medium text-aura-text mb-1.5">{t("demo.name")} *</label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 w-4 h-4 text-aura-text-muted" />
                       <input id="demo-name" type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full pl-10 pr-4 py-3 rounded-xl border border-aura-border bg-white text-sm text-aura-text placeholder:text-aura-text-muted focus:outline-none focus:ring-2 focus:ring-neon-violet/30 focus:border-neon-violet/50 transition-all" placeholder="Priya Sharma" />
                    </div>
                  </div>
                  <div>
                     <label htmlFor="demo-email" className="block text-sm font-medium text-aura-text mb-1.5">{t("demo.email")} *</label>
                     <input id="demo-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-aura-border bg-white text-sm text-aura-text placeholder:text-aura-text-muted focus:outline-none focus:ring-2 focus:ring-neon-violet/30 focus:border-neon-violet/50 transition-all" placeholder="priya@salon.com" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                     <label htmlFor="demo-phone" className="block text-sm font-medium text-aura-text mb-1.5">{t("demo.phone")} *</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-3 w-4 h-4 text-aura-text-muted" />
                       <input id="demo-phone" type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full pl-10 pr-4 py-3 rounded-xl border border-aura-border bg-white text-sm text-aura-text placeholder:text-aura-text-muted focus:outline-none focus:ring-2 focus:ring-neon-violet/30 focus:border-neon-violet/50 transition-all" placeholder="+91 98765 43210" />
                    </div>
                  </div>
                  <div>
                     <label htmlFor="demo-salon" className="block text-sm font-medium text-aura-text mb-1.5">{t("demo.salon")} *</label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-3 w-4 h-4 text-aura-text-muted" />
                       <input id="demo-salon" type="text" required value={form.salon} onChange={(e) => setForm({ ...form, salon: e.target.value })} className="w-full pl-10 pr-4 py-3 rounded-xl border border-aura-border bg-white text-sm text-aura-text placeholder:text-aura-text-muted focus:outline-none focus:ring-2 focus:ring-neon-violet/30 focus:border-neon-violet/50 transition-all" placeholder="Glow Studio" />
                    </div>
                  </div>
                </div>
                <div>
                   <label htmlFor="demo-size" className="block text-sm font-medium text-aura-text mb-1.5">{t("demo.size")}</label>
                   <select id="demo-size" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-aura-border bg-white text-sm text-aura-text focus:outline-none focus:ring-2 focus:ring-neon-violet/30 focus:border-neon-violet/50 transition-all">
                     <option value="1-2">1-2 {language === "hi" ? "टीम सदस्य" : "staff members"}</option>
                     <option value="3-5">3-5 {language === "hi" ? "टीम सदस्य" : "staff members"}</option>
                     <option value="6-10">6-10 {language === "hi" ? "टीम सदस्य" : "staff members"}</option>
                     <option value="10+">10+ {language === "hi" ? "टीम सदस्य" : "staff members"}</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                     <label htmlFor="demo-date" className="block text-sm font-medium text-aura-text mb-1.5">{t("demo.date")} *</label>
                     <input id="demo-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-aura-border bg-white text-sm text-aura-text focus:outline-none focus:ring-2 focus:ring-neon-violet/30 focus:border-neon-violet/50 transition-all" />
                  </div>
                  <div>
                     <label htmlFor="demo-time" className="block text-sm font-medium text-aura-text mb-1.5">{t("demo.time")} *</label>
                     <select id="demo-time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} required className="w-full px-4 py-3 rounded-xl border border-aura-border bg-white text-sm text-aura-text focus:outline-none focus:ring-2 focus:ring-neon-violet/30 focus:border-neon-violet/50 transition-all">
                        <option value="">{t("demo.selectTime")}</option>
                       {TIME_SLOTS.map((t) => <option key={t} value={t}>{t} IST</option>)}
                     </select>
                     <p className="mt-2 text-xs leading-5 text-aura-text-muted">{t("demo.timePreference")}</p>
                   </div>
                </div>
                <button type="submit" disabled={status === "sending"} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-aura-burgundy px-8 py-3.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-aura-burgundy-strong disabled:cursor-wait disabled:opacity-60">
                   {status === "sending" ? t("demo.sending") : t("demo.book")}
                  <ArrowRight className="w-4 h-4" />
                </button>
                {errorMessage && <p id="demo-submit-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">{errorMessage}</p>}
              </form>
            </motion.div>

            {/* Benefits */}
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="md:col-span-2"
            >
              <div className="rounded-2xl border border-aura-border bg-aura-bg p-8">
                 <h3 className="text-lg font-bold text-aura-text mb-4">{t("demo.expect")}</h3>
                <ul className="space-y-4">
                   {(language === "hi" ? DEMO_BENEFITS_HI : BENEFITS).map((b) => (
                    <li key={b} className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-aura-text-secondary">{b}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-8 p-4 rounded-xl bg-white border border-aura-border">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-neon-violet" />
                     <span className="text-sm font-semibold text-aura-text">{t("demo.quick")}</span>
                  </div>
                  <p className="text-xs text-aura-text-secondary">
                     {t("demo.quickBody")}
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </Container>
      </section>
    </>
  );
}
