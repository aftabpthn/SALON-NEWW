use std::cmp::Ordering;

use chrono::Utc;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::models::common::AppError;

pub fn create(payload: &Value) -> Result<Value, AppError> {
    validate_payload(payload)?;
    let message = clean_text(payload.get("message"), 1_600);
    let goals = text_array(payload.get("goals"), 8, 80);
    let photos = payload
        .get("photos")
        .and_then(Value::as_array)
        .map(|items| items.len().min(5))
        .unwrap_or_default();
    if message.is_empty() && goals.is_empty() && photos == 0 {
        return Err(AppError::validation(
            "message, goal or photo is required for consultation",
        ));
    }
    let profile = payload
        .get("problemProfile")
        .or_else(|| payload.get("problem_profile"))
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let concern = clean_text(profile.get("concern"), 260);
    let summary = if !concern.is_empty() {
        concern
    } else if !message.is_empty() {
        message.clone()
    } else {
        goals.join(", ")
    };
    let context = format!(
        "{} {} {} {} {}",
        summary,
        goals.join(" "),
        clean_text(profile.get("history"), 220),
        clean_text(profile.get("sensitivities"), 220),
        clean_text(profile.get("desiredOutcome"), 220)
    )
    .to_ascii_lowercase();
    let risky = [
        "allergy",
        "infection",
        "wound",
        "burn",
        "pregnan",
        "severe",
        "medication",
        "active acne",
    ]
    .iter()
    .any(|term| context.contains(term));
    let missing_info = missing_information(&profile, &context);
    let salons = salon_recommendations(payload.get("businesses"));
    let services = service_recommendations(payload.get("businesses"));
    let language_code = clean_text(payload.get("languageCode"), 16)
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect::<String>();
    let language_code = if language_code.is_empty() {
        "en-IN".to_string()
    } else {
        language_code
    };
    let primary_advice = primary_advice(&context);
    let risk_advice = if risky {
        "A qualified professional should review the risk flag before any chemical or intensive service."
    } else {
        "Tell the professional about any allergy, sensitivity, medication or recent treatment before the service."
    };
    let market_advice = if salons.is_empty() {
        "No matching live marketplace business was supplied, so choose a salon only after refreshing the real nearby results."
    } else {
        "The shortlist below uses only the live marketplace businesses supplied with this request."
    };

    Ok(json!({
        "consultationId":format!("consult_{}",Uuid::new_v4()),
        "createdAt":Utc::now(),
        "mode":"local",
        "provider":"local_rules",
        "languageCode":language_code,
        "supportedLanguages":["en-IN","hi-IN"],
        "answer":format!("I understand your concern as {}. {} {} {}",sentence(&summary),primary_advice,risk_advice,market_advice),
        "concernSummary":sentence(&summary),
        "consultationStage":if missing_info.is_empty() {"plan_ready"} else {"clarification"},
        "confidence":if missing_info.len() <= 1 {"high"} else {"medium"},
        "missingInfo":missing_info,
        "suggestedReplies":[
            "My budget and deadline are...",
            "My previous treatment or colour history is...",
            "My allergy or sensitivity details are..."
        ],
        "visualAssessment":if photos>0 {
            json!(["Photos were received for the professional handoff; the local rules engine does not claim visual diagnosis.","Use clear natural-light front, side and close-up photos."])
        } else {
            json!(["No photo was attached, so this guidance uses the written concern only.","Add natural-light photos if visual condition affects service choice."])
        },
        "hairPlan":hair_plan(&context),
        "actionPlan":[
            "Confirm the concern, current condition, deadline and budget.",
            "Choose one real nearby business and one backup option.",
            "Confirm service duration, price, patch-test needs and staff availability.",
            "Book only after the backend returns a real available slot."
        ],
        "recommendedSalons":salons,
        "recommendedServices":services,
        "locationInsights":location_insights(payload.get("location"),payload.get("businesses")),
        "preparationChecklist":[
            "Share previous colour, chemical, facial or treatment history.",
            "Share allergies, sensitivities, medication and active skin or scalp concerns.",
            "Carry target references and current-condition photos.",
            "Request a patch or strand test when the service needs it."
        ],
        "afterCare":[
            "Follow the service-specific professional after-care instructions.",
            "Avoid harsh products, heat or intensive actives during the advised recovery window.",
            "Contact the business promptly if irritation or an unexpected reaction occurs."
        ],
        "budgetInsights":budget_insights(&services),
        "followUpQuestions":missing_information(&profile,&context),
        "requiresExplicitBookingConfirmation":true,
        "bookingConfirmationPolicy":"AI can recommend categories and salons, but booking is created only after the customer explicitly confirms a real backend slot.",
        "runtimeSafetyProof":{"medicalDiagnosisAllowed":false,"guaranteedResultsAllowed":false,"usesOnlySuppliedMarketplaceBusinesses":true},
        "safetyNote":"This is beauty guidance, not medical diagnosis. Seek a qualified professional for irritation, wounds, infection, pregnancy concerns or active medical treatment."
    }))
}

