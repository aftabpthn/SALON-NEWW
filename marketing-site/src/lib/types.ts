export interface NavLink {
  label: string;
  href: string;
  description?: string;
}

export interface Feature {
  icon: string;
  title: string;
  description: string;
  href: string;
  color?: string;
}

export interface PricingTier {
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  description: string;
  features: string[];
  highlighted?: boolean;
  cta: string;
}

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  salon: string;
  city: string;
  rating: number;
}

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  category: string;
}

export interface FeaturePageData {
  translationKey: string;
  title: string;
  subtitle: string;
  icon: string;
  gradient: string;
  capabilities: {
    title: string;
    description: string;
  }[];
  stats?: {
    value: string;
    label: string;
  }[];
}
