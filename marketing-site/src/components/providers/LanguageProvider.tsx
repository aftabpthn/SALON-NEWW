"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { EXPERIENCE_MESSAGES, ROUTE_MESSAGES } from "@/lib/translations";

export type Language = "en" | "hi";
export type BusinessType = "salon" | "spa" | "nail" | "bridal" | "multi";

const baseMessages: Record<Language, Record<string, string>> = {
  en: {
    "nav.features": "Features", "nav.platform": "Platform", "nav.owner-crm": "Owner CRM", "nav.customer-app": "Customer App", "nav.staff-app": "Staff App", "nav.workflows": "Workflows", "nav.pricing": "Pricing", "nav.customers": "Customers", "nav.blog": "Journal", "nav.about": "About",
    "nav.login": "Log in", "nav.trial": "Book a demo", "nav.open": "Open navigation", "nav.close": "Close navigation", "nav.language": "Language", "nav.primary": "Primary navigation", "nav.home": "Aura home",
    "hero.eyebrow": "Salon operations, composed", "hero.title": "The operating system behind a remarkable salon.",
    "hero.body": "Aura connects your appointment book, GST billing, client memory, staff, stock and finance in one calm, real-time workspace built for Indian salons.",
    "hero.primary": "Book a personal demo", "hero.secondary": "Explore the product", "hero.note1": "GST-ready billing", "hero.note2": "UPI & split payments", "hero.note3": "Multi-branch control",
    "hero.live": "Live operations", "hero.today": "Thursday, 23 July", "hero.revenue": "Revenue today", "hero.bookings": "Appointments", "hero.clients": "New clients", "hero.next": "Next at the salon",
    "hero.status": "Arrived", "hero.service1": "Balayage & finish", "hero.service2": "Hair spa", "hero.service3": "Haircut & finish", "hero.split": "Split payment ready", "hero.customer": "Customer 360", "hero.visits": "12 visits", "hero.preference": "Prefers Riya · WhatsApp",
    "trust.india": "Made for India", "trust.indiaSub": "GST, UPI and IST workflows", "trust.secure": "Tenant isolated", "trust.secureSub": "Role-based access & audit trails",
    "trust.realtime": "Real-time operations", "trust.realtimeSub": "Bookings, queue and dashboards", "trust.support": "Human onboarding", "trust.supportSub": "Migration and setup guidance",
    "logos.title": "One system for every role in your salon",
    "problem.badge": "One connected workflow", "problem.title": "Replace operational noise with clarity", "problem.subtitle": "Aura turns the everyday handoffs between reception, floor, stock room and owner into one reliable flow.",
    "problem.old": "Fragmented operations", "problem.oldTitle": "What slows the salon down", "problem.new": "With Aura", "problem.newTitle": "A calmer way to operate",
    "problem.p1": "Paper registers and scattered spreadsheets", "problem.p2": "Missed appointments and manual reminders", "problem.p3": "Billing errors and GST reconciliation", "problem.p4": "Client preferences lost between visits", "problem.p5": "Stockouts, expiry and untracked usage", "problem.p6": "Unclear attendance and commissions",
    "problem.s1": "One live command centre", "problem.s2": "Smart slots, waitlists and confirmations", "problem.s3": "GST invoices and split payments", "problem.s4": "A complete Customer 360 timeline", "problem.s5": "Batches, recipes and reorder guidance", "problem.s6": "Attendance, shifts and payroll workflows",
    "demo.badge": "Product walkthrough", "demo.title": "See the working day come together", "demo.subtitle": "From the first booking to daily closing, Aura keeps every action connected to the same operational record.", "demo.caption": "Product walkthrough · 3 minutes",
    "features.badge": "Built around salon work", "features.title": "Depth where your team needs it", "features.subtitle": "Purpose-built workspaces for the front desk, salon floor, stock room and owner—without stitching together generic tools.", "features.all": "Explore every workspace",
    "pricing.badge": "Plans", "pricing.title": "Start with the operation you have", "pricing.subtitle": "Choose a plan for today, with room for branches, automation and deeper controls as you grow.", "pricing.popular": "Most popular", "pricing.all": "Compare plans and capabilities",
    "cta.title": "See Aura with your salon’s workflow.", "cta.body": "Bring your questions, team structure and current process. We’ll show you how bookings, billing, clients and stock connect in Aura.", "cta.primary": "Book a personal demo", "cta.secondary": "Explore features", "cta.meta1": "15-minute walkthrough", "cta.meta2": "No preparation needed", "cta.meta3": "India-focused setup",
    "footer.title": "A calmer salon starts with a clearer system.", "footer.body": "See how Aura brings bookings, billing, clients and operations into one connected workspace.",
    "footer.product": "Product", "footer.company": "Company", "footer.resources": "Resources", "footer.legal": "Legal", "footer.about": "Salon CRM, POS and operations software designed for modern Indian salons.", "footer.rights": "All rights reserved.",
    "footer.features": "Features", "footer.pricing": "Pricing", "footer.customers": "Customers", "footer.demo": "Demo", "footer.integrations": "Integrations", "footer.aboutUs": "About us", "footer.blog": "Journal", "footer.contact": "Contact", "footer.careers": "Careers", "footer.documentation": "Documentation", "footer.help": "Help centre", "footer.status": "Status", "footer.api": "API reference", "footer.privacy": "Privacy policy", "footer.terms": "Terms of service", "footer.cookies": "Cookie policy",
    "newsletter.title": "Field notes", "newsletter.body": "Salon operations ideas and thoughtful product updates.", "newsletter.join": "Join", "newsletter.done": "You’re subscribed!", "newsletter.email": "Email address",
    "fit.badge": "Evaluate the fit", "fit.title": "Use your demo to verify the workflow", "fit.body": "Use this practical checklist to compare the systems you are considering on the work your team performs every day.", "fit.workflow": "Workflow", "fit.verify": "What to verify", "fit.booking": "Booking", "fit.booking.body": "Create, move and complete a booking; check staff, duration, chair, waitlist and status handling.", "fit.checkout": "Checkout", "fit.checkout.body": "Build a bill, review GST and complete a UPI/card/cash/wallet split payment.", "fit.client": "Client memory", "fit.client.body": "Open history, preferences, wallet, loyalty, notes and follow-up context.", "fit.stock": "Stock", "fit.stock.body": "Trace purchase, batch, expiry, service usage, waste and reorder context.", "fit.staff": "Staff operations", "fit.staff.body": "Review attendance, shift, commission, incentive and payroll workflow.", "fit.branch": "Branch control", "fit.branch.body": "Confirm branch-scoped access, records and owner visibility for authorised locations.", "fit.note": "Ask every vendor to demonstrate these tasks with real product behaviour and disclose any integration or configuration required.",
    "demo.timePreference": "This is a preferred time, not live availability. We will confirm it with you.", "common.learn": "Learn more", "common.skip": "Skip to content"
  },
  hi: {
    "nav.features": "फ़ीचर्स", "nav.platform": "प्लेटफ़ॉर्म", "nav.owner-crm": "Owner CRM", "nav.customer-app": "Customer App", "nav.staff-app": "Staff App", "nav.workflows": "वर्कफ़्लो", "nav.pricing": "प्लान", "nav.customers": "ग्राहक", "nav.blog": "जर्नल", "nav.about": "हमारे बारे में",
    "nav.login": "लॉग इन", "nav.trial": "डेमो बुक करें", "nav.open": "नेविगेशन खोलें", "nav.close": "नेविगेशन बंद करें", "nav.language": "भाषा", "nav.primary": "मुख्य नेविगेशन", "nav.home": "Aura होम",
    "hero.eyebrow": "सैलून संचालन, अब व्यवस्थित", "hero.title": "एक शानदार सैलून के पीछे का ऑपरेटिंग सिस्टम।",
    "hero.body": "Aura अपॉइंटमेंट, GST बिलिंग, क्लाइंट हिस्ट्री, स्टाफ, स्टॉक और फाइनेंस को भारतीय सैलून के लिए बने एक शांत, रियल-टाइम वर्कस्पेस में जोड़ता है।",
    "hero.primary": "पर्सनल डेमो बुक करें", "hero.secondary": "प्रोडक्ट देखें", "hero.note1": "GST-रेडी बिलिंग", "hero.note2": "UPI और स्प्लिट पेमेंट", "hero.note3": "मल्टी-ब्रांच कंट्रोल",
    "hero.live": "लाइव ऑपरेशंस", "hero.today": "गुरुवार, 23 जुलाई", "hero.revenue": "आज की आय", "hero.bookings": "अपॉइंटमेंट", "hero.clients": "नए क्लाइंट", "hero.next": "सैलून में अगला",
    "hero.status": "आ चुके हैं", "hero.service1": "बालायाज और फिनिश", "hero.service2": "हेयर स्पा", "hero.service3": "हेयरकट और फिनिश", "hero.split": "स्प्लिट पेमेंट तैयार", "hero.customer": "कस्टमर 360", "hero.visits": "12 विज़िट", "hero.preference": "रिया पसंद · WhatsApp",
    "trust.india": "भारत के लिए बना", "trust.indiaSub": "GST, UPI और IST वर्कफ़्लो", "trust.secure": "डेटा अलग और सुरक्षित", "trust.secureSub": "रोल-आधारित एक्सेस व ऑडिट ट्रेल",
    "trust.realtime": "रियल-टाइम ऑपरेशंस", "trust.realtimeSub": "बुकिंग, कतार और डैशबोर्ड", "trust.support": "इंसानी ऑनबोर्डिंग", "trust.supportSub": "माइग्रेशन और सेटअप सहायता",
    "logos.title": "आपके सैलून की हर भूमिका के लिए एक सिस्टम",
    "problem.badge": "एक जुड़ा हुआ वर्कफ़्लो", "problem.title": "ऑपरेशनल उलझन की जगह स्पष्टता", "problem.subtitle": "Aura रिसेप्शन, सैलून फ्लोर, स्टॉक रूम और मालिक के रोज़ाना हैंडऑफ़ को एक भरोसेमंद फ्लो में बदलता है।",
    "problem.old": "बिखरा हुआ संचालन", "problem.oldTitle": "जो सैलून की रफ़्तार रोकता है", "problem.new": "Aura के साथ", "problem.newTitle": "काम करने का शांत तरीका",
    "problem.p1": "पेपर रजिस्टर और बिखरी स्प्रेडशीट", "problem.p2": "छूटे अपॉइंटमेंट और मैनुअल रिमाइंडर", "problem.p3": "बिलिंग की गलतियाँ और GST मिलान", "problem.p4": "विज़िट के बीच खोती क्लाइंट पसंद", "problem.p5": "स्टॉकआउट, एक्सपायरी और अनट्रैक्ड उपयोग", "problem.p6": "अस्पष्ट अटेंडेंस और कमीशन",
    "problem.s1": "एक लाइव कमांड सेंटर", "problem.s2": "स्मार्ट स्लॉट, वेटलिस्ट और कन्फर्मेशन", "problem.s3": "GST इनवॉइस और स्प्लिट पेमेंट", "problem.s4": "पूरी Customer 360 टाइमलाइन", "problem.s5": "बैच, रेसिपी और रीऑर्डर सुझाव", "problem.s6": "अटेंडेंस, शिफ्ट और पेरोल वर्कफ़्लो",
    "demo.badge": "प्रोडक्ट वॉकथ्रू", "demo.title": "पूरा कार्यदिवस एक साथ देखें", "demo.subtitle": "पहली बुकिंग से डेली क्लोज़िंग तक, Aura हर एक्शन को उसी ऑपरेशनल रिकॉर्ड से जोड़ता है।", "demo.caption": "प्रोडक्ट वॉकथ्रू · 3 मिनट",
    "features.badge": "सैलून के काम के अनुसार", "features.title": "जहाँ टीम को ज़रूरत, वहाँ पूरी गहराई", "features.subtitle": "फ्रंट डेस्क, सैलून फ्लोर, स्टॉक रूम और मालिक के लिए खास वर्कस्पेस—बिना कई सामान्य टूल जोड़े।", "features.all": "सभी वर्कस्पेस देखें",
    "pricing.badge": "प्लान", "pricing.title": "आज के संचालन से शुरुआत करें", "pricing.subtitle": "ऐसा प्लान चुनें जो आज सही हो और आगे ब्रांच, ऑटोमेशन और कंट्रोल के साथ बढ़ सके।", "pricing.popular": "सबसे लोकप्रिय", "pricing.all": "प्लान और क्षमताएँ देखें",
    "cta.title": "Aura को अपने सैलून के वर्कफ़्लो के साथ देखें।", "cta.body": "अपने सवाल, टीम संरचना और मौजूदा प्रक्रिया लाएँ। हम दिखाएँगे कि Aura में बुकिंग, बिलिंग, क्लाइंट और स्टॉक कैसे जुड़ते हैं।", "cta.primary": "पर्सनल डेमो बुक करें", "cta.secondary": "फ़ीचर्स देखें", "cta.meta1": "15 मिनट का वॉकथ्रू", "cta.meta2": "तैयारी की ज़रूरत नहीं", "cta.meta3": "भारत-केंद्रित सेटअप",
    "footer.title": "बेहतर सिस्टम से शुरू होता है एक शांत सैलून।", "footer.body": "देखें Aura कैसे बुकिंग, बिलिंग, क्लाइंट और ऑपरेशंस को एक वर्कस्पेस में लाता है।",
    "footer.product": "प्रोडक्ट", "footer.company": "कंपनी", "footer.resources": "संसाधन", "footer.legal": "कानूनी", "footer.about": "आधुनिक भारतीय सैलून के लिए बनाया गया CRM, POS और ऑपरेशंस सॉफ्टवेयर।", "footer.rights": "सर्वाधिकार सुरक्षित।",
    "footer.features": "फ़ीचर्स", "footer.pricing": "प्लान", "footer.customers": "ग्राहक", "footer.demo": "डेमो", "footer.integrations": "इंटीग्रेशन", "footer.aboutUs": "हमारे बारे में", "footer.blog": "जर्नल", "footer.contact": "संपर्क", "footer.careers": "करियर", "footer.documentation": "डॉक्यूमेंटेशन", "footer.help": "सहायता केंद्र", "footer.status": "स्थिति", "footer.api": "API संदर्भ", "footer.privacy": "प्राइवेसी नीति", "footer.terms": "सेवा की शर्तें", "footer.cookies": "कुकी नीति",
    "newsletter.title": "फील्ड नोट्स", "newsletter.body": "सैलून संचालन के सुझाव और उपयोगी प्रोडक्ट अपडेट।", "newsletter.join": "जुड़ें", "newsletter.done": "आप जुड़ गए हैं!", "newsletter.email": "ईमेल पता",
    "fit.badge": "सही फिट जाँचें", "fit.title": "डेमो में वर्कफ़्लो की पुष्टि करें", "fit.body": "जिन सिस्टम पर आप विचार कर रहे हैं, उन्हें टीम के रोज़ाना काम के आधार पर परखने के लिए यह व्यावहारिक सूची इस्तेमाल करें।", "fit.workflow": "वर्कफ़्लो", "fit.verify": "क्या जाँचना है", "fit.booking": "बुकिंग", "fit.booking.body": "बुकिंग बनाएँ, बदलें और पूरा करें; स्टाफ, समय, चेयर, वेटलिस्ट और स्टेटस जाँचें।", "fit.checkout": "चेकआउट", "fit.checkout.body": "बिल बनाएँ, GST देखें और UPI/कार्ड/कैश/वॉलेट split payment पूरा करें।", "fit.client": "क्लाइंट मेमोरी", "fit.client.body": "हिस्ट्री, पसंद, वॉलेट, लॉयल्टी, नोट्स और फॉलो-अप संदर्भ खोलें।", "fit.stock": "स्टॉक", "fit.stock.body": "खरीद, बैच, एक्सपायरी, सर्विस उपयोग, वेस्ट और रीऑर्डर संदर्भ ट्रेस करें।", "fit.staff": "स्टाफ ऑपरेशंस", "fit.staff.body": "अटेंडेंस, शिफ्ट, कमीशन, इंसेंटिव और पेरोल वर्कफ़्लो देखें।", "fit.branch": "ब्रांच कंट्रोल", "fit.branch.body": "ब्रांच-सीमित एक्सेस, रिकॉर्ड और अधिकृत लोकेशन की owner visibility जाँचें।", "fit.note": "हर vendor से ये काम असली प्रोडक्ट में दिखाने और ज़रूरी integration या configuration साफ़ बताने को कहें।",
    "demo.timePreference": "यह पसंदीदा समय है, live availability नहीं। हमारी टीम आपसे confirm करेगी।", "common.learn": "और जानें", "common.skip": "मुख्य सामग्री पर जाएँ"
  }
};

