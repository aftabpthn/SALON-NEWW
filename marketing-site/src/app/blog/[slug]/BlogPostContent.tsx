"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowLeft, Clock } from "lucide-react";
import { BLOG_POSTS } from "@/lib/constants";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";

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

export function BlogPostContent({ slug }: BlogPostContentProps) {
  const post = BLOG_POSTS.find((p) => p.slug === slug);

  if (!post) {
    return (
      <Container className="pt-40 pb-20 text-center">
        <h1 className="text-2xl font-bold text-aura-text">Post not found</h1>
        <Link href="/blog" className="text-neon-violet mt-4 inline-block">← Back to blog</Link>
      </Container>
    );
  }

  const content = BLOG_CONTENT[slug] || post.excerpt;

  // Render content: split by double newlines, detect headings and bold
  const renderContent = (text: string) => {
    const blocks = text.split("\n\n").filter((b) => b.trim());
    return blocks.map((block, i) => {
      const trimmed = block.trim();

      // Heading
      if (trimmed.startsWith("## ")) {
        return (
          <h2 key={i} className="text-xl md:text-2xl font-bold text-aura-text mt-10 mb-4 first:mt-0">
            {trimmed.replace("## ", "")}
          </h2>
        );
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

  return (
    <>
      <section className="pt-28 pb-8 md:pt-36 bg-gradient-to-b from-aura-bg to-white">
        <Container>
          <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-aura-text-muted hover:text-aura-text transition-colors mb-8">
            <ArrowLeft className="w-4 h-4" />
            Back to blog
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl"
          >
            <div className="flex items-center gap-3 mb-4">
              <Badge>{post.category}</Badge>
              <span className="flex items-center gap-1 text-xs text-aura-text-muted">
                <Clock className="w-3 h-3" />
                {post.readTime}
              </span>
              <span className="text-xs text-aura-text-muted">
                {new Date(post.date).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-aura-text leading-tight">
              {post.title}
            </h1>
          </motion.div>
        </Container>
      </section>

      <section className="pb-20 md:pb-28 bg-white">
        <Container size="narrow">
          <motion.article
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="prose-aura"
          >
            {renderContent(content)}
          </motion.article>
        </Container>
      </section>
    </>
  );
}
