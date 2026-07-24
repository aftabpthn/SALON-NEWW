import { MetadataRoute } from "next";

const BASE_URL = "https://aura.example.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 1.0 },
    { url: `${BASE_URL}/platform`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.9 },
    { url: `${BASE_URL}/owner-crm`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.85 },
    { url: `${BASE_URL}/customer-app`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.85 },
    { url: `${BASE_URL}/staff-app`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.85 },
    { url: `${BASE_URL}/workflows`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.85 },
    { url: `${BASE_URL}/pricing`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.8 },
    { url: `${BASE_URL}/demo`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.8 },
    { url: `${BASE_URL}/features`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.75 },
    { url: `${BASE_URL}/about`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.7 },
    { url: `${BASE_URL}/faq`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.7 },
    { url: `${BASE_URL}/blog`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.7 },
    { url: `${BASE_URL}/contact`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.7 },
    { url: `${BASE_URL}/customers`, lastModified: new Date(), changeFrequency: "monthly" as const, priority: 0.6 },
    { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: "yearly" as const, priority: 0.3 },
    { url: `${BASE_URL}/terms`, lastModified: new Date(), changeFrequency: "yearly" as const, priority: 0.3 },
    { url: `${BASE_URL}/cookies`, lastModified: new Date(), changeFrequency: "yearly" as const, priority: 0.3 },
  ];

  const featureRoutes = [
    "appointments", "billing", "client-crm", "compliance",
    "finance", "inventory", "marketing-ai", "staff-management", "white-label",
  ].map((slug) => ({
    url: `${BASE_URL}/features/${slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  const blogSlugs = [
    "how-to-increase-salon-revenue",
    "salon-staff-management-guide",
    "digital-transformation-salon",
    "gst-billing-salon-guide",
    "salon-marketing-automation",
    "salon-inventory-management",
  ].map((slug) => ({
    url: `${BASE_URL}/blog/${slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.5,
  }));

  return [...staticRoutes, ...featureRoutes, ...blogSlugs];
}
