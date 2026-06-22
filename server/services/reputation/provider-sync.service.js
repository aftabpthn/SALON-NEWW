import { db } from "../../db.js";
import { makeId, now, parseJson, toJson } from "../enterprise-command-utils.js";

const DEFAULT_ENV_KEYS = {
  google: "GOOGLE_BUSINESS_PROFILE_ACCESS_TOKEN",
  instagram: "META_GRAPH_ACCESS_TOKEN",
  facebook: "META_GRAPH_ACCESS_TOKEN",
  yelp: "YELP_API_KEY"
};

export async function syncReputationPlatform(platform = {}, access = {}, payload = {}) {
  const code = String(platform.platformCode || platform.platform_code || "").toLowerCase();
  const providerConfig = { ...parseJson(platform.providerConfig || platform.provider_config_json, {}), ...(payload.providerConfig || {}) };
  const token = providerToken(code, providerConfig, payload);
  if (!token) {
    return {
      status: "not_configured",
      synced: false,
      importedReviews: 0,
      message: `${code || "platform"} token missing. Configure ${providerConfig.tokenEnvKey || DEFAULT_ENV_KEYS[code] || "provider token"} and run Sync now.`
    };
  }

  const externalReviews = await fetchProviderReviews(code, platform, token, providerConfig, payload);
  const imported = [];
  for (const review of externalReviews) {
    imported.push(upsertExternalReview(platform, review, access));
  }
  return {
    status: "synced",
    synced: true,
    importedReviews: imported.length,
    reviewIds: imported,
    message: `${imported.length} ${code} review signal(s) imported.`
  };
}

function providerToken(code, providerConfig = {}, payload = {}) {
  const direct = payload.accessToken || payload.apiKey || providerConfig.accessToken || providerConfig.apiKey;
  if (direct) return String(direct);
  const envKey = providerConfig.tokenEnvKey || payload.tokenEnvKey || DEFAULT_ENV_KEYS[code] || "";
  return envKey ? process.env[envKey] || "" : "";
}

async function fetchProviderReviews(code, platform, token, providerConfig, payload) {
  if (code === "yelp") return fetchYelpReviews(platform, token);
  if (code === "google") return fetchGoogleReviews(platform, token, providerConfig, payload);
  if (code === "instagram" || code === "facebook") return fetchInstagramSignals(platform, token, providerConfig, payload);
  return [];
}

async function fetchYelpReviews(platform, token) {
  const businessId = platform.businessListingId || platform.business_listing_id || "";
  if (!businessId) return [];
  const response = await fetchJson(`https://api.yelp.com/v3/businesses/${encodeURIComponent(businessId)}/reviews`, {
    headers: { authorization: `Bearer ${token}` }
  });
  return (response.reviews || []).map((review) => ({
    platformReviewId: review.id,
    reviewerName: review.user?.name || "Yelp reviewer",
    reviewerAvatar: review.user?.image_url || "",
    reviewerPlatformId: review.user?.profile_url || "",
    rating: Number(review.rating || 0),
    title: "Yelp review",
    reviewText: review.text || "",
    reviewedAt: review.time_created || "",
    url: review.url || ""
  }));
}

async function fetchGoogleReviews(platform, token, providerConfig, payload) {
  const listingId = platform.businessListingId || platform.business_listing_id || "";
  const accountId = payload.accountId || providerConfig.accountId || parseGoogleId(listingId, "accounts");
  const locationId = payload.locationId || providerConfig.locationId || parseGoogleId(listingId, "locations");
  if (!accountId || !locationId) return [];
  const url = `https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/reviews`;
  const response = await fetchJson(url, { headers: { authorization: `Bearer ${token}` } });
  return (response.reviews || []).map((review) => ({
    platformReviewId: review.reviewId || review.name || "",
    reviewerName: review.reviewer?.displayName || "Google reviewer",
    reviewerAvatar: review.reviewer?.profilePhotoUrl || "",
    reviewerPlatformId: review.reviewer?.name || "",
    rating: googleRating(review.starRating),
    title: "Google review",
    reviewText: review.comment || "",
    reviewedAt: review.createTime || review.updateTime || "",
    url: review.name || "",
    replyText: review.reviewReply?.comment || ""
  }));
}

