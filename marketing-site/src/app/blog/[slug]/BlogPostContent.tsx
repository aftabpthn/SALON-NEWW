"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { motion, useScroll, useSpring } from "motion/react";
import { ArrowLeft, Clock, ChevronRight, Share2, Link2, Check } from "lucide-react";
import { BLOG_POSTS } from "@/lib/constants";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { BLOG_CONTENT_HI, BLOG_META_HI } from "@/lib/translations";

const BLOG_CONTENT: Record<string, string> = {
  "how-to-increase-salon-revenue": `
Running a profitable salon isn't just about great haircuts — it's about smart business decisions. Here are seven proven strategies that top-performing salons use to boost revenue by 30-50%.

## 1. Implement Smart Pricing

Don't just set prices and forget. Use data to understand which services have the highest margins and adjust accordingly. Happy hours during slow periods can fill empty slots without cannibalizing peak revenue.

## 2. Upsell with Intelligence

Train your staff to suggest complementary services naturally. A haircut client could benefit from a conditioning treatment. A coloring client might appreciate a maintenance kit. Use AI recommendations to guide your team.

## 3. Reduce No-Shows Dramatically

No-shows cost Indian salons an estimated 15-20% of potential revenue. Implement automated WhatsApp reminders 24 hours and 1 hour before appointments. Consider a small deposit for high-value services.

## 4. Launch a Membership Program

Recurring revenue is the backbone of a stable salon business. Offer monthly memberships that include perks like priority booking, discounted services, and exclusive products.

## 5. Optimize Your Staff Schedule

Use appointment data to identify peak hours and staff accordingly. Overstaffing during slow periods wastes money. Understaffing during rush hours loses clients.

## 6. Leverage Customer Data

Your CRM is a goldmine. Analyze visit frequency, average spend, and service preferences. Create targeted campaigns for at-risk clients who haven't visited in 60+ days.

## 7. Automate Your Marketing

Set up automated birthday campaigns, festival promotions, and re-engagement sequences. This runs 24/7 without consuming your time.
  `,

  "salon-staff-management-guide": `
Managing salon staff effectively is the difference between a thriving business and a chaotic one. This guide covers everything from attendance to performance optimization.

## The Attendance Challenge

Manual attendance systems are prone to buddy punching and errors. Modern solutions include biometric verification, face recognition, and GPS-based mobile check-ins.

## Commission Structures That Work

The best commission structures incentivize behavior that benefits the salon — not just individual revenue. Consider tiered commissions that reward consistency, client retention, and upselling.

## Performance Tracking

What gets measured gets improved. Track metrics like revenue per stylist, client retention rate, and average service time. Share these metrics transparently with your team.

## Payroll Made Simple

Automated payroll eliminates errors and saves hours every month. Integrate attendance, commissions, deductions, and bonuses into a single automated system.
  `,

  "digital-transformation-salon": `
The Indian salon industry is worth over ₹50,000 crore and growing at 20% annually. Yet most salons still run on paper registers, WhatsApp groups, and manual billing. Here's why going digital isn't just nice to have — it's survival.

## The Cost of Staying Manual

A typical salon with 5 staff members loses approximately ₹2-4 lakh per year to no-shows, billing errors, inventory waste, and inefficient scheduling. These aren't rare edge cases — they're everyday leaks that compound month after month.

## What Digital Transformation Actually Means

Digital transformation isn't about buying expensive software. It's about replacing manual, error-prone processes with automated, data-driven ones. For salons, this covers five core areas:

- **Appointments** — Move from phone calls and walk-ins to an online booking system that works 24/7
- **Billing** — Replace manual bills with GST-compliant invoicing and digital payment integration
- **Client Management** — Track every client's history, preferences, and spending patterns automatically
- **Inventory** — Know exactly what's in stock, what's expiring, and what needs reordering
- **Marketing** — Automate birthday messages, follow-ups, and re-engagement campaigns

## Starting Small, Scaling Fast

You don't need to digitize everything at once. Start with the biggest pain point — usually billing and appointments. Once that's working, expand to CRM and inventory. Most salons see ROI within the first month of switching to digital billing alone.

## The Technology Stack That Works

The best salon platforms are built for the Indian market. They support UPI payments, GST invoicing, WhatsApp integration, and multi-language interfaces. Look for systems that work on mobile, don't require expensive hardware, and can scale from 1 branch to 50.

## Real Results from Real Salons

Salons that have completed their digital transformation report:
- 40% reduction in no-shows through automated reminders
- 25% increase in repeat visits through better client tracking
- 60% less time spent on billing and reconciliation
- 30% reduction in inventory waste

## The Bottom Line

Digital transformation is no longer optional for salons that want to compete. The question isn't whether to go digital — it's how quickly you can start.
  `,

  "gst-billing-salon-guide": `
GST compliance can feel overwhelming for salon owners, but it's actually straightforward once you understand the basics. This guide walks you through everything you need to know.

## Understanding GST for Salons

Salon services fall under the **5% GST rate** (without input tax credit) or **12% GST rate** (with input tax credit). Most small salons opt for the Composition Scheme at 6% turnover tax, which simplifies compliance significantly.

## When Do You Need GST Registration?

You must register for GST if your annual turnover exceeds ₹40 lakh for goods or ₹20 lakh for services. Since salon services are classified under services, the ₹20 lakh threshold applies. Even if you're below this threshold, voluntary registration can be beneficial for claiming input credits.

## Creating Compliant Invoices

Every invoice must include:
- Your salon's GSTIN (GST Identification Number)
- Client's GSTIN (if B2B)
- HSN/SAC code for salon services (SAC 9985)
- Invoice number with proper sequencing
- Date of issue
- Taxable value split by CGST and SGST (intra-state) or IGST (inter-state)

## Input Tax Credit (ITC)

If you opt for the 12% rate, you can claim input tax credit on purchases — salon equipment, products, furniture, rent (under certain conditions), and utilities. This can reduce your effective tax burden significantly.

## Filing Returns

Salons registered under the regular scheme must file:
- **GSTR-1** (outward supplies) — monthly or quarterly
- **GSTR-3B** (summary return) — monthly or quarterly
- **GSTR-9** (annual return) — yearly

The Composition Scheme requires only a quarterly **CMP-08** and an annual **GSTR-4**.

## Common Mistakes to Avoid

- Not issuing proper GST-compliant invoices
- Missing return filing deadlines (late fees are ₹50/day)
- Claiming ITC on items not eligible for credit
- Not reconciling purchases with GSTR-2B
- Mixing up CGST/SGST (intra-state) with IGST (inter-state)

## How Aura Automates GST

A platform like Aura handles GST automatically — calculating the right rates, generating compliant invoices, tracking input credits, and preparing return data. You focus on your clients while the system handles compliance.
  `,

  "salon-marketing-automation": `
Marketing automation transforms your salon from a business that constantly hunts for clients into one that attracts and retains them on autopilot. Here's how to set it up.

## Why Manual Marketing Fails

Sending individual WhatsApp messages, manually posting on Instagram, and remembering to follow up with clients is unsustainable. As your client base grows beyond 200 people, manual marketing becomes a full-time job that takes you away from actually running the salon.

## The Three Automation Pillars

### 1. Birthday & Anniversary Campaigns

Set up automated birthday messages with a special offer — a free add-on service, 20% discount, or a complimentary consultation. Clients love being remembered, and birthday campaigns typically see 3-5x higher redemption rates than generic promotions.

### 2. Re-engagement Sequences

When a client hasn't visited in 45 days, trigger a gentle reminder. At 60 days, send a special "we miss you" offer. At 90 days, a final outreach. This three-touch sequence can recover 20-30% of lapsed clients.

### 3. Post-Visit Follow-ups

After every visit, send a thank-you message with a review request. Two days later, share care tips related to their service. A week later, suggest their next appointment. This keeps your salon top-of-mind without being pushy.

## WhatsApp Marketing Done Right

WhatsApp has 500M+ users in India — it's the most direct channel to your clients. But respect the platform:
- Never send more than 1 message per week unless it's transactional
- Always include an opt-out option
- Use templates for consistency
- Personalize with the client's name and last service

## Setting Up Your Automation

Start with these three workflows and expand from there:
- **Welcome sequence** — New client gets a series of messages over their first month
- **Birthday campaign** — Automated message on their special day
- **Re-engagement** — Win back lapsed clients automatically

## Measuring Success

Track these metrics to know if your automation is working:
- Message open rate (WhatsApp: aim for 80%+)
- Offer redemption rate (aim for 15-25%)
- Client retention rate (aim for 70%+ monthly return)
- Revenue from automated campaigns vs. manual efforts

## The ROI of Automation

A salon with 500 clients spending an average of ₹2,000 per visit can generate an additional ₹1-2 lakh per month from automated re-engagement and birthday campaigns alone — with zero manual effort after setup.
  `,

  "salon-inventory-management": `
Salon products are expensive, expire quickly, and are surprisingly easy to lose track of. Effective inventory management can save your salon 30-60% on product costs annually.

## The Hidden Cost of Poor Inventory

Most salon owners don't realize how much they lose to inventory issues:
- **Expired products** — Average salon throws away ₹30,000-50,000 worth of expired products yearly
- **Stockouts** — Running out of a key product means lost sales and unhappy clients
- **Theft and shrinkage** — Without tracking, product usage can't be verified
- **Over-ordering** — Buying in bulk "for savings" often leads to more waste

## The ABC Analysis

Categorize your products into three groups:
- **A items** (top 20% by value) — Track daily, reorder precisely
- **B items** (next 30%) — Track weekly, maintain buffer stock
- **C items** (bottom 50%) — Track monthly, order as needed

## Setting Reorder Points

For each product, calculate: **Reorder Point = Daily Usage × Lead Time + Safety Stock**

For example, if you use 2 bottles of shampoo per day and your supplier takes 3 days to deliver: 2 × 3 + 5 (safety) = 11 bottles. When stock hits 11, reorder.

## Waste Reduction Strategies

- **First-In-First-Out (FIFO)** — Always use older stock first
- **Service-based allocation** — Pre-portion products per service to prevent overuse
- **Expiry tracking** — Flag products 30 days before expiry for priority use
- **Usage reporting** — Compare actual usage against expected usage per service

## The Technology Solution

Manual inventory tracking in Excel or notebooks doesn't scale. Modern salon platforms offer:
- Barcode scanning for quick stock updates
- Automatic usage tracking tied to billing
- AI-powered reorder suggestions based on historical data
- Multi-location inventory visibility
- Expiry date monitoring with alerts

## Real Numbers from Real Salons

Salons that implement proper inventory management typically see:
- 60% reduction in expired product waste
- 25% decrease in overall product spending
- Zero stockout incidents on key products
- 3-4 hours saved per week on manual counting
  `,
};

