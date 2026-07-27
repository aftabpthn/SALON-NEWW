"use client";

import { useId, useState } from "react";
import { Send, CheckCircle, Mail, Phone, MapPin, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { GridBackground } from "@/components/ui/GridBackground";
import { fadeInUp } from "@/lib/animations";
import { CTA_LINKS } from "@/lib/constants";
import { useLanguage } from "@/components/providers/LanguageProvider";

const MAX_MESSAGE = 500;

interface FieldErrors {
  name?: string;
  email?: string;
  message?: string;
}

function FloatingInput({
  label, type = "text", required, value, onChange, placeholder, error,
}: {
  label: string; type?: string; required?: boolean; value: string;
  onChange: (v: string) => void; placeholder: string; error?: string;
}) {
  const id = useId();
  const filled = value.length > 0;
  return (
    <div className="relative">
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`peer w-full px-4 pt-6 pb-2 rounded-xl border bg-white text-sm text-aura-text placeholder-transparent focus:outline-none focus:ring-2 focus:ring-neon-violet/30 focus:border-neon-violet/50 transition-all ${
          error ? "border-danger/50 focus:ring-danger/30" : "border-aura-border"
        }`}
      />
       <label htmlFor={id} className={`absolute left-4 transition-all duration-200 pointer-events-none ${
        filled || error
          ? "top-2 text-[11px] font-medium"
          : "top-3.5 text-sm text-aura-text-muted"
      } ${error ? "text-danger" : "text-aura-text-secondary peer-focus:text-neon-violet"}`}>
        {label} {required && <span className="text-danger">*</span>}
      </label>
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            id={`${id}-error`}
            className="flex items-center gap-1 text-xs text-danger mt-1"
          >
            <AlertCircle className="w-3 h-3" />
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function FloatingTextarea({
  label, required, value, onChange, placeholder, maxLength, error,
}: {
  label: string; required?: boolean; value: string;
  onChange: (v: string) => void; placeholder: string; maxLength?: number; error?: string;
}) {
  const id = useId();
  const filled = value.length > 0;
  const remaining = maxLength ? maxLength - value.length : null;
  return (
    <div className="relative">
      <textarea
        required={required}
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className="peer w-full px-4 pt-6 pb-2 rounded-xl border border-aura-border bg-white text-sm text-aura-text placeholder-transparent focus:outline-none focus:ring-2 focus:ring-neon-violet/30 focus:border-neon-violet/50 transition-all resize-none"
      />
       <label htmlFor={id} className={`absolute left-4 transition-all duration-200 pointer-events-none ${
        filled
          ? "top-2 text-[11px] font-medium text-aura-text-secondary"
          : "top-3.5 text-sm text-aura-text-muted"
      } peer-focus:text-neon-violet`}>
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {remaining !== null && (
        <span className={`absolute bottom-3 right-4 text-xs ${remaining < 50 ? "text-danger" : "text-aura-text-muted"}`}>
          {remaining}
        </span>
      )}
      {error && <p id={`${id}-error`} className="mt-1 flex items-center gap-1 text-xs text-danger"><AlertCircle className="h-3 w-3" />{error}</p>}
    </div>
  );
}

export default function ContactPage() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    salonName: "",
    message: "",
  });

  const validate = (): boolean => {
    const e: FieldErrors = {};
    if (!formData.name.trim()) e.name = t("contact.requiredName");
    if (!formData.email.trim()) e.email = t("contact.requiredEmail");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) e.email = t("contact.validEmail");
    if (!formData.message.trim()) e.message = t("contact.requiredMessage");
    else if (formData.message.length < 10) e.message = t("contact.shortMessage");
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "sending") return;
    if (!validate()) return;
    setStatus("sending");
    setSubmitError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setStatus("sent");
        setFormData({ name: "", email: "", phone: "", salonName: "", message: "" });
        setErrors({});
      } else {
        const payload = await res.json().catch(() => null) as { code?: string } | null;
        setSubmitError(payload?.code === "DELIVERY_NOT_CONFIGURED" ? t("contact.deliveryMissing") : t("common.error"));
        setStatus("error");
      }
    } catch {
      setSubmitError(t("common.error"));
      setStatus("error");
    }
  };

  return (
    <>
      <section className="relative pt-28 pb-16 md:pt-36 md:pb-20 bg-gradient-to-b from-aura-bg to-white overflow-hidden">
        <GridBackground className="opacity-30" />
        <Container className="relative z-10">
          <SectionHeading
            badge={t("contact.badge")}
            title={t("contact.title")}
            subtitle={t("contact.body")}
          />
        </Container>
      </section>

      <section className="pb-20 md:pb-28 bg-white">
        <Container>
          <div className="grid md:grid-cols-5 gap-12 max-w-5xl mx-auto">
            <motion.div
              variants={fadeInUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="md:col-span-3"
            >
              {status === "sent" ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                   className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-12 text-center"
                   role="status"
                >
                  <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                   <h3 className="text-xl font-bold text-aura-text mb-2">{t("contact.sent")}</h3>
                  <p className="text-sm text-aura-text-secondary">
                     {t("contact.sentBody")}
                  </p>
                  <button
                    onClick={() => setStatus("idle")}
                    className="mt-6 text-sm font-semibold text-neon-violet hover:underline"
                  >
                     {t("contact.another")}
                  </button>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5" noValidate aria-busy={status === "sending"} aria-describedby={status === "error" ? "contact-submit-error" : undefined}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                     <FloatingInput label={t("contact.name")} required value={formData.name} onChange={(v) => setFormData({ ...formData, name: v })} placeholder="Priya Sharma" error={errors.name} />
                     <FloatingInput label={t("contact.email")} type="email" required value={formData.email} onChange={(v) => setFormData({ ...formData, email: v })} placeholder="priya@salon.com" error={errors.email} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                     <FloatingInput label={t("contact.phone")} value={formData.phone} onChange={(v) => setFormData({ ...formData, phone: v })} placeholder="+91 98765 43210" />
                     <FloatingInput label={t("contact.salon")} value={formData.salonName} onChange={(v) => setFormData({ ...formData, salonName: v })} placeholder="Glow Studio" />
                  </div>
                   <FloatingTextarea label={t("contact.message")} required value={formData.message} onChange={(v) => setFormData({ ...formData, message: v })} placeholder="Tell us about your salon and what you're looking for..." maxLength={MAX_MESSAGE} error={errors.message} />

                  <button
                    type="submit"
                    disabled={status === "sending"}
                    className="inline-flex items-center gap-2 px-8 py-3.5 text-sm font-semibold text-white rounded-xl bg-gradient-to-r from-neon-violet via-aura-rose to-aura-amber shadow-md hover:shadow-lg hover:scale-[1.02] transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {status === "sending" ? (
                      <>
                         {t("common.loading")}
                      </>
                    ) : (
                      <>
                         {t("contact.send")}
                        <Send className="w-4 h-4" />
                      </>
                    )}
                  </button>
                  {status === "error" && (
                     <p id="contact-submit-error" className="text-sm text-danger" role="alert">{submitError || t("common.error")}</p>
                  )}
                </form>
              )}
            </motion.div>

            <motion.div
              variants={fadeInUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="md:col-span-2"
            >
              <div className="space-y-6">
                {[
                   { icon: Mail, label: t("contact.email"), value: "hello@aurasalon.in" },
                   { icon: Phone, label: t("contact.phone"), value: "+91 98765 43210" },
                   { icon: MapPin, label: t("contact.office"), value: "Hitech City, Hyderabad\nTelangana, India 500081" },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-aura-border bg-aura-bg-warm p-6 hover:shadow-md hover:border-aura-border-strong transition-all duration-300">
                    <div className="flex items-start gap-3">
                      <item.icon className="w-5 h-5 text-neon-violet mt-0.5" />
                      <div>
                        <div className="text-sm font-semibold text-aura-text">{item.label}</div>
                        <div className="text-sm text-aura-text-secondary whitespace-pre-line">{item.value}</div>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="rounded-2xl border border-aura-border bg-white p-6">
                   <h3 className="text-sm font-bold text-aura-text mb-3">{t("contact.quick")}</h3>
                  <ul className="space-y-2">
                     <li><a href={CTA_LINKS.demo} className="text-sm text-neon-violet hover:underline">{t("contact.schedule")}</a></li>
                     <li><a href="/features" className="text-sm text-neon-violet hover:underline">{t("contact.viewFeatures")}</a></li>
                     <li><a href="/pricing" className="text-sm text-neon-violet hover:underline">{t("contact.viewPricing")}</a></li>
                  </ul>
                </div>
              </div>
            </motion.div>
          </div>
        </Container>
      </section>
    </>
  );
}