async function fetchInstagramSignals(platform, token, providerConfig, payload) {
  const igAccountId = payload.instagramAccountId || providerConfig.instagramAccountId || platform.businessListingId || platform.business_listing_id || "";
  if (!igAccountId) return [];
  const version = providerConfig.graphVersion || payload.graphVersion || process.env.META_GRAPH_VERSION || "v20.0";
  const fields = "id,caption,permalink,timestamp,comments.limit(50){id,text,timestamp,username}";
  const response = await fetchJson(`https://graph.facebook.com/${version}/${encodeURIComponent(igAccountId)}/media?fields=${encodeURIComponent(fields)}&limit=25&access_token=${encodeURIComponent(token)}`);
  const comments = [];
  for (const media of response.data || []) {
    for (const comment of media.comments?.data || []) {
      comments.push({
        platformReviewId: comment.id,
        reviewerName: comment.username || "Instagram user",
        reviewerPlatformId: comment.username || "",
        rating: inferRating(comment.text || ""),
        title: "Instagram comment",
        reviewText: comment.text || "",
        reviewedAt: comment.timestamp || media.timestamp || "",
        url: media.permalink || "",
        metadata: { mediaId: media.id, caption: media.caption || "" }
      });
    }
  }
  return comments;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error?.message || body.description || body.message || `Provider request failed with ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function upsertExternalReview(platform, review, access) {
  const platformReviewId = String(review.platformReviewId || makeId("external"));
  const existing = db.prepare(
    `SELECT id FROM reviews_v2
     WHERE tenant_id = ? AND platform_id = ? AND platform_review_id = ?
     LIMIT 1`
  ).get(access.tenantId, platform.id, platformReviewId);
  const rating = Math.max(1, Math.min(5, Number(review.rating || 3)));
  const row = {
    id: existing?.id || makeId("review"),
    tenant_id: access.tenantId,
    branch_id: platform.branchId || platform.branch_id || access.branchId || "",
    platform_id: platform.id,
    platform_review_id: platformReviewId,
    reviewer_name: review.reviewerName || "Reviewer",
    reviewer_avatar: review.reviewerAvatar || "",
    reviewer_platform_id: review.reviewerPlatformId || "",
    rating,
    rating_max: 5,
    title: review.title || "Imported review",
    review_text: review.reviewText || "",
    review_language: review.language || "",
    sentiment: sentimentFromRating(rating),
    sentiment_score: sentimentScoreFromRating(rating),
    topics_json: toJson([]),
    aspects_json: toJson({ providerUrl: review.url || "", metadata: review.metadata || {} }),
    status: rating <= 3 ? "new" : "resolved",
    priority: rating <= 2 ? "high" : "normal",
    resolution_required: rating <= 3 ? 1 : 0,
    has_reply: review.replyText ? 1 : 0,
    reply_text: review.replyText || "",
    reviewed_at: review.reviewedAt || now(),
    imported_at: now(),
    updated_at: now()
  };
  if (existing) {
    db.prepare(
      `UPDATE reviews_v2 SET
        reviewer_name = @reviewer_name,
        reviewer_avatar = @reviewer_avatar,
        reviewer_platform_id = @reviewer_platform_id,
        rating = @rating,
        title = @title,
        review_text = @review_text,
        sentiment = @sentiment,
        sentiment_score = @sentiment_score,
        aspects_json = @aspects_json,
        status = @status,
        priority = @priority,
        resolution_required = @resolution_required,
        has_reply = @has_reply,
        reply_text = @reply_text,
        reviewed_at = @reviewed_at,
        updated_at = @updated_at
       WHERE id = @id AND tenant_id = @tenant_id`
    ).run(row);
    return existing.id;
  }
  db.prepare(
    `INSERT INTO reviews_v2
     (id, tenant_id, branch_id, platform_id, platform_review_id, reviewer_name, reviewer_avatar, reviewer_platform_id,
      rating, rating_max, title, review_text, review_language, sentiment, sentiment_score, topics_json, aspects_json,
      status, priority, resolution_required, has_reply, reply_text, reviewed_at, imported_at, updated_at)
     VALUES
     (@id, @tenant_id, @branch_id, @platform_id, @platform_review_id, @reviewer_name, @reviewer_avatar, @reviewer_platform_id,
      @rating, @rating_max, @title, @review_text, @review_language, @sentiment, @sentiment_score, @topics_json, @aspects_json,
      @status, @priority, @resolution_required, @has_reply, @reply_text, @reviewed_at, @imported_at, @updated_at)`
  ).run(row);
  return row.id;
}

function parseGoogleId(value = "", part) {
  const match = String(value || "").match(new RegExp(`${part}/([^/]+)`));
  return match?.[1] || "";
}

function googleRating(value) {
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[String(value || "").toUpperCase()] || Number(value || 0) || 0;
}

function inferRating(text = "") {
  const value = String(text || "").toLowerCase();
  if (/(bad|worst|poor|angry|refund|hate|terrible|awful)/.test(value)) return 2;
  if (/(ok|okay|fine|average|late|wait)/.test(value)) return 3;
  if (/(love|great|excellent|best|amazing|beautiful|perfect|thanks|thank you)/.test(value)) return 5;
  return 4;
}

function sentimentFromRating(rating) {
  if (rating <= 1.5) return "very_negative";
  if (rating <= 3) return "negative";
  if (rating < 4) return "neutral";
  if (rating < 4.8) return "positive";
  return "very_positive";
}

function sentimentScoreFromRating(rating) {
  return Math.round(((Number(rating || 0) - 3) / 2) * 100) / 100;
}
