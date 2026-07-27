"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus, Minus, Search } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { GridBackground } from "@/components/ui/GridBackground";
import { useLanguage } from "@/components/providers/LanguageProvider";

interface FAQItem {
  q: string;
  a: string;
}

const FAQ_ITEMS_HI: Record<string, string> = {
  "What is Aura?": "Aura क्या है?",
  "Is Aura only for large salon chains?": "क्या Aura केवल बड़े सैलून चेन के लिए है?",
  "How does multi-branch work?": "मल्टी-ब्रांच कैसे काम करता है?",
  "Does Aura support GST billing?": "क्या Aura GST बिलिंग सपोर्ट करता है?",
  "Can clients book online?": "क्या क्लाइंट ऑनलाइन बुकिंग कर सकते हैं?",
  "Is there a mobile app for staff?": "क्या स्टाफ के लिए मोबाइल ऐप है?",
  "What about data security?": "डेटा सिक्योरिटी के बारे में क्या?",
  "Can I import data from another tool?": "क्या मैं दूसरे टूल से डेटा इम्पोर्ट कर सकता हूँ?",
  "How do I get started?": "मैं शुरू कैसे करूँ?",
  "What payment methods does Aura accept?": "Aura कौन-से पेमेंट मेथड स्वीकार करता है?",
  "Does Aura handle staff payroll?": "क्या Aura स्टाफ पेऑल सँभालता है?",
  "Can I white-label the customer app?": "क्या मैं कस्टमर ऐप को व्हाइट-लेबल कर सकता हूँ?",
};

const ANSWERS_HI: Record<string, string> = {
  "What is Aura?": "Aura एक कनेक्टेड सैलून ऑपरेटिंग सिस्टम है। Owner CRM और POS, कस्टमर बुकिंग, स्टाफ अटेंडेंस और पेऑल, इन्वेंटरी, फाइनेंस और ब्रांच-अवेयर ऑपरेशन — सब एक ही सैलून डे के चारों ओर चलते हैं — कोई डबल एंट्री नहीं, कोई गैप नहीं।",
  "Is Aura only for large salon chains?": "नहीं। सोलो सैलून ओनर, 2-ब्रांच सेटअप और मल्टी-लोकेशन चेन — सभी Aura का उपयोग करते हैं। Starter प्लान सिंगल-ब्रांच सैलून के लिए है। Growth 5 ब्रांच तक सपोर्ट करता है। Enterprise अनलिमिटेड ब्रांच कवर करता है।",
  "How does multi-branch work?": "हर रिकॉर्ड — अपॉइंटमेंट, इनवॉइस, स्टाफ, इन्वेंटरी, खर्च — में tenant और branch ID होती है। ओनर्स को कंसोलिडेटेड डैशबोर्ड दिखता है। ब्रांच मैनेजर सिर्फ अपनी लोकेशन देखते हैं। क्रॉस-ब्रांच एनालिटिक्स Growth टियर में उपलब्ध है।",
  "Does Aura support GST billing?": "हाँ। Aura GST-रेडी इनवॉइस जनरेट करता है HSN/SAC कॉन्टेक्सट के साथ, CGST/SGST या IGST कैल्कुलेट करता है, और GST रिपोर्ट समरी बनाता है। फाइलिंग आपके CA या सरकारी पोर्टल के जरिए होती है।",
  "Can clients book online?": "हाँ। ऑनलाइन बुकिंग पोर्टल एक पब्लिक, पे-एट-सैलून फ्लो है। क्लाइंट सर्विस चुनते हैं, प्रोफेशनल पिक करते हैं, स्लॉट सेलेक्ट करते हैं, और कन्फर्म करते हैं — बिना पेमेंट अपफ्रंट। बुकिंग तुरंत ओनर के कैलेंडर पर दिखती है।",
  "Is there a mobile app for staff?": "हाँ। Staff App में सिक्योर अटेंडेंस (एंड्रॉइड-ओनली फेस/बायोमेट्रिक), शिफ्ट व्यूइंग, कमीशन ट्रैकिंग और परफॉर्मेंस डैशबोर्ड हैं। iOS यूज़र्स वेब-बेस्ड अटेंडेंस फ्लो यूज़ कर सकते हैं।",
  "What about data security?": "Aura एन्क्रिप्टेड डेटा, रोल-बेस्ड एक्सेस कंट्रोल, मल्टी-टेनेंसी आइसोलेशन और रेगुलर बैकअप्स यूज़ करता है। JWT रिफ्रेश टोकन API एक्सेस सिक्योर करते हैं।",
  "Can I import data from another tool?": "हाँ। Aura क्लाइंट, सर्विस, स्टाफ और इन्वेंटरी के लिए स्ट्रक्चर्ड CSV टेम्पलेट्स के जरिए बल्क इम्पोर्ट सपोर्ट करता है। इम्पोर्ट सिस्टम डेटा वैलिडेट करता है और डेटाबेस में लिखने से पहले एरर्स रिपोर्ट करता है।",
  "How do I get started?": "फ्री डेमो बुक करें। हम आपको प्लेटफ़ॉर्म दिखाएंगे, आपकी सर्विस और स्टाफ सेटअप में मदद करेंगे, और ज़रूरत पड़ने पर आपका एग्ज़िस्टिंग क्लाइंट डेटा माइग्रेट करेंगे। हर प्लान 14-दिन के फ्री ट्रायल से शुरू होता है — क्रेडिट कार्ड की ज़रूरत नहीं।",
  "What payment methods does Aura accept?": "Aura Razorpay के जरिए पेमेंट प्रोसेस करता है — UPI, क्रेडिट/डेबिट कार्ड, नेट बैंकिंग और बैंक ट्रांसफर। सभी ट्रांज़ैक्शन बैंक-ग्रेड एन्क्रिप्शन से सिक्योर हैं।",
  "Does Aura handle staff payroll?": "हाँ। Growth और Enterprise प्लान में अटेंडेंस ट्रैकिंग, शिफ्ट शेड्यूलिंग, कमीशन कैल्कुलेशन और पेऑल प्रोसेसिंग शामिल है। Aura PF, ESI, TDS, प्रोफेशनल टैक्स, ग्रैच्युटी और बोनस कैल्कुलेट करता है।",
  "Can I white-label the customer app?": "हाँ। व्हाइट-लेबल ब्रांडिंग — कस्टम डोमेन, लोगो, कलर्स — Enterprise प्लान में उपलब्ध है। कस्टमर-फेसिंग बुकिंग पोर्टल आपके सैलून की ब्रांड आइडेंटिटी कैरी कर सकता है।",
};

