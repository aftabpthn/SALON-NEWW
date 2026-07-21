use std::collections::HashMap;

use chrono::{FixedOffset, Utc};
use serde_json::{json, Value};

use crate::repositories::booking_repository::{AppointmentReportRecord, StaffReportRecord};

#[derive(Debug, Clone)]
pub struct ReportOptions {
    pub from: String,
    pub to: String,
    pub report_type: String,
    pub status: String,
    pub mode: String,
    pub search: String,
    pub limit: usize,
    pub offset: usize,
}

struct DetailRow {
    value: Value,
    status_group: &'static str,
    price_paise: i64,
}

#[derive(Clone)]
struct StaffRow {
    staff_id: String,
    name: String,
    initials: String,
    staff_type: String,
    appointment_count: i64,
    appointment_price_paise: i64,
    completed: i64,
    cancelled: i64,
    not_came: i64,
}

pub fn detail_report(
    records: &[AppointmentReportRecord],
    branch_id: &str,
    options: &ReportOptions,
) -> Value {
    let report_type = normalized_filter(&options.report_type);
    let status = normalized_filter(&options.status);
    let mode = normalized_filter(&options.mode);
    let search = options.search.trim().to_ascii_lowercase();
    let mut filtered = Vec::new();
    for record in records {
        let status_group = status_group(&record.status);
        let mode_group = mode_group(&record.source, &record.source_channel);
        if report_type != "all" && report_type != status_group {
            continue;
        }
        if status != "all" && status != status_group {
            continue;
        }
        if mode != "all" && mode != mode_group {
            continue;
        }
        let haystack = format!(
            "{} {} {} {} {}",
            record.client_name,
            record.contact,
            record.service_names,
            record.staff_name,
            record.invoice_number
        )
        .to_ascii_lowercase();
        if !search.is_empty() && !haystack.contains(&search) {
            continue;
        }
        let local = record
            .start_at
            .with_timezone(&FixedOffset::east_opt(19_800).expect("valid IST offset"));
        filtered.push(DetailRow {
            value: json!({
                "id":record.id,
                "appointmentId":record.id,
                "mode":mode_label(mode_group),
                "modeGroup":mode_group,
                "clientId":record.client_id,
                "name":record.client_name,
                "contact":record.contact,
                "notes":record.notes,
                "serviceNames":record.service_names,
                "staffId":record.staff_id,
                "staffName":record.staff_name,
                "staffType":record.staff_type,
                "status":status_label(status_group),
                "statusGroup":status_group,
                "appointmentDate":local.format("%Y-%m-%d").to_string(),
                "appointmentTime":local.format("%H:%M").to_string(),
                "startAt":record.start_at,
                "price":rupees(record.price_paise),
                "invoiceNumber":record.invoice_number
            }),
            status_group,
            price_paise: record.price_paise,
        });
    }

    let total = filtered.len();
    let appointment_price_paise = filtered.iter().map(|row| row.price_paise).sum::<i64>();
    let count = |group: &str| {
        filtered
            .iter()
            .filter(|row| row.status_group == group)
            .count()
    };
    let page_rows = filtered
        .iter()
        .skip(options.offset)
        .take(options.limit)
        .map(|row| row.value.clone())
        .collect::<Vec<_>>();
    json!({
        "summary":{
            "total":total,
            "confirmed":count("confirmed"),
            "arrived":count("arrived"),
            "started":count("started"),
            "completed":count("completed"),
            "cancelled":count("cancelled"),
            "notCame":count("not_came"),
            "notConfirmed":count("not_confirmed"),
            "appointmentPrice":rupees(appointment_price_paise),
            "averagePrice":average_rupees(appointment_price_paise,total)
        },
        "rows":page_rows,
        "total":total,
        "limit":options.limit,
        "offset":options.offset,
        "filters":{"from":options.from,"to":options.to,"branchId":branch_id},
        "generatedAt":Utc::now()
    })
}

