export interface ServiceItem {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  pricePaise: number;
  category: string;
  popular?: boolean;
}

export interface StaffMember {
  id: string;
  name: string;
  title: string;
  rating: number;
  avatarGradient: string;
  specialty?: string;
  image?: string;
  nextAvailable?: string;
}

export interface BusinessReview {
  id: string;
  author: string;
  rating: number;
  text: string;
  dateLabel: string;
}

export interface Business {
  id: string;
  slug: string;
  businessName: string;
  category: string;
  description: string;
  address: string;
  area: string;
  city: string;
  distanceKm: number;
  ratingAverage: number;
  ratingCount: number;
  isOpen: boolean;
  nextAvailableSlot: string;
  hasOffer: boolean;
  offerText: string;
  coverGradient: string;
  coverImage: string;
  galleryImages: string[];
  popularService: string;
  startingPricePaise: number;
  categories: string[];
  services: ServiceItem[];
  staff: StaffMember[];
  reviews: BusinessReview[];
  policies?: string[];
}

export interface Booking {
  id: string;
  reference: string;
  businessName: string;
  serviceName: string;
  staffName: string;
  startsAt: string;
  address: string;
  status: "pending" | "confirmed" | "completed" | "cancelled";
}

export interface CustomerProfile {
  name: string;
  phone: string;
  isLoggedIn: boolean;
}

export interface BookingDraft {
  businessSlug: string;
  businessName: string;
  serviceName: string;
  staffName: string;
  startsAt: string;
  address: string;
}