export default function FAQPageContent({ faqData }: { faqData: FAQItem[] }) {
  const { language } = useLanguage();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = faqData.filter((item) => {
    const q = language === "hi" ? (FAQ_ITEMS_HI[item.q] || item.q) : item.q;
    const a = language === "hi" ? (ANSWERS_HI[item.q] || item.a) : item.a;
    const query = searchQuery.toLowerCase();
    return q.toLowerCase().includes(query) || a.toLowerCase().includes(query);
  });

  return (
    <>
      <GridBackground />
      <section className="pt-28 pb-20 md:pt-36">
        <Container size="narrow">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-12"
          >
            <p className="text-[10px] font-bold uppercase tracking-[.14em] text-aura-burgundy mb-4">FAQ</p>
            <h1 className="text-3xl md:text-4xl font-bold text-aura-text leading-tight mb-4">
              {language === "hi" ? "अक्सर पूछे जाने वाले सवाल" : "Frequently asked questions"}
            </h1>
            <p className="text-base text-aura-text-secondary max-w-xl">
              {language === "hi"
                ? "Aura के बारे में सबसे ज़्यादा पूछे जाने वाले सवालों के जवाब।"
                : "Quick answers about Aura — features, pricing, setup and security."}
            </p>
          </motion.div>

          {/* Search */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="relative mb-8"
          >
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-aura-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={language === "hi" ? "सवाल खोजें..." : "Search questions..."}
              className="w-full rounded-xl border border-aura-border bg-white pl-10 pr-4 py-3 text-sm text-aura-text placeholder:text-aura-text-muted focus:outline-none focus:border-aura-burgundy focus:ring-2 focus:ring-aura-burgundy/10 transition-all"
              aria-label={language === "hi" ? "सवाल खोजें" : "Search questions"}
            />
          </motion.div>

          {/* FAQ items */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="space-y-2"
          >
            {filtered.map((item, i) => {
              const isOpen = openIndex === i;
              const question = language === "hi" ? (FAQ_ITEMS_HI[item.q] || item.q) : item.q;
              const answer = language === "hi" ? (ANSWERS_HI[item.q] || item.a) : item.a;

              return (
                <div
                  key={i}
                  className="rounded-xl border border-aura-border bg-white overflow-hidden transition-colors hover:border-aura-rose"
                >
                  <button
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  >
                    <span className="text-sm font-semibold text-aura-text">{question}</span>
                    <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-md bg-aura-surface-muted text-aura-text-muted">
                      {isOpen ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-4 text-sm text-aura-text-secondary leading-relaxed">
                          {answer}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div className="py-16 text-center text-sm text-aura-text-muted">
                {language === "hi" ? "कोई सवाल नहीं मिला" : "No matching questions found"}
              </div>
            )}
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-16 text-center"
          >
            <p className="text-sm text-aura-text-secondary mb-4">
              {language === "hi" ? "अभी भी सवाल हैं?" : "Still have questions?"}
            </p>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 rounded-xl bg-aura-burgundy px-6 py-3 text-sm font-medium text-white transition-all hover:bg-aura-burgundy-strong hover:shadow-lg"
            >
              {language === "hi" ? "हमसे संपर्क करें" : "Contact us"}
            </a>
          </motion.div>
        </Container>
      </section>
    </>
  );
}