fn validate_payload(payload: &Value) -> Result<(), AppError> {
    if !payload.is_object() {
        return Err(AppError::validation("consultation payload is invalid"));
    }
    if payload
        .get("businesses")
        .and_then(Value::as_array)
        .is_some_and(|items| items.len() > 20)
    {
        return Err(AppError::validation(
            "consultation can include at most 20 marketplace businesses",
        ));
    }
    if payload
        .get("conversation")
        .and_then(Value::as_array)
        .is_some_and(|items| items.len() > 10)
    {
        return Err(AppError::validation(
            "consultation conversation is too long",
        ));
    }
    let photos = payload
        .get("photos")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if photos.len() > 5 {
        return Err(AppError::validation(
            "consultation can include at most 5 photos",
        ));
    }
    let mut total_size = 0_u64;
    for photo in photos {
        let mime = clean_text(photo.get("mimeType").or_else(|| photo.get("type")), 80);
        let data_url = photo
            .get("dataUrl")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let size = photo
            .get("sizeBytes")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        if !mime.starts_with("image/")
            || !data_url.starts_with("data:image/")
            || size == 0
            || size > 5 * 1024 * 1024
        {
            return Err(AppError::validation("consultation photo is invalid"));
        }
        total_size = total_size.saturating_add(size);
    }
    if total_size > 5 * 1024 * 1024 {
        return Err(AppError::validation(
            "consultation photos must stay under 5 MB",
        ));
    }
    Ok(())
}

fn salon_recommendations(value: Option<&Value>) -> Vec<Value> {
    let mut businesses = value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| !clean_text(item.get("businessName"), 160).is_empty())
        .take(12)
        .collect::<Vec<_>>();
    businesses.sort_by(|left, right| {
        business_score(right)
            .partial_cmp(&business_score(left))
            .unwrap_or(Ordering::Equal)
    });
    businesses
        .into_iter()
        .take(4)
        .map(|business| {
            let location = [
                clean_text(business.get("area"), 100),
                clean_text(business.get("city"), 100),
                clean_text(business.get("state"), 100),
            ]
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
            json!({
                "businessName":clean_text(business.get("businessName"),160),
                "slug":clean_text(business.get("slug"),120),
                "reason":clean_text(business.get("popularService").or_else(||business.get("category")),180),
                "location":if location.is_empty() {clean_text(business.get("address"),220)} else {location},
                "distanceKm":business.get("distanceKm").and_then(Value::as_f64),
                "rating":business.get("ratingAverage").and_then(Value::as_f64),
                "openStatus":if business.get("isOpen").and_then(Value::as_bool).unwrap_or(false) {"Open now"} else {"Check hours"},
                "nextStep":business.get("nextAvailableSlot").and_then(Value::as_str).filter(|value|!value.is_empty()).map(|value|format!("Book {value}")).unwrap_or_else(||"View real services and slots".to_string())
            })
        })
        .collect()
}

fn service_recommendations(value: Option<&Value>) -> Vec<Value> {
    let mut recommendations = Vec::new();
    for business in value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(12)
    {
        let business_name = clean_text(business.get("businessName"), 160);
        let slug = clean_text(business.get("slug"), 120);
        for service in business
            .get("services")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .take(8)
        {
            let name = clean_text(service.get("name"), 140);
            if name.is_empty() {
                continue;
            }
            let price_paise = service
                .get("pricePaise")
                .and_then(Value::as_i64)
                .unwrap_or_default()
                .max(0);
            let duration = service
                .get("durationMinutes")
                .and_then(Value::as_i64)
                .unwrap_or_default()
                .max(0);
            recommendations.push(json!({
                "name":name,
                "businessName":business_name,
                "slug":slug,
                "priceLabel":if price_paise>0 {format!("INR {:.2}",price_paise as f64/100.0)} else {"Price on booking".to_string()},
                "durationLabel":if duration>0 {format!("{duration} min")} else {"Duration on booking".to_string()},
                "reason":clean_text(service.get("description").or_else(||service.get("category")),220)
            }));
            if recommendations.len() >= 6 {
                return recommendations;
            }
        }
    }
    recommendations
}

fn location_insights(location: Option<&Value>, businesses: Option<&Value>) -> Vec<String> {
    let label = clean_text(location.and_then(|value| value.get("label")), 120);
    let first = businesses
        .and_then(Value::as_array)
        .and_then(|items| items.first());
    let mut rows = Vec::new();
    if !label.is_empty() {
        rows.push(format!("Current area: {label}."));
    }
    if let Some(business) = first {
        let name = clean_text(business.get("businessName"), 160);
        let address = clean_text(business.get("address"), 220);
        if !name.is_empty() {
            rows.push(format!("First live option: {name}."));
        }
        if !address.is_empty() {
            rows.push(format!("Address: {address}."));
        }
    }
    rows.push(
        "Confirm map distance, open status and a real available slot before booking.".to_string(),
    );
    rows
}

