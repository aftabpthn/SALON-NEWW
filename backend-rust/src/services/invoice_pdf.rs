use qrcodegen::{QrCode, QrCodeEcc};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::models::common::AppError;

#[derive(Clone, Copy)]
pub enum InvoicePdfLayout {
    A4,
    Thermal,
}

impl InvoicePdfLayout {
    pub fn parse(value: Option<&str>) -> Result<Self, AppError> {
        match value.unwrap_or("a4").trim().to_ascii_lowercase().as_str() {
            "" | "a4" => Ok(Self::A4),
            "thermal" => Ok(Self::Thermal),
            _ => Err(AppError::validation("layout must be a4 or thermal")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::A4 => "a4",
            Self::Thermal => "thermal",
        }
    }

    fn page_width(self) -> i32 {
        match self {
            Self::A4 => 595,
            Self::Thermal => 226,
        }
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn render(
    document: &Value,
    layout: InvoicePdfLayout,
    upi_uri: &str,
) -> Result<Vec<u8>, AppError> {
    let sale = document.get("sale").unwrap_or(document);
    let invoice_number = text(sale, "invoiceNumber");
    let status = text(sale, "status");
    let total = paise(sale, "totalPaise");
    let paid = paise(sale, "paidPaise");
    let page_width = layout.page_width();
    let appearance = document.get("appearance");
    let heading = setting_text(appearance, "heading", "INVOICE");
    let heading = append_secondary_label(appearance, "taxInvoiceText", &heading);
    let branded_heading = if setting_bool(appearance, "headerIncludingLogo", true) {
        format!("AuraShine {heading}")
    } else {
        heading
    };
    let mut lines = vec![branded_heading];
    if let Some(seller) = document
        .get("seller")
        .filter(|_| setting_bool(appearance, "showBusinessName", true))
    {
        let legal_name = text(seller, "legalName");
        if legal_name != "-" {
            lines.push(format!(
                "{}: {}",
                invoice_label(appearance, "salonName", "Seller"),
                legal_name
            ));
            lines.push(format!(
                "{}: {}, {}, {} {}",
                invoice_label(appearance, "address", "Address"),
                text(seller, "addressLine1"),
                text(seller, "city"),
                text(seller, "state"),
                text(seller, "pincode")
            ));
            if seller
                .get("isGstRegistered")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                lines.push(format!(
                    "{}: {}",
                    invoice_label(appearance, "gstin", "GSTIN"),
                    text(seller, "gstin")
                ));
            }
            for (key, field, fallback) in
                [("contact", "phone", "Contact"), ("email", "email", "Email")]
            {
                let value = text(seller, field);
                if value != "-" && !value.is_empty() {
                    lines.push(format!(
                        "{}: {value}",
                        invoice_label(appearance, key, fallback)
                    ));
                }
            }
        }
    }
    if setting_bool(appearance, "showInvoiceId", true) {
        let prefix = setting_text(appearance, "invoiceNumberPrefix", "");
        lines.push(format!(
            "{}: {prefix}{invoice_number}",
            invoice_label(appearance, "invoiceId", "Invoice")
        ));
    }
    let created_at = text(sale, "createdAt");
    if setting_bool(appearance, "showDateTime", true) {
        lines.push(format!(
            "{}: {}",
            invoice_label(appearance, "date", "Date"),
            iso_date(&created_at)
        ));
    }
    if setting_bool(appearance, "showTime", true) {
        lines.push(format!(
            "{}: {}",
            invoice_label(appearance, "time", "Time"),
            iso_time(&created_at)
        ));
    }
    lines.push(format!(
        "{}: {status}",
        invoice_label(appearance, "status", "Status")
    ));
    if let Some(client) = document.get("clientKpi") {
        if setting_bool(appearance, "showClientName", true) {
            lines.push(format!(
                "{}: {}",
                invoice_label(appearance, "customerName", "Client"),
                text(client, "clientName")
            ));
        }
        if setting_bool(appearance, "showClientContact", true) {
            lines.push(format!(
                "{}: {}",
                invoice_label(appearance, "customerContact", "Phone"),
                text(client, "phone")
            ));
        }
        if setting_bool(appearance, "showWalletBalance", true) {
            lines.push(format!(
                "{}: {}",
                invoice_label(appearance, "walletBalance", "Wallet"),
                money(paise(client, "walletPaise"))
            ));
        }
        let membership = text(client, "membershipName");
        if membership != "-" && !membership.is_empty() {
            lines.push(format!(
                "{}: {membership}",
                invoice_label(appearance, "membership", "Membership")
            ));
            let valid = text(client, "membershipExpiresAt");
            if valid != "-" && !valid.is_empty() {
                lines.push(format!(
                    "{}: {valid}",
                    invoice_label(appearance, "valid", "Valid")
                ));
            }
        }
        if setting_bool(appearance, "showPendingServices", true) {
            let pending = pending_service_lines(client);
            if !pending.is_empty() {
                lines.push(format!(
                    "{}:",
                    invoice_label(appearance, "pendingServices", "Pending services")
                ));
                lines.extend(pending);
            }
        }
    }
    if setting_bool(appearance, "showAppointmentTime", true) {
        let reference = text(sale, "referenceId");
        if reference != "-" && !reference.is_empty() {
            lines.push(format!(
                "{}: {reference}",
                invoice_label(appearance, "appointmentTime", "Appointment")
            ));
        }
    }
    if setting_bool(appearance, "showBill", true) {
        lines.push(format!(
            "{}: {}",
            invoice_label(appearance, "subtotal", "Subtotal"),
            money(paise(sale, "subtotalPaise"))
        ));
        if setting_bool(appearance, "showDiscount", true) {
            lines.push(format!(
                "{}: {}",
                invoice_label(appearance, "discount", "Discount"),
                money(paise(sale, "discountPaise"))
            ));
        }
        lines.push(format!(
            "{}: {}",
            invoice_label(appearance, "gst", "GST"),
            money(paise(sale, "taxPaise"))
        ));
        lines.push(format!(
            "{}: {}",
            invoice_label(appearance, "total", "Total"),
            money(total)
        ));
        lines.push(format!(
            "{}: {}",
            invoice_label(appearance, "paid", "Paid"),
            money(paid)
        ));
        lines.push(format!(
            "{}: {}",
            invoice_label(appearance, "due", "Balance"),
            money(total.saturating_sub(paid))
        ));
        lines.push(format!("{}:", invoice_label(appearance, "items", "Items")));
    }
    if let Some(gst) = document.get("gst") {
        let place_of_supply = text(gst, "placeOfSupplyStateCode");
        if place_of_supply != "-" {
            lines.push(format!(
                "{}: {}",
                invoice_label(appearance, "placeOfSupply", "Place of supply"),
                place_of_supply
            ));
        }
        let buyer_gstin = text(gst, "buyerGstin");
        if buyer_gstin != "-" {
            lines.push(format!(
                "{}: {}",
                invoice_label(appearance, "buyerGstin", "Buyer GSTIN"),
                buyer_gstin
            ));
        }
    }
    let mut cgst_paise = 0i64;
    let mut sgst_paise = 0i64;
    let mut igst_paise = 0i64;
    let mut reverse_charge = false;
    for item in document
        .get("lines")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        cgst_paise += paise(item, "cgstPaise");
        sgst_paise += paise(item, "sgstPaise");
        igst_paise += paise(item, "igstPaise");
        reverse_charge |= item
            .get("reverseCharge")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let tax_code = text(item, "hsnSacCode");
        let tax_code = (tax_code != "-")
            .then(|| format!(" [{}]", tax_code))
            .unwrap_or_default();
        if setting_bool(appearance, "showBill", true) {
            let line_type = text(item, "lineType");
            let item_label = invoice_label(
                appearance,
                match line_type.as_str() {
                    "product" => "product",
                    "package" => "package",
                    "membership" => "membership",
                    _ => "services",
                },
                match line_type.as_str() {
                    "product" => "Product",
                    "package" => "Package",
                    "membership" => "Membership",
                    _ => "Service",
                },
            );
            let staff = if setting_bool(appearance, "showStaff", true) {
                let value = text(item, "staffId");
                (value != "-" && !value.is_empty())
                    .then(|| format!(" / {} {value}", invoice_label(appearance, "staff", "Staff")))
                    .unwrap_or_default()
            } else {
                String::new()
            };
            lines.push(format!(
                "{item_label}: {}{} | {} {} | {} {} | {} {} | {} {}{}",
                text(item, "itemName"),
                tax_code,
                invoice_label(appearance, "quantity", "Qty"),
                item.get("quantity").and_then(Value::as_i64).unwrap_or(0),
                invoice_label(appearance, "price", "Price"),
                money(paise(item, "unitPricePaise")),
                invoice_label(appearance, "taxableAmount", "Taxable amount"),
                money(paise(item, "taxablePaise")),
                invoice_label(appearance, "total", "Total"),
                money(paise(item, "lineTotalPaise")),
                staff,
            ));
            if line_type == "package" && setting_bool(appearance, "showPackageOfferPrice", true) {
                lines.push(format!(
                    "{}: {}",
                    invoice_label(appearance, "actualPrice", "Package offer price"),
                    money(paise(item, "unitPricePaise"))
                ));
            }
        }
    }
    if cgst_paise > 0 {
        lines.push(format!(
            "{}: {}",
            invoice_label(appearance, "cgst", "CGST"),
            money(cgst_paise)
        ));
    }
    if sgst_paise > 0 {
        lines.push(format!(
            "{}: {}",
            invoice_label(appearance, "sgst", "SGST"),
            money(sgst_paise)
        ));
    }
    if igst_paise > 0 {
        lines.push(format!(
            "{}: {}",
            invoice_label(appearance, "igst", "IGST"),
            money(igst_paise)
        ));
    }
    if reverse_charge {
        lines.push(format!(
            "{}: recipient liable for GST",
            invoice_label(appearance, "reverseCharge", "Reverse charge")
        ));
    }
    if !upi_uri.is_empty() {
        lines.push(format!(
            "{}: Scan QR to pay",
            invoice_label(appearance, "upiPayment", "UPI payment")
        ));
    }
    if setting_bool(appearance, "showPaymentMethod", true) {
        let methods = document
            .get("payments")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|payment| text(payment, "method"))
            .filter(|method| method != "-")
            .collect::<Vec<_>>();
        if !methods.is_empty() {
            lines.push(format!(
                "{}: {}",
                invoice_label(appearance, "paymentMethod", "Payment"),
                methods.join(", ")
            ));
        }
    }
    if setting_bool(appearance, "showBillNotes", true) {
        let notes = document
            .get("payments")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|payment| text(payment, "notes"))
            .filter(|note| note != "-" && !note.is_empty())
            .collect::<Vec<_>>();
        if !notes.is_empty() {
            lines.push(format!(
                "{}: {}",
                invoice_label(appearance, "billNotes", "Bill notes"),
                notes.join(" | ")
            ));
        }
    }
    if let Some(links) = document.get("links") {
        for (enabled_key, value_key, label_key, fallback) in [
            (
                "showFeedbackLink",
                "feedbackUrl",
                "feedbackLink",
                "Feedback link",
            ),
            (
                "showInvoiceLink",
                "invoiceUrl",
                "invoiceLink",
                "Invoice link",
            ),
        ] {
            let value = text(links, value_key);
            if setting_bool(appearance, enabled_key, true) && value != "-" && !value.is_empty() {
                lines.push(format!(
                    "{}: {value}",
                    invoice_label(appearance, label_key, fallback)
                ));
            }
        }
    }
    for (key, label) in [
        (
            "termsAndConditions",
            invoice_label(appearance, "terms", "Terms"),
        ),
        ("thanksMessage", String::new()),
        (
            "poweredBy",
            invoice_label(appearance, "poweredBy", "Powered by"),
        ),
    ] {
        let value = setting_text(appearance, key, "");
        if !value.is_empty() {
            lines.push(if label.is_empty() {
                value
            } else {
                format!("{label}: {value}")
            });
        }
    }
    for (key, fallback) in [
        ("extraText1", "Extra text 1"),
        ("extraText2", "Extra text 2"),
    ] {
        if let Some(value) = optional_bilingual_text(appearance, key, fallback) {
            lines.push(value);
        }
    }
    if let Some(secondary_thanks) = secondary_label(appearance, "thanksMessage") {
        if secondary_thanks != setting_text(appearance, "thanksMessage", "") {
            lines.push(secondary_thanks);
        }
    }
    if setting_bool(appearance, "showSignature", true) {
        lines.push(format!(
            "{}: __________________",
            invoice_label(appearance, "signature", "Signature")
        ));
    }

    let mut content = String::from("BT /F1 11 Tf 28 812 Td 14 TL ");
    for line in &lines {
        content.push_str(&format!("({}) Tj T* ", escape(line)));
    }
    content.push_str("ET\n");

    let qr = if upi_uri.is_empty() {
        None
    } else {
        Some(
            QrCode::encode_text(upi_uri, QrCodeEcc::Medium)
                .map_err(|_| AppError::validation("upiUri is too large for QR"))?,
        )
    };
    let qr_bytes = qr.as_ref().map(qr_image);
    if let Some(bytes) = &qr_bytes {
        let size = qr.as_ref().map(|code| code.size()).unwrap_or_default();
        let draw_size = if matches!(layout, InvoicePdfLayout::Thermal) {
            96
        } else {
            132
        };
        let x = page_width - draw_size - 28;
        content.push_str(&format!(
            "q {draw_size} 0 0 {draw_size} {x} 650 cm /Im1 Do Q\n"
        ));
        return Ok(build_pdf(page_width, &content, Some((size, bytes))));
    }
    Ok(build_pdf(page_width, &content, None))
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("-")
        .to_string()
}

