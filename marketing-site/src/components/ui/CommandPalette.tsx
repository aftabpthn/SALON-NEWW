"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Search, ArrowRight, Globe, FileText, Layout, Phone, CreditCard, Users, Briefcase, Workflow, BookOpen } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";

type CommandItem = {
  id: string;
  label: string;
  labelHi?: string;
  href: string;
  icon: React.ComponentType<{ className?: string } & Record<string, unknown>>;
  group: string;
};

const commands: CommandItem[] = [
  { id: "platform", label: "Platform Overview", labelHi: "प्लेटफ़ॉर्म अवलोकन", href: "/platform", icon: Layout, group: "product" },
  { id: "owner-crm", label: "Owner CRM & POS", labelHi: "Owner CRM और POS", href: "/owner-crm", icon: Briefcase, group: "product" },
  { id: "customer-app", label: "Customer App", labelHi: "Customer App", href: "/customer-app", icon: Users, group: "product" },
  { id: "staff-app", label: "Staff App", labelHi: "Staff App", href: "/staff-app", icon: Users, group: "product" },
  { id: "workflows", label: "Connected Workflows", labelHi: "जुड़े वर्कफ़्लो", href: "/workflows", icon: Workflow, group: "product" },
  { id: "features", label: "All Features", labelHi: "सभी फ़ीचर", href: "/features", icon: Layout, group: "product" },
  { id: "pricing", label: "Pricing", labelHi: "कीमत", href: "/pricing", icon: CreditCard, group: "product" },
  { id: "demo", label: "Book a Demo", labelHi: "डेमो बुक करें", href: "/demo", icon: Phone, group: "action" },
  { id: "contact", label: "Contact Us", labelHi: "संपर्क करें", href: "/contact", icon: Phone, group: "action" },
  { id: "about", label: "About Aura", labelHi: "Aura के बारे में", href: "/about", icon: FileText, group: "company" },
  { id: "blog", label: "Blog", labelHi: "ब्लॉग", href: "/blog", icon: BookOpen, group: "company" },
];

const groupLabels: Record<string, { en: string; hi: string }> = {
  product: { en: "Product", hi: "प्रोडक्ट" },
  action: { en: "Get Started", hi: "शुरू करें" },
  company: { en: "Company", hi: "कंपनी" },
};

export function CommandPalette() {
  const router = useRouter();
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return commands;
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        (cmd.labelHi && cmd.labelHi.includes(q)) ||
        cmd.href.toLowerCase().includes(q)
    );
  }, [query]);

  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    for (const item of filtered) {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push(item);
    }
    return groups;
  }, [filtered]);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      router.push(href);
    },
    [router]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && filtered[selectedIndex]) {
        navigate(filtered[selectedIndex].href);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, filtered, selectedIndex, navigate]);

  useEffect(() => {
    const item = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-[9990] hidden items-center gap-2 rounded-full border border-aura-border bg-white/80 px-4 py-2.5 text-xs font-medium text-aura-text-muted shadow-lg backdrop-blur-md transition-colors hover:border-aura-border-strong hover:text-aura-text xl:flex"
        aria-label="Open command palette (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Search</span>
        <kbd className="ml-2 rounded-md border border-aura-border bg-aura-surface-muted px-1.5 py-0.5 text-[10px] font-semibold">⌘K</kbd>
      </button>

      {/* Overlay */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[9999] bg-black/40 backdrop-blur-sm"
              onClick={() => { setOpen(false); setQuery(""); }}
              aria-hidden="true"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              className="fixed inset-x-4 top-[15vh] z-[9999] mx-auto max-w-lg overflow-hidden rounded-2xl border border-aura-border bg-white shadow-2xl sm:inset-x-auto"
            >
              {/* Search input */}
              <div className="flex items-center gap-3 border-b border-aura-border px-4 py-3">
                <Search className="h-4 w-4 shrink-0 text-aura-text-muted" aria-hidden="true" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={language === "hi" ? "खोजें..." : "Search pages, features..."}
                  className="flex-1 bg-transparent text-sm text-aura-text placeholder:text-aura-text-muted focus:outline-none"
                  aria-label="Search"
                />
                <div className="flex items-center gap-1">
                  {(["en", "hi"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setLanguage(opt)}
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold transition-colors ${language === opt ? "bg-aura-burgundy text-white" : "text-aura-text-muted hover:bg-aura-surface-muted"}`}
                      aria-label={`Switch to ${opt === "en" ? "English" : "Hindi"}`}
                    >
                      {opt === "en" ? "EN" : "हिं"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Results */}
              <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
                {filtered.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-aura-text-muted">
                    {language === "hi" ? "कोई परिणाम नहीं मिला" : "No results found"}
                  </p>
                )}
                {Object.entries(grouped).map(([group, items]) => (
                  <div key={group} className="mb-1">
                    <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-[.14em] text-aura-text-muted">
                      {groupLabels[group]?.[language] || group}
                    </p>
                    {items.map((item) => {
                      const globalIndex = filtered.indexOf(item);
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          data-index={globalIndex}
                          type="button"
                          role="option"
                          aria-selected={selectedIndex === globalIndex}
                          onClick={() => navigate(item.href)}
                          onMouseEnter={() => setSelectedIndex(globalIndex)}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${selectedIndex === globalIndex ? "bg-aura-rose-soft text-aura-burgundy" : "text-aura-text-secondary hover:bg-aura-surface-muted"}`}
                        >
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${selectedIndex === globalIndex ? "bg-aura-burgundy text-white" : "bg-aura-surface-muted text-aura-text-muted"}`}>
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block truncate font-medium">{language === "hi" && item.labelHi ? item.labelHi : item.label}</span>
                            <span className="block truncate text-xs text-aura-text-muted">{item.href}</span>
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Footer hint */}
              <div className="flex items-center justify-between border-t border-aura-border px-4 py-2 text-[11px] text-aura-text-muted">
                <span>↑↓ navigate · ↵ open · esc close</span>
                <span className="flex items-center gap-1"><Globe className="h-3 w-3" aria-hidden="true" /> {language === "hi" ? "भाषा बदलें" : "Language"}</span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
