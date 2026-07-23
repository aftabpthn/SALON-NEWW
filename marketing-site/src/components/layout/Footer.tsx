"use client";

import Link from "next/link";
import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { FOOTER_LINKS, CTA_LINKS } from "@/lib/constants";
import { MagneticElement } from "@/components/ui/MagneticElement";
import { Newsletter } from "./Newsletter";

const footerSections = [
  { title: "Product", links: FOOTER_LINKS.product },
  { title: "Company", links: FOOTER_LINKS.company },
  { title: "Resources", links: FOOTER_LINKS.resources },
  { title: "Legal", links: FOOTER_LINKS.legal },
];

export function Footer() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });

  return (
    <footer ref={ref} className="relative bg-deep-navy text-white/70 overflow-hidden">
      {/* Subtle mesh gradient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full bg-neon-violet/5 blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 rounded-full bg-aura-rose/4 blur-[120px]" />
      </div>

      {/* CTA Banner */}
      <div className="relative border-b border-white/10">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 py-16 md:py-20 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 leading-tight">
              Ready to transform
              <br className="hidden sm:block" />
              your salon?
            </h2>
            <p className="text-lg text-white/50 mb-8 max-w-xl mx-auto">
              Join 500+ salons already using Aura to grow their business. Start your free trial today.
            </p>
            <MagneticElement as="a" href={CTA_LINKS.trial} className="group inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white rounded-2xl bg-gradient-to-r from-neon-violet via-aura-rose to-aura-amber shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-700" />
              <span className="relative z-10">Start Free Trial</span>
            </MagneticElement>
          </motion.div>
        </div>
      </div>

      {/* Footer Grid */}
      <div className="relative mx-auto max-w-7xl px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand Column */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="col-span-2 md:col-span-1"
          >
            <Link href="/" className="flex items-center gap-2.5 mb-4 group">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-neon-violet to-aura-rose text-white font-bold text-sm group-hover:scale-105 transition-transform duration-300">
                A
              </div>
              <span className="text-lg font-bold text-white tracking-tight">Aura</span>
            </Link>
            <p className="text-sm text-white/40 leading-relaxed mb-6">
              The all-in-one CRM, POS & AI platform built for modern salons.
            </p>
            {/* Social icons */}
            <div className="flex items-center gap-3">
              {["X", "Li", "Ig"].map((icon) => (
                <div key={icon} className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-xs font-bold text-white/40 hover:bg-white/10 hover:text-white/70 transition-all duration-300 cursor-pointer">
                  {icon}
                </div>
              ))}
            </div>
            <div className="mt-6">
              <Newsletter />
            </div>
          </motion.div>

          {/* Link Columns */}
          {footerSections.map((section, si) => (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.15 + si * 0.05 }}
            >
              <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">
                {section.title}
              </h3>
              <ul className="space-y-3">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/40 hover:text-white transition-colors duration-200"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-white/30">
            &copy; {new Date().getFullYear()} Aura Salon CRM/POS. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <Link href="#" className="text-sm text-white/30 hover:text-white/60 transition-colors">Privacy</Link>
            <Link href="#" className="text-sm text-white/30 hover:text-white/60 transition-colors">Terms</Link>
            <Link href="#" className="text-sm text-white/30 hover:text-white/60 transition-colors">Cookies</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
