const DEFAULT_GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const MAX_BUSINESSES = 12;
const MAX_PHOTOS = 5;
const MAX_BASE64_PHOTO_BYTES = 4 * 1024 * 1024;

export async function createLiveConsultation(payload = {}) {
  const request = sanitizeConsultationRequest(payload);
  const local = buildLocalConsultation(request);
  const ai = await maybeRunAiConsultation(request, local).catch((error) => ({
    ...local,
    mode: "local",
    provider: "local_rules",
    providerWarning: error?.message || "AI consultation unavailable"
  }));
  return {
    consultationId: `consult_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...ai
  };
}

function sanitizeConsultationRequest(payload) {
  const message = cleanText(payload.message, 1600);
  const goals = arrayOfText(payload.goals, 8, 80);
  const location = sanitizeLocation(payload.location || {});
  const businesses = Array.isArray(payload.businesses)
    ? payload.businesses.slice(0, MAX_BUSINESSES).map(sanitizeBusiness).filter(Boolean)
    : [];
  const photos = Array.isArray(payload.photos)
    ? payload.photos.slice(0, MAX_PHOTOS).map(sanitizePhoto).filter(Boolean)
    : [];
  return { message, goals, location, businesses, photos };
}

function sanitizeLocation(location) {
  return {
    label: cleanText(location.label, 120) || "Current area",
    lat: finiteNumber(location.lat),
    lng: finiteNumber(location.lng)
  };
}

function sanitizeBusiness(business) {
  const services = Array.isArray(business.services)
    ? business.services.slice(0, 8).map((service) => ({
      id: cleanText(service.id, 80),
      name: cleanText(service.name, 120),
      category: cleanText(service.category, 80),
      description: cleanText(service.description, 220),
      pricePaise: finiteNumber(service.pricePaise) || 0,
      durationMinutes: finiteNumber(service.durationMinutes) || 0
    })).filter((service) => service.name)
    : [];
  const item = {
    id: cleanText(business.id, 80),
    slug: cleanText(business.slug, 120),
    businessName: cleanText(business.businessName, 160),
    category: cleanText(business.category, 80),
    description: cleanText(business.description, 260),
    address: cleanText(business.address, 220),
    area: cleanText(business.area, 100),
    city: cleanText(business.city, 100),
    state: cleanText(business.state, 100),
    country: cleanText(business.country, 100),
    phone: cleanText(business.phone || business.mobileNumber || business.appointmentNumber, 80),
    mapsUrl: cleanText(business.mapsUrl, 320),
    ratingAverage: finiteNumber(business.ratingAverage) || 0,
    ratingCount: finiteNumber(business.ratingCount) || 0,
    distanceKm: finiteNumber(business.distanceKm),
    isOpen: Boolean(business.isOpen),
    hoursLabel: cleanText(business.hoursLabel, 120),
    nextAvailableSlot: cleanText(business.nextAvailableSlot, 120),
    startingPricePaise: finiteNumber(business.startingPricePaise) || 0,
    popularService: cleanText(business.popularService, 120),
    services
  };
  return item.businessName ? item : null;
}

function sanitizePhoto(photo) {
  const dataUrl = cleanText(photo.dataUrl, MAX_BASE64_PHOTO_BYTES + 80);
  const type = cleanText(photo.type, 80);
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) return null;
  if (dataUrl.length > MAX_BASE64_PHOTO_BYTES + 80) return null;
  return {
    name: cleanText(photo.name, 140) || "consultation-photo",
    type: type || "image/jpeg",
    sizeBytes: Math.min(finiteNumber(photo.sizeBytes) || 0, MAX_BASE64_PHOTO_BYTES),
    dataUrl
  };
}

async function maybeRunGroqConsultation(request, fallback) {
  const apiKey = process.env.GROQ_API_KEY || "";
  if (!apiKey) return fallback;

  const prompt = buildConsultationPrompt(request);
  const content = [{ type: "text", text: prompt }];
  request.photos.forEach((photo) => {
    content.push({ type: "image_url", image_url: { url: photo.dataUrl } });
  });

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: "You are Aura Shine Live Consultation AI for salons, spas, barbers, nail studios and skin clinics. Return only valid JSON."
        },
        { role: "user", content }
      ],
      temperature: 0.35,
      max_completion_tokens: 1400,
      response_format: { type: "json_object" }
    })
  });
  if (!response.ok) throw new Error(`Groq returned ${response.status}`);
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || "";
  const parsed = JSON.parse(text);
  return normalizeAiConsultation(parsed, fallback, "groq");
}

async function maybeRunAiConsultation(request, fallback) {
  const provider = selectedAiProvider();
  if (provider === "gemini") return maybeRunGeminiConsultation(request, fallback);
  if (provider === "local") return fallback;
  return maybeRunGroqConsultation(request, fallback);
}

async function maybeRunGeminiConsultation(request, fallback) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
  if (!apiKey) return fallback;

  const prompt = buildConsultationPrompt(request);
  const parts = [{ text: prompt }, ...request.photos.map(geminiImagePart).filter(Boolean)];
  const model = encodeURIComponent(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 1400,
        responseMimeType: "application/json"
      },
      systemInstruction: {
        parts: [{ text: "You are Aura Shine Live Consultation AI for salons, spas, barbers, nail studios and skin clinics. Return only valid JSON." }]
      }
    })
  });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  const parsed = JSON.parse(text);
  return normalizeAiConsultation(parsed, fallback, "gemini");
}

function selectedAiProvider() {
  const requested = cleanText(process.env.AI_CONSULTATION_PROVIDER || process.env.LIVE_CONSULTATION_PROVIDER, 40).toLowerCase();
  if (requested === "gemini" || requested === "groq" || requested === "local") return requested;
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) return "gemini";
  return "local";
}

function geminiImagePart(photo) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(photo.dataUrl || "");
  if (!match) return null;
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2]
    }
  };
}

function buildConsultationPrompt(request) {
  return [
    "Create a customer-facing salon consultation using the supplied live marketplace context.",
    "Primary goals:",
    "- Ask sharp intake questions only when needed.",
    "- Analyze uploaded photos if present, but never diagnose medical conditions.",
    "- Suggest matching salons, services, price ranges, time needs, care prep, and booking next steps.",
    "- Include location A-to-Z details: area fit, travel clue, address, open/slot signal, map/contact clue when available.",
    "- Prefer businesses and services from the supplied context. Do not invent unavailable salons.",
    "- Keep advice practical for Indian salon/spa customers and franchise-ready operations.",
    "Return JSON with keys: answer, actionPlan, recommendedSalons, recommendedServices, locationInsights, followUpQuestions, safetyNote.",
    "recommendedSalons items: businessName, slug, reason, location, distanceKm, rating, openStatus, nextStep.",
    "recommendedServices items: name, businessName, slug, priceLabel, durationLabel, reason.",
    `Customer message: ${request.message || "Customer wants a beauty/wellness recommendation."}`,
    `Customer goals: ${request.goals.join(", ") || "not specified"}`,
    `Customer location: ${JSON.stringify(request.location)}`,
    `Photos attached: ${request.photos.length}`,
    `Marketplace context: ${JSON.stringify(request.businesses)}`
  ].join("\n");
}

function normalizeAiConsultation(parsed, fallback, provider) {
  return {
    mode: provider,
    provider,
    answer: cleanText(parsed.answer, 1200) || fallback.answer,
    actionPlan: arrayOfText(parsed.actionPlan, 6, 180).length ? arrayOfText(parsed.actionPlan, 6, 180) : fallback.actionPlan,
    recommendedSalons: normalizeSalonRecommendations(parsed.recommendedSalons, fallback.recommendedSalons),
    recommendedServices: normalizeServiceRecommendations(parsed.recommendedServices, fallback.recommendedServices),
    locationInsights: arrayOfText(parsed.locationInsights, 5, 180).length ? arrayOfText(parsed.locationInsights, 5, 180) : fallback.locationInsights,
    followUpQuestions: arrayOfText(parsed.followUpQuestions, 4, 160).length ? arrayOfText(parsed.followUpQuestions, 4, 160) : fallback.followUpQuestions,
    safetyNote: cleanText(parsed.safetyNote, 220) || fallback.safetyNote
  };
}

function buildLocalConsultation(request) {
  const ranked = rankBusinesses(request);
  const services = ranked.flatMap((business) => business.services.slice(0, 3).map((service) => ({ business, service }))).slice(0, 6);
  const goalText = request.goals.length ? request.goals.join(", ") : "your concern";
  return {
    mode: "local",
    provider: "local_rules",
    answer: `I can help you plan ${goalText}. Share your budget, preferred time and any sensitivity history, then pick one of the matched salons below. ${request.photos.length ? "I have attached your photos to the consultation context for visual review." : "You can add photos for a more precise consultation."}`,
    actionPlan: [
      "Confirm the exact concern, event date, budget and time window.",
      "Shortlist one nearby salon and one backup option.",
      "Choose a service with the right duration, patch-test needs and after-care.",
      "Book the slot, then keep photos and notes attached for staff handoff."
    ],
    recommendedSalons: ranked.slice(0, 4).map((business) => ({
      businessName: business.businessName,
      slug: business.slug,
      reason: [business.popularService || business.category, business.ratingAverage ? `${business.ratingAverage}/5 rating` : "", business.isOpen ? "open now" : business.hoursLabel].filter(Boolean).join(" | "),
      location: [business.area, business.city, business.state].filter(Boolean).join(", ") || business.address,
      distanceKm: business.distanceKm,
      rating: business.ratingAverage,
      openStatus: business.isOpen ? "Open now" : business.hoursLabel || "Check hours",
      nextStep: business.nextAvailableSlot ? `Book ${business.nextAvailableSlot}` : "View services and available slots"
    })),
    recommendedServices: services.map(({ business, service }) => ({
      name: service.name,
      businessName: business.businessName,
      slug: business.slug,
      priceLabel: moneyLabel(service.pricePaise || business.startingPricePaise),
      durationLabel: service.durationMinutes ? `${service.durationMinutes} min` : "Duration on booking",
      reason: service.description || `Matches ${business.category || "salon"} consultation intent`
    })),
    locationInsights: [
      `Current area: ${request.location.label || "not detected"}.`,
      ranked[0] ? `Best first option: ${ranked[0].businessName} in ${ranked[0].area || ranked[0].city || "nearby area"}.` : "No live salon context is available yet.",
      "Check map, travel time, open status and next available slot before confirming."
    ],
    followUpQuestions: [
      "What result do you want and by when?",
      "Any allergy, sensitivity, previous color, acne treatment or recent procedure?",
      "What budget and travel radius should I keep?",
      "Do you prefer a specific staff gender or specialist?"
    ],
    safetyNote: "This is beauty guidance, not medical diagnosis. For irritation, wounds, infection, pregnancy concerns or active skin conditions, consult a qualified professional before booking."
  };
}

function rankBusinesses(request) {
  const text = [request.message, ...request.goals].join(" ").toLowerCase();
  return [...request.businesses].sort((left, right) => scoreBusiness(right, text) - scoreBusiness(left, text));
}

function scoreBusiness(business, text) {
  const serviceMatch = business.services.some((service) => text && [service.name, service.category, service.description].join(" ").toLowerCase().includes(text)) ? 18 : 0;
  const categoryMatch = text && [business.category, business.popularService, business.description].join(" ").toLowerCase().split(/\s+/).some((word) => word.length > 3 && text.includes(word)) ? 12 : 0;
  const distanceScore = Number.isFinite(business.distanceKm) ? Math.max(0, 8 - business.distanceKm) : 2;
  return serviceMatch + categoryMatch + Number(business.ratingAverage || 0) + distanceScore + (business.isOpen ? 4 : 0);
}

function normalizeSalonRecommendations(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 4).map((item) => ({
    businessName: cleanText(item.businessName, 160),
    slug: cleanText(item.slug, 120),
    reason: cleanText(item.reason, 240),
    location: cleanText(item.location, 220),
    distanceKm: finiteNumber(item.distanceKm),
    rating: finiteNumber(item.rating),
    openStatus: cleanText(item.openStatus, 120),
    nextStep: cleanText(item.nextStep, 180)
  })).filter((item) => item.businessName);
}

function normalizeServiceRecommendations(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 6).map((item) => ({
    name: cleanText(item.name, 140),
    businessName: cleanText(item.businessName, 160),
    slug: cleanText(item.slug, 120),
    priceLabel: cleanText(item.priceLabel, 80),
    durationLabel: cleanText(item.durationLabel, 80),
    reason: cleanText(item.reason, 220)
  })).filter((item) => item.name);
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function arrayOfText(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function moneyLabel(pricePaise) {
  const paise = finiteNumber(pricePaise) || 0;
  return paise > 0 ? `Rs ${Math.round(paise / 100).toLocaleString("en-IN")}` : "Price on selection";
}