pub fn staff_report(
    records: &[AppointmentReportRecord],
    staff: &[StaffReportRecord],
    branch_id: &str,
    options: &ReportOptions,
) -> Value {
    let mut rows = staff
        .iter()
        .map(|person| {
            (
                person.id.clone(),
                StaffRow {
                    staff_id: person.id.clone(),
                    name: person.name.clone(),
                    initials: initials(&person.name),
                    staff_type: person.staff_type.clone(),
                    appointment_count: 0,
                    appointment_price_paise: 0,
                    completed: 0,
                    cancelled: 0,
                    not_came: 0,
                },
            )
        })
        .collect::<HashMap<_, _>>();
    for record in records {
        let key = if record.staff_id.trim().is_empty() {
            "unassigned"
        } else {
            record.staff_id.as_str()
        };
        let row = rows.entry(key.to_string()).or_insert_with(|| StaffRow {
            staff_id: key.to_string(),
            name: record.staff_name.clone(),
            initials: initials(&record.staff_name),
            staff_type: record.staff_type.clone(),
            appointment_count: 0,
            appointment_price_paise: 0,
            completed: 0,
            cancelled: 0,
            not_came: 0,
        });
        row.appointment_count += 1;
        row.appointment_price_paise += record.price_paise;
        match status_group(&record.status) {
            "completed" => row.completed += 1,
            "cancelled" => row.cancelled += 1,
            "not_came" => row.not_came += 1,
            _ => {}
        }
    }

    let search = options.search.trim().to_ascii_lowercase();
    let mut filtered = rows
        .into_values()
        .filter(|row| {
            search.is_empty()
                || format!("{} {}", row.name, row.staff_type)
                    .to_ascii_lowercase()
                    .contains(&search)
        })
        .collect::<Vec<_>>();
    filtered.sort_by(|left, right| {
        right
            .appointment_count
            .cmp(&left.appointment_count)
            .then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
    });
    let total = filtered.len();
    let total_appointments = filtered
        .iter()
        .map(|row| row.appointment_count)
        .sum::<i64>();
    let appointment_price_paise = filtered
        .iter()
        .map(|row| row.appointment_price_paise)
        .sum::<i64>();
    let active_staff = filtered
        .iter()
        .filter(|row| row.appointment_count > 0)
        .count();
    let page_rows = filtered
        .iter()
        .skip(options.offset)
        .take(options.limit)
        .map(|row| {
            json!({
                "staffId":row.staff_id,
                "name":row.name,
                "initials":row.initials,
                "type":row.staff_type,
                "appointmentCount":row.appointment_count,
                "appointmentPrice":rupees(row.appointment_price_paise),
                "completed":row.completed,
                "cancelled":row.cancelled,
                "notCame":row.not_came,
                "averagePrice":average_rupees(row.appointment_price_paise,row.appointment_count as usize)
            })
        })
        .collect::<Vec<_>>();
    json!({
        "summary":{
            "staffCount":total,
            "totalAppointments":total_appointments,
            "appointmentPrice":rupees(appointment_price_paise),
            "activeStaff":active_staff,
            "zeroAppointmentStaff":total-active_staff
        },
        "rows":page_rows,
        "total":total,
        "limit":options.limit,
        "offset":options.offset,
        "filters":{"from":options.from,"to":options.to,"branchId":branch_id},
        "generatedAt":Utc::now()
    })
}

fn normalized_filter(value: &str) -> String {
    let value = value.trim().to_ascii_lowercase().replace('-', "_");
    if value.is_empty() {
        "all".to_string()
    } else {
        value
    }
}

fn status_group(status: &str) -> &'static str {
    match status
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-")
        .replace(' ', "-")
        .as_str()
    {
        "confirmed" | "confirm" => "confirmed",
        "arrived" | "checked-in" | "check-in" => "arrived",
        "start" | "started" | "in-service" | "in-progress" => "started",
        "completed" | "complete" | "done" | "paid" | "billed" | "checkout" | "checked-out" => {
            "completed"
        }
        "cancelled" | "canceled" | "cancel" => "cancelled",
        "no-show" | "not-came" | "not-come" | "noshow" => "not_came",
        _ => "not_confirmed",
    }
}

fn status_label(group: &str) -> &'static str {
    match group {
        "confirmed" => "Confirmed",
        "arrived" => "Arrived",
        "started" => "Start",
        "completed" => "Completed",
        "cancelled" => "Cancel",
        "not_came" => "Not Came",
        _ => "Not Confirmed",
    }
}

fn mode_group(source: &str, source_channel: &str) -> &'static str {
    let value = format!("{} {}", source, source_channel).to_ascii_lowercase();
    if ["online", "web", "app", "public", "portal"]
        .iter()
        .any(|candidate| value.contains(candidate))
    {
        "online"
    } else if value.contains("import") {
        "import"
    } else {
        "manual"
    }
}

fn mode_label(group: &str) -> &'static str {
    match group {
        "online" => "Online",
        "import" => "Import",
        _ => "Manual",
    }
}

fn initials(name: &str) -> String {
    let parts = name
        .split_whitespace()
        .filter_map(|part| part.chars().next())
        .collect::<Vec<_>>();
    match (parts.first(), parts.last()) {
        (Some(first), Some(last)) if parts.len() > 1 => format!("{}{}", first, last).to_uppercase(),
        (Some(first), _) => first.to_uppercase().to_string(),
        _ => "S".to_string(),
    }
}

fn rupees(paise: i64) -> f64 {
    paise as f64 / 100.0
}

fn average_rupees(total_paise: i64, count: usize) -> f64 {
    if count == 0 {
        0.0
    } else {
        ((total_paise as f64 / count as f64) / 100.0 * 100.0).round() / 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_legacy_status_and_mode_groups() {
        assert_eq!(status_group("in_progress"), "started");
        assert_eq!(status_group("no show"), "not_came");
        assert_eq!(mode_group("customer_app", "public"), "online");
        assert_eq!(initials("Aftab Ahamad"), "AA");
    }
}