fn missing_information(profile: &Value, context: &str) -> Vec<String> {
    let mut missing = Vec::new();
    if clean_text(profile.get("timeframe"), 120).is_empty() {
        missing.push("When do you need the result or appointment?".to_string());
    }
    if clean_text(profile.get("budget"), 120).is_empty() {
        missing.push("What budget range should be used?".to_string());
    }
    if clean_text(profile.get("history"), 220).is_empty() {
        missing.push(
            "What previous service, colour, chemical or treatment history applies?".to_string(),
        );
    }
    if clean_text(profile.get("sensitivities"), 220).is_empty()
        && !["allergy", "sensitive", "medication", "pregnan"]
            .iter()
            .any(|term| context.contains(term))
    {
        missing.push("Any allergy, sensitivity, medication or active treatment?".to_string());
    }
    missing.truncate(5);
    missing
}

fn primary_advice(context: &str) -> &'static str {
    if ["colour", "color", "bleach", "balayage", "toner"]
        .iter()
        .any(|term| context.contains(term))
    {
        "Start with colour history, porosity assessment and a patch or strand test before choosing the final colour service."
    } else if ["skin", "facial", "acne", "pigment"]
        .iter()
        .any(|term| context.contains(term))
    {
        "Start with a gentle skin consultation and avoid aggressive actives when irritation or active treatment is present."
    } else if ["damage", "dry", "frizz", "scalp", "hair fall"]
        .iter()
        .any(|term| context.contains(term))
    {
        "Start with condition and scalp assessment, then choose repair care before colour or texture work."
    } else {
        "Start with a consultation-first service path, then confirm price, duration, suitability and availability."
    }
}

fn hair_plan(context: &str) -> Vec<&'static str> {
    if ["hair", "colour", "color", "cut", "scalp", "frizz"]
        .iter()
        .any(|term| context.contains(term))
    {
        vec![
            "Confirm current length, texture, scalp condition and previous chemical history.",
            "Use a patch or strand test before bleach, colour, toner or texture services.",
            "Choose repair treatment first when breakage or scalp sensitivity is present.",
        ]
    } else {
        vec!["No hair-specific plan is required unless hair or scalp concerns are added."]
    }
}

fn budget_insights(services: &[Value]) -> Vec<String> {
    let mut rows = services
        .first()
        .and_then(|service| service.get("priceLabel"))
        .and_then(Value::as_str)
        .filter(|price| *price != "Price on booking")
        .map(|price| vec![format!("The first real service option starts at {price}.")])
        .unwrap_or_default();
    rows.push(
        "Confirm taxes, add-ons, long-hair charges and cancellation terms before payment."
            .to_string(),
    );
    rows
}

fn business_score(value: &Value) -> f64 {
    let rating = value
        .get("ratingAverage")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    let distance = value
        .get("distanceKm")
        .and_then(Value::as_f64)
        .unwrap_or(20.0);
    rating * 10.0 - distance
        + if value
            .get("isOpen")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            5.0
        } else {
            0.0
        }
}

fn sentence(value: &str) -> String {
    let value = value.trim().trim_end_matches(&['.', '!', '?'][..]);
    if value.is_empty() {
        "a beauty or wellness concern that needs clarification".to_string()
    } else {
        format!("{value}.")
    }
}

fn clean_text(value: Option<&Value>, maximum: usize) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .chars()
        .filter(|character| !character.is_control())
        .take(maximum)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn text_array(value: Option<&Value>, maximum_items: usize, maximum_length: usize) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|item| clean_text(Some(item), maximum_length))
        .filter(|item| !item.is_empty())
        .take(maximum_items)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consultation_never_invents_marketplace_rows() {
        let result = create(
            &json!({"message":"Need a safe hair colour","goals":[],"photos":[],"businesses":[]}),
        )
        .expect("consultation should be created");
        assert_eq!(result["recommendedSalons"], json!([]));
        assert_eq!(result["recommendedServices"], json!([]));
    }

    #[test]
    fn consultation_keeps_booking_confirmation_boundary() {
        let result = create(&json!({
            "message":"Book hair colour for pregnancy-safe service",
            "goals":["Hair"],
            "photos":[],
            "businesses":[{"businessName":"Live Salon","slug":"live-salon","isOpen":true,"services":[{"id":"svc","name":"Hair Colour","pricePaise":250000,"durationMinutes":90}]}]
        }))
        .expect("consultation should be created");

        assert_eq!(result["requiresExplicitBookingConfirmation"], json!(true));
        assert_eq!(
            result["runtimeSafetyProof"]["medicalDiagnosisAllowed"],
            json!(false)
        );
        assert!(result["bookingConfirmationPolicy"]
            .as_str()
            .unwrap_or_default()
            .contains("real backend slot"));
    }

    #[test]
    fn consultation_rejects_non_image_photo_payload() {
        let error = create(&json!({
            "message":"",
            "goals":[],
            "photos":[{"name":"x.txt","type":"text/plain","sizeBytes":12,"dataUrl":"data:text/plain;base64,WA=="}],
            "businesses":[]
        }))
        .expect_err("non image photo should be rejected");

        assert!(format!("{error:?}").contains("consultation photo is invalid"));
    }
}