fn paise(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn setting_bool(appearance: Option<&Value>, key: &str, fallback: bool) -> bool {
    appearance
        .and_then(|settings| settings.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}

fn setting_text(appearance: Option<&Value>, key: &str, fallback: &str) -> String {
    appearance
        .and_then(|settings| settings.get(key))
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .trim()
        .to_string()
}

fn invoice_label(appearance: Option<&Value>, key: &str, fallback: &str) -> String {
    let english = appearance
        .and_then(|settings| settings.get("englishLabels"))
        .and_then(|labels| labels.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback);
    let secondary = appearance
        .filter(|settings| setting_bool(Some(settings), "dualLanguageEnabled", false))
        .and_then(|settings| settings.get("secondaryLabels"))
        .and_then(|labels| labels.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    secondary
        .map(|value| format!("{english} / {value}"))
        .unwrap_or_else(|| english.to_string())
}

fn secondary_label(appearance: Option<&Value>, key: &str) -> Option<String> {
    appearance
        .filter(|settings| setting_bool(Some(settings), "dualLanguageEnabled", false))
        .and_then(|settings| settings.get("secondaryLabels"))
        .and_then(|labels| labels.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn append_secondary_label(appearance: Option<&Value>, key: &str, primary: &str) -> String {
    secondary_label(appearance, key)
        .filter(|secondary| secondary != primary)
        .map(|secondary| format!("{primary} / {secondary}"))
        .unwrap_or_else(|| primary.to_string())
}

fn optional_bilingual_text(
    appearance: Option<&Value>,
    key: &str,
    default_english: &str,
) -> Option<String> {
    let english = appearance
        .and_then(|settings| settings.get("englishLabels"))
        .and_then(|labels| labels.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != default_english);
    let secondary = secondary_label(appearance, key);
    match (english, secondary) {
        (Some(english), Some(secondary)) => Some(format!("{english} / {secondary}")),
        (Some(english), None) => Some(english.to_string()),
        (None, Some(secondary)) => Some(format!("{default_english} / {secondary}")),
        (None, None) => None,
    }
}

fn iso_date(value: &str) -> String {
    value.split('T').next().unwrap_or(value).to_string()
}

fn iso_time(value: &str) -> String {
    value
        .split_once('T')
        .map(|(_, time)| time.trim_end_matches('Z').to_string())
        .unwrap_or_else(|| value.to_string())
}

fn pending_service_lines(client: &Value) -> Vec<String> {
    ["membershipCredits", "packageCredits"]
        .into_iter()
        .flat_map(|key| {
            client
                .get(key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|credit| {
            let quantity = credit
                .get("pendingQty")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let service = text(credit, "serviceName");
            (quantity > 0 && service != "-").then(|| format!("- {service} x{quantity}"))
        })
        .collect()
}

fn money(value: i64) -> String {
    format!("INR {}.{:02}", value / 100, value.unsigned_abs() % 100)
}

fn escape(value: &str) -> String {
    value
        .chars()
        .filter_map(|ch| match ch {
            '(' => Some("\\(".to_string()),
            ')' => Some("\\)".to_string()),
            '\\' => Some("\\\\".to_string()),
            c if c.is_ascii() && !c.is_control() => Some(c.to_string()),
            _ => Some("?".to_string()),
        })
        .collect()
}

fn qr_image(code: &QrCode) -> Vec<u8> {
    let size = code.size() as usize;
    let quiet = 4usize;
    let width = size + quiet * 2;
    let mut bytes = Vec::with_capacity(width * width);
    for y in 0..width {
        for x in 0..width {
            let dark = x >= quiet
                && y >= quiet
                && x < width - quiet
                && y < width - quiet
                && code.get_module((x - quiet) as i32, (y - quiet) as i32);
            bytes.push(if dark { 0 } else { 255 });
        }
    }
    bytes
}

fn build_pdf(page_width: i32, content: &str, qr: Option<(i32, &Vec<u8>)>) -> Vec<u8> {
    let mut pdf = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = vec![0usize];
    object(
        &mut pdf,
        &mut offsets,
        1,
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
    );
    object(
        &mut pdf,
        &mut offsets,
        2,
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
    );
    let resources = if qr.is_some() {
        "/Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >>"
    } else {
        "/Resources << /Font << /F1 5 0 R >> >>"
    };
    object(&mut pdf, &mut offsets, 3, format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width} 842] {resources} /Contents 4 0 R >>").into_bytes());
    stream_object(&mut pdf, &mut offsets, 4, content.as_bytes());
    object(
        &mut pdf,
        &mut offsets,
        5,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_vec(),
    );
    if let Some((size, bytes)) = qr {
        let mut image = format!("<< /Type /XObject /Subtype /Image /Width {size} /Height {size} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length {} >>\nstream\n", bytes.len()).into_bytes();
        image.extend_from_slice(bytes);
        image.extend_from_slice(b"\nendstream");
        object(&mut pdf, &mut offsets, 6, image);
    }
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len()).as_bytes());
    for offset in offsets.iter().skip(1) {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer << /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            offsets.len()
        )
        .as_bytes(),
    );
    pdf
}

pub fn render_text_report(title: &str, lines: &[String]) -> Vec<u8> {
    let pages = if lines.is_empty() {
        vec![Vec::new()]
    } else {
        lines
            .chunks(46)
            .map(|chunk| chunk.to_vec())
            .collect::<Vec<_>>()
    };
    let font_id = 3 + pages.len() * 2;
    let kids = (0..pages.len())
        .map(|index| format!("{} 0 R", 3 + index * 2))
        .collect::<Vec<_>>()
        .join(" ");
    let mut pdf = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = vec![0usize];
    object(
        &mut pdf,
        &mut offsets,
        1,
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
    );
    object(
        &mut pdf,
        &mut offsets,
        2,
        format!("<< /Type /Pages /Kids [{kids}] /Count {} >>", pages.len()).into_bytes(),
    );
    for (index, page_lines) in pages.iter().enumerate() {
        let page_id = 3 + index * 2;
        let content_id = page_id + 1;
        object(&mut pdf, &mut offsets, page_id, format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>").into_bytes());
        let mut content = format!(
            "BT /F1 10 Tf 36 806 Td 15 TL ({}) Tj T* (Page {} of {}) Tj T* ",
            escape(title),
            index + 1,
            pages.len()
        );
        for line in page_lines {
            content.push_str(&format!("({}) Tj T* ", escape(line)));
        }
        content.push_str("ET\n");
        stream_object(&mut pdf, &mut offsets, content_id, content.as_bytes());
    }
    object(
        &mut pdf,
        &mut offsets,
        font_id,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_vec(),
    );
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len()).as_bytes());
    for offset in offsets.iter().skip(1) {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer << /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            offsets.len()
        )
        .as_bytes(),
    );
    pdf
}

fn object(pdf: &mut Vec<u8>, offsets: &mut Vec<usize>, id: usize, body: Vec<u8>) {
    offsets.push(pdf.len());
    pdf.extend_from_slice(format!("{id} 0 obj\n").as_bytes());
    pdf.extend_from_slice(&body);
    pdf.extend_from_slice(b"\nendobj\n");
}

fn stream_object(pdf: &mut Vec<u8>, offsets: &mut Vec<usize>, id: usize, bytes: &[u8]) {
    object(
        pdf,
        offsets,
        id,
        [
            format!("<< /Length {} >>\nstream\n", bytes.len()).as_bytes(),
            bytes,
            b"\nendstream",
        ]
        .concat(),
    );
}

#[cfg(test)]
mod tests {
    use super::{render, render_text_report, InvoicePdfLayout};
    use serde_json::json;

    #[test]
    fn appearance_settings_control_invoice_content() {
        let document = json!({
            "sale": {
                "invoiceNumber": "0001",
                "status": "finalized",
                "totalPaise": 10000,
                "subtotalPaise": 9000,
                "paidPaise": 10000,
                "discountPaise": 0,
                "taxPaise": 1000,
                "createdAt": "2026-07-13T10:00:00Z"
            },
            "lines": [{
                "lineType": "service", "itemName": "Service", "quantity": 1,
                "unitPricePaise": 9000, "taxablePaise": 9000, "lineTotalPaise": 10000
            }],
            "payments": [],
            "appearance": {
                "heading": "RECEIPT",
                "headerIncludingLogo": false,
                "showInvoiceId": false,
                "showDateTime": false,
                "showBill": true,
                "showSignature": false,
                "dualLanguageEnabled": true,
                "englishLabels": { "total": "Total" },
                "secondaryLabels": { "total": "Total ES" }
            }
        });
        let pdf = String::from_utf8_lossy(&render(&document, InvoicePdfLayout::A4, "").unwrap())
            .to_string();
        assert!(pdf.contains("RECEIPT"));
        assert!(pdf.contains("Service"));
        assert!(pdf.contains("Subtotal"));
        assert!(pdf.contains("Taxable amount"));
        assert!(pdf.contains("Total / Total ES"));
        assert!(!pdf.contains("Invoice: 0001"));
        assert!(!pdf.contains("Signature:"));
    }

    #[test]
    fn text_reports_paginate_without_dropping_rows() {
        let lines = (0..100)
            .map(|index| format!("Row {index}"))
            .collect::<Vec<_>>();
        let pdf = String::from_utf8_lossy(&render_text_report("Report", &lines)).to_string();
        assert!(pdf.contains("/Count 3"));
        assert!(pdf.contains("Row 99"));
    }
}
