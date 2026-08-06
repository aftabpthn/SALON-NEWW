import type { Metadata } from "next";
import { BLOG_POSTS } from "@/lib/constants";
import { breadcrumbJsonLd } from "@/lib/seo";
import { BlogPostContent } from "./BlogPostContent";
import { SITE_URL } from "@/lib/site";

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = BLOG_POSTS.find((p) => p.slug === slug);
  if (!post) return { title: "Post Not Found" };

  const url = `${SITE_URL}/blog/${post.slug}`;

  return {
    title: post.title,
    description: post.excerpt,
    keywords: [
      `salon ${post.category.toLowerCase()}`, "salon tips India", "salon business guide",
      post.title.split(" ").slice(0, 4).join(" ").toLowerCase(),
    ],
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.date,
      tags: [post.category, "salon", "India"],
      url,
      images: [{ url: "/og?path=blog", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
      images: ["/og?path=blog"],
    },
    alternates: {
      canonical: url,
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = BLOG_POSTS.find((p) => p.slug === slug);

  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Blog", url: "/blog" },
    { name: post?.title || "Article", url: `/blog/${slug}` },
  ]);

  const jsonLd = post
    ? {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: post.title,
        description: post.excerpt,
        datePublished: post.date,
        url: `${SITE_URL}/blog/${post.slug}`,
        author: {
          "@type": "Organization",
          name: "Aura Salon CRM/POS",
          url: SITE_URL,
        },
        publisher: {
          "@type": "Organization",
          name: "Aura Salon CRM/POS",
          url: SITE_URL,
        },
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": `${SITE_URL}/blog/${post.slug}`,
        },
      }
    : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <BlogPostContent slug={slug} />
    </>
  );
}
