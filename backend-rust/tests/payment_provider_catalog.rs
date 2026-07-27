use std::{fs, path::Path};

fn provider_block<'a>(source: &'a str, provider: &str) -> &'a str {
    let marker = format!("provider: \"{provider}\"");
    let start = source.find(&marker).expect("provider missing from catalog");
    let tail = &source[start..];
    let end = tail
        .find("},")
        .expect("provider catalog entry is incomplete");
    &tail[..end]
}

#[test]
fn global_catalog_preserves_real_provider_boundary() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let config =
        fs::read_to_string(root.join("src/config.rs")).expect("config.rs must be readable");
    let route = fs::read_to_string(root.join("src/routes/pos_enterprise.rs"))
        .expect("pos_enterprise.rs must be readable");

    for provider in ["razorpay", "cashfree", "phonepe"] {
        assert!(provider_block(&config, provider).contains("implemented: true"));
        assert!(provider_block(&config, provider).contains("recommended: false"));
    }
    for provider in [
        "stripe",
        "paypal",
        "adyen",
        "square",
        "mollie",
        "mercadopago",
        "paystack",
        "flutterwave",
        "tap",
    ] {
        assert!(provider_block(&config, provider).contains("implemented: false"));
    }

    let aurashine = provider_block(&config, "aurashine_payments");
    assert!(aurashine.contains("countries: &[\"*\"]"));
    assert!(aurashine.contains("implemented: false"));
    assert!(aurashine.contains("recommended: true"));

    assert!(route.contains("PAYMENT_PROVIDER_CATALOG"));
    assert!(route.contains("\"countries\": entry.countries"));
    assert!(route.contains("\"recommended\": entry.recommended"));
    assert!(route.contains("entry.implemented && state.settings.payment_provider_enabled"));
    assert!(route.contains("if entry.implemented { \"available\" } else { \"planned\" }"));
}