interface BlogPostContentProps {
  slug: string;
}

function ReadingProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });

  return (
    <motion.div
      className="fixed top-0 left-0 right-0 h-[2px] z-50 origin-left"
      style={{
        scaleX,
        background: "linear-gradient(90deg, var(--color-aura-burgundy), var(--color-aura-copper))",
      }}
      aria-hidden="true"
    />
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function ShareBar({ title, excerpt }: { title: string; excerpt: string }) {
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState("");

  useEffect(() => {
    setUrl(window.location.href);
  }, []);

  const shareLinks = [
    {
      name: "X",
      icon: XIcon,
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`,
    },
    {
      name: "LinkedIn",
      icon: LinkedInIcon,
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    },
    {
      name: "WhatsApp",
      icon: Share2,
      href: `https://wa.me/?text=${encodeURIComponent(`${title}\n${url}`)}`,
    },
  ];

  const copyLink = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-12 pt-8 border-t border-aura-border">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[.14em] text-aura-text-muted">
          Share this article
        </p>
        <div className="flex items-center gap-2">
          {shareLinks.map((link) => {
            const Icon = link.icon;
            return (
              <a
                key={link.name}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Share on ${link.name}`}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-aura-border bg-white text-aura-text-muted transition-all hover:border-aura-burgundy hover:text-aura-burgundy hover:shadow-sm"
              >
                <Icon className="h-4 w-4" />
              </a>
            );
          })}
          <button
            type="button"
            onClick={copyLink}
            aria-label={copied ? "Link copied" : "Copy link"}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-aura-border bg-white text-aura-text-muted transition-all hover:border-aura-burgundy hover:text-aura-burgundy hover:shadow-sm"
          >
            {copied ? <Check className="h-4 w-4 text-aura-success" /> : <Link2 className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function RelatedPosts({ currentSlug, currentCategory }: { currentSlug: string; currentCategory: string }) {
  const { language } = useLanguage();
  const related = useMemo(() => {
    const sameCategory = BLOG_POSTS.filter((p) => p.slug !== currentSlug && p.category === currentCategory);
    const others = BLOG_POSTS.filter((p) => p.slug !== currentSlug && p.category !== currentCategory);
    return [...sameCategory, ...others].slice(0, 3);
  }, [currentSlug, currentCategory]);

  if (related.length === 0) return null;

  return (
    <div className="mt-16 pt-12 border-t border-aura-border">
      <h2 className="text-xl font-bold text-aura-text mb-6">
        {language === "hi" ? "इसे भी पढ़ें" : "Continue reading"}
      </h2>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {related.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group block rounded-xl border border-aura-border bg-white p-5 transition-all hover:shadow-[var(--aura-shadow-md)] hover:border-aura-rose"
          >
            <Badge className="mb-3 text-[10px]">{post.category}</Badge>
            <h3 className="text-sm font-semibold text-aura-text leading-snug mb-2 line-clamp-2 group-hover:text-aura-burgundy transition-colors">
              {post.title}
            </h3>
            <p className="text-xs text-aura-text-muted line-clamp-2">
              {post.excerpt}
            </p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-aura-burgundy opacity-0 transition-all group-hover:opacity-100">
              {language === "hi" ? "पढ़ें" : "Read more"} <ChevronRight className="h-3 w-3" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function BlogPostContent({ slug }: BlogPostContentProps) {
  const { language, t } = useLanguage();
  const post = BLOG_POSTS.find((p) => p.slug === slug);

  if (!post) {
    return (
      <Container className="pt-40 pb-20 text-center">
         <h1 className="text-2xl font-bold text-aura-text">{t("blog.postMissing")}</h1>
         <Link href="/blog" className="text-neon-violet mt-4 inline-block">← {t("common.backBlog")}</Link>
      </Container>
    );
  }

  const translated = language === "hi" ? BLOG_META_HI[slug] : undefined;
  const content = language === "hi" ? BLOG_CONTENT_HI[slug] || translated?.excerpt || post.excerpt : BLOG_CONTENT[slug] || post.excerpt;

  // Render content: split by double newlines, detect headings and bold
  const renderContent = (text: string) => {
    const blocks = text.split("\n\n").filter((b) => b.trim());
    return blocks.map((block, i) => {
      const trimmed = block.trim();

      // Heading
      if (trimmed.startsWith("## ")) {
        const headingText = trimmed.replace("## ", "");
        const headingId = headingText.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return (
          <h2 key={i} id={headingId} className="text-xl md:text-2xl font-bold text-aura-text mt-10 mb-4 first:mt-0 scroll-mt-28">
            {headingText}
          </h2>
        );
      }

      if (trimmed.startsWith("### ")) {
        return <h3 key={i} className="mt-8 mb-3 text-lg font-bold text-aura-text">{trimmed.replace("### ", "")}</h3>;
      }

      // List items (lines starting with -)
      if (trimmed.startsWith("- ")) {
        const items = trimmed.split("\n").filter((l) => l.startsWith("- "));
        return (
          <ul key={i} className="list-disc list-inside space-y-2 mb-4 text-base text-aura-text-secondary leading-relaxed pl-2">
            {items.map((item, j) => (
              <li key={j}>{renderInline(item.replace(/^-\s*/, ""))}</li>
            ))}
          </ul>
        );
      }

      // Normal paragraph
      return (
        <p key={i} className="text-base text-aura-text-secondary leading-relaxed mb-4">
          {renderInline(trimmed)}
        </p>
      );
    });
  };

  // Render inline formatting: **bold**
  const renderInline = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} className="font-semibold text-aura-text">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  const toc = useMemo(() => {
    if (!content) return [];
    return content.split("\n").filter((l) => l.trim().startsWith("## ")).map((l) => ({
      id: l.trim().replace(/^##\s+/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      label: l.trim().replace(/^##\s+/, ""),
    }));
  }, [content]);

  return (
    <>
      {/* Reading progress */}
      <ReadingProgress />

      <section className="pt-28 pb-8 md:pt-36 bg-gradient-to-b from-aura-bg to-white">
        <Container>
          <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-aura-text-muted hover:text-aura-text transition-colors mb-8">
            <ArrowLeft className="w-4 h-4" />
             {t("common.backBlog")}
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl"
          >
            <div className="flex items-center gap-3 mb-4">
               <Badge>{translated?.category ?? post.category}</Badge>
              <span className="flex items-center gap-1 text-xs text-aura-text-muted">
                <Clock className="w-3 h-3" />
                 {translated?.readTime ?? post.readTime}
              </span>
              <span className="text-xs text-aura-text-muted">
                 {new Date(post.date).toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", { year: "numeric", month: "long", day: "numeric" })}
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-aura-text leading-tight">
               {translated?.title ?? post.title}
            </h1>
            <p className="mt-4 text-base text-aura-text-secondary leading-relaxed max-w-2xl">
              {post.excerpt}
            </p>
          </motion.div>
        </Container>
      </section>

      <section className="pb-20 md:pb-28 bg-white">
        <Container size="wide">
          <div className="mx-auto flex max-w-5xl gap-12">
            {/* Table of contents - sidebar */}
            {toc.length > 0 && (
              <aside className="hidden lg:block w-56 shrink-0 pt-2">
                <div className="sticky top-28">
                  <p className="text-[10px] font-bold uppercase tracking-[.14em] text-aura-text-muted mb-4">
                    {language === "hi" ? "इस लेख में" : "In this article"}
                  </p>
                  <nav aria-label="Table of contents">
                    <ul className="space-y-1">
                      {toc.map((item) => (
                        <li key={item.id}>
                          <a
                            href={`#${item.id}`}
                            className="group flex items-center gap-1.5 py-1.5 text-xs text-aura-text-muted transition-colors hover:text-aura-burgundy"
                          >
                            <ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                            <span className="line-clamp-2">{item.label}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </nav>
                </div>
              </aside>
            )}

            {/* Article body */}
            <motion.article
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="min-w-0 max-w-3xl prose-aura"
            >
              {renderContent(content)}
            </motion.article>
          </div>

          {/* Share bar */}
          <ShareBar title={post.title} excerpt={post.excerpt} />

          {/* Related posts */}
          <RelatedPosts currentSlug={post.slug} currentCategory={post.category} />
        </Container>
      </section>
    </>
  );
}