const messages: Record<Language, Record<string, string>> = {
  en: { ...baseMessages.en, ...ROUTE_MESSAGES.en, ...EXPERIENCE_MESSAGES.en },
  hi: { ...baseMessages.hi, ...ROUTE_MESSAGES.hi, ...EXPERIENCE_MESSAGES.hi },
};

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  businessType: BusinessType;
  setBusinessType: (businessType: BusinessType) => void;
  t: (key: string, fallback?: string) => string;
};
const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");
  const [businessType, setBusinessTypeState] = useState<BusinessType>("salon");

  useEffect(() => {
    const saved = window.localStorage.getItem("aura.marketing.language");
    if (saved === "en" || saved === "hi") setLanguageState(saved);
    const savedBusinessType = window.localStorage.getItem("aura.marketing.businessType");
    if (savedBusinessType === "salon" || savedBusinessType === "spa" || savedBusinessType === "nail" || savedBusinessType === "bridal" || savedBusinessType === "multi") {
      setBusinessTypeState(savedBusinessType);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "hi" ? "hi-IN" : "en-IN";
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    window.localStorage.setItem("aura.marketing.language", next);
  }, []);
  const setBusinessType = useCallback((next: BusinessType) => {
    setBusinessTypeState(next);
    window.localStorage.setItem("aura.marketing.businessType", next);
  }, []);
  const t = useCallback((key: string, fallback?: string) => messages[language][key] ?? messages.en[key] ?? fallback ?? key, [language]);
  const value = useMemo(() => ({ language, setLanguage, businessType, setBusinessType, t }), [language, setLanguage, businessType, setBusinessType, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
