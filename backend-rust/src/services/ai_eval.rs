//! Scored evaluation of what the copilot does with a question.
//!
//! The existing `ai_evaluation_tests` asserts *access* decisions — whether a
//! receptionist may reach staff comparisons. That is worth testing and is not
//! this. Nothing measured whether a question reaches the right tool at all, so
//! a routing change could quietly send "which clients stopped coming" to the
//! membership queue and every test would still pass.
//!
//! Two things make this an evaluation rather than more assertions:
//!
//! * **It scores.** A pass/fail suite says a change broke something. A score
//!   says routing went from 91% to 84%, which is the number you need to decide
//!   whether a prompt or keyword change was worth it.
//! * **The cases are written from the question, not the code.** Every case
//!   below is phrased the way an owner or receptionist actually types — English,
//!   Hinglish and Hindi, in the mixed register Indian salon staff use. Cases
//!   derived by reading `detect_tool` would only prove the implementation
//!   matches itself.
//!
//! The floor test is the regression guard, and it earned its place on the first
//! run: the set scored 81.5% and named five routing bugs, including "which
//! clients have stopped coming" and "how is the business doing" reaching no tool
//! at all — the two most natural questions in the product. Those are fixed and
//! it now scores 100%.
//!
//! The floor sits one case below that rather than at 100%, so a hard new case
//! can be added without breaking the build the moment it lands. Two failures
//! means either fixing them or lowering the line, and lowering it is a decision
//! someone has to write down.

use crate::services::ai_copilot_tools::{self, CopilotTool};

/// One question, and the tool it should reach.
///
/// `None` means the question should *not* route to a CRM tool — small talk and
/// out-of-scope requests belong to the provider, and a tool answering them
/// would be a confidently wrong CRM answer.
pub struct EvalCase {
    pub question: &'static str,
    pub expected: Option<CopilotTool>,
    /// Why this case exists. Read when a case starts failing.
    pub note: &'static str,
}

/// The result of running the golden set.
pub struct EvalReport {
    pub total: usize,
    pub correct: usize,
    /// `(question, expected, actual)` for everything that missed.
    pub misses: Vec<(&'static str, String, String)>,
}

impl EvalReport {
    pub fn accuracy_percent(&self) -> f64 {
        if self.total == 0 {
            return 0.0;
        }
        (self.correct as f64 / self.total as f64) * 100.0
    }

    /// A report a person can act on: the score, then every miss with what it
    /// went to instead.
    pub fn summary(&self) -> String {
        let mut out = format!(
            "routing accuracy {:.1}% ({}/{})",
            self.accuracy_percent(),
            self.correct,
            self.total
        );
        for (question, expected, actual) in &self.misses {
            out.push_str(&format!(
                "\n  {question:?}\n    want {expected}, got {actual}"
            ));
        }
        out
    }
}

fn tool_label(tool: Option<CopilotTool>) -> String {
    tool.map(|tool| tool.name().to_string())
        .unwrap_or_else(|| "<no tool>".to_string())
}

/// Runs every case and scores it.
pub fn run(cases: &[EvalCase]) -> EvalReport {
    let mut report = EvalReport {
        total: cases.len(),
        correct: 0,
        misses: Vec::new(),
    };
    for case in cases {
        let actual = ai_copilot_tools::detect(case.question).map(|matched| matched.tool);
        if actual == case.expected {
            report.correct += 1;
        } else {
            report
                .misses
                .push((case.question, tool_label(case.expected), tool_label(actual)));
        }
    }
    report
}

/// The golden set.
///
/// Grouped by what the person wants, not by tool, because that is how the
/// questions arrive. Adding a case that currently fails is fine and useful —
/// it lowers the score, which is the signal that routing has a gap.
pub const GOLDEN_SET: &[EvalCase] = &[
    // ---- staff performance ----
    EvalCase {
        question: "which staff member's performance is dropping",
        expected: Some(CopilotTool::StaffPerformanceDecline),
        note: "plain English, the canonical phrasing",
    },
    EvalCase {
        question: "kis staff ka performance gir raha hai",
        expected: Some(CopilotTool::StaffPerformanceDecline),
        note: "Hinglish, how a floor manager types it",
    },
    EvalCase {
        question: "staff performance kam kyun ho raha hai",
        expected: Some(CopilotTool::StaffDeclineCause),
        note: "asks why, and that is precisely what the cross-module tool \
               answers — whether the decline is demand-led or performance-led. \
               This case expected the single-module tool until 'kam kyun' \
               started matching; the expectation was wrong, not the routing",
    },
    // ---- services ----
    EvalCase {
        question: "which services are declining",
        expected: Some(CopilotTool::ServiceDecline),
        note: "service trend, the branch-level question",
    },
    EvalCase {
        question: "kaunsi service down ja rahi hai",
        expected: Some(CopilotTool::ServiceDecline),
        note: "Hinglish service decline",
    },
    EvalCase {
        question: "which service should I run an offer on",
        expected: Some(CopilotTool::ServiceOffer),
        note: "offer on a service, not to a person",
    },
    EvalCase {
        question: "service kam kyun ho rahi hai",
        expected: Some(CopilotTool::ServiceDecline),
        note: "found by the planner: the question word splits 'kam ho', which \
               is the commonest Hinglish phrasing and matched nothing",
    },
    // ---- clients ----
    EvalCase {
        question: "which clients have stopped coming",
        expected: Some(CopilotTool::LapsedClients),
        note: "lapsed clients, the retention entry point",
    },
    EvalCase {
        question: "kaun se client ab nahi aa rahe",
        expected: Some(CopilotTool::LapsedClients),
        note: "Hinglish lapsed clients",
    },
    EvalCase {
        question: "why did \"Anita Sharma\" stop coming",
        expected: Some(CopilotTool::LapsedClients),
        note: "found by the planner: the past tense matched, the present did not",
    },
    EvalCase {
        question: "who are my regular clients",
        expected: Some(CopilotTool::RegularClients),
        note: "best clients, distinct from lapsed",
    },
    EvalCase {
        question: "when will Anita come back",
        expected: Some(CopilotTool::ClientReturnForecast),
        note: "named client, return window",
    },
    EvalCase {
        question: "\"Priya Sharma\" ki favourite service kya hai",
        expected: Some(CopilotTool::ClientFavouriteService),
        note: "quoted name so the subject is unambiguous",
    },
    EvalCase {
        question: "Anita ko kaunsa offer dein",
        expected: Some(CopilotTool::ClientOffer),
        note: "offer to a person: 'ko' marks the recipient",
    },
    // ---- memberships ----
    EvalCase {
        question: "which memberships are due for renewal",
        expected: Some(CopilotTool::MembershipRenewals),
        note: "the branch renewal queue, no subject",
    },
    EvalCase {
        question: "Priya ka membership status kya hai",
        expected: Some(CopilotTool::MembershipStatus),
        note: "same domain, but a named subject flips it to one person",
    },
    // ---- money ----
    EvalCase {
        question: "where is my profit coming from",
        expected: Some(CopilotTool::ProfitIntelligence),
        note: "profit dimensions",
    },
    EvalCase {
        question: "are my offers actually making money",
        expected: Some(CopilotTool::OfferPerformance),
        note: "offer performance, not offer targeting",
    },
    // ---- inventory ----
    EvalCase {
        question: "which products will run out soon",
        expected: Some(CopilotTool::InventoryRisk),
        note: "reorder risk",
    },
    EvalCase {
        question: "kaunsa stock khatam hone wala hai",
        expected: Some(CopilotTool::InventoryRisk),
        note: "Hinglish reorder risk",
    },
    // ---- workflow help ----
    EvalCase {
        question: "how do I create a bill",
        expected: Some(CopilotTool::BillingHowTo),
        note: "workflow help, reads no CRM data",
    },
    EvalCase {
        question: "bill kaise banaye",
        expected: Some(CopilotTool::BillingHowTo),
        note: "Hinglish workflow help",
    },
    // ---- overview ----
    EvalCase {
        question: "how is the business doing",
        expected: Some(CopilotTool::BusinessOverview),
        note: "branch snapshot",
    },
    // ---- Devanagari ----
    EvalCase {
        question: "कौन से ग्राहक अब नहीं आ रहे",
        expected: Some(CopilotTool::LapsedClients),
        note: "Hindi script is a supported input, not a fallback",
    },
    EvalCase {
        question: "कौन सी सर्विस कम हो रही है",
        expected: Some(CopilotTool::ServiceDecline),
        note: "Hindi script service decline",
    },
    // ---- must NOT route to a tool ----
    EvalCase {
        question: "hello",
        expected: None,
        note: "greeting: a CRM tool answering this would be noise",
    },
    EvalCase {
        question: "thank you",
        expected: None,
        note: "closing pleasantry",
    },
    EvalCase {
        question: "what is the weather today",
        expected: None,
        note: "out of scope; must not be forced into a CRM answer",
    },
    EvalCase {
        question: "book me a table at a restaurant",
        expected: None,
        note: "adjacent-sounding but not a CRM capability",
    },
];

#[cfg(test)]
mod tests {
    use super::{run, GOLDEN_SET};

    /// The golden set currently routes at 100%. The floor sits one case below
    /// that, which is the deliberate trade: real regression is caught, and
    /// adding a hard new case that fails is possible without breaking the build
    /// on the spot — but adding two means either fixing them or lowering this
    /// line, and lowering it is a decision someone has to write down.
    const ROUTING_ACCURACY_FLOOR: f64 = 96.0;

    #[test]
    fn routing_accuracy_stays_above_the_floor() {
        let report = run(GOLDEN_SET);
        assert!(
            report.accuracy_percent() >= ROUTING_ACCURACY_FLOOR,
            "routing regressed below {ROUTING_ACCURACY_FLOOR}%\n{}",
            report.summary()
        );
    }

    #[test]
    fn small_talk_never_reaches_a_crm_tool() {
        // Held to 100% separately from the overall floor. A wrong tool on a
        // real question is a bad answer; a tool firing on "hello" is the
        // assistant looking broken.
        let chatter: Vec<_> = GOLDEN_SET
            .iter()
            .filter(|case| case.expected.is_none())
            .map(|case| super::EvalCase {
                question: case.question,
                expected: case.expected,
                note: case.note,
            })
            .collect();
        let report = run(&chatter);
        assert_eq!(
            report.correct,
            report.total,
            "small talk routed to a tool\n{}",
            report.summary()
        );
    }

    #[test]
    fn the_golden_set_covers_hinglish_and_hindi() {
        // Routing that only works in English is routing that does not work: the
        // register these questions arrive in is mixed, and a golden set that
        // drifts to English-only would stop measuring the real input.
        let devanagari = GOLDEN_SET
            .iter()
            .filter(|case| {
                case.question
                    .chars()
                    .any(|c| ('\u{0900}'..='\u{097F}').contains(&c))
            })
            .count();
        let hinglish = GOLDEN_SET
            .iter()
            .filter(|case| {
                ["kis", "kaun", "kaise", "kya", "ko ", "raha", "rahi", "hai"]
                    .iter()
                    .any(|marker| case.question.contains(marker))
            })
            .count();
        assert!(devanagari >= 2, "Hindi-script coverage dropped");
        assert!(hinglish >= 8, "Hinglish coverage dropped");
    }

    #[test]
    fn every_case_explains_itself() {
        // A case with no note is a case nobody can act on when it fails.
        for case in GOLDEN_SET {
            assert!(
                !case.note.trim().is_empty(),
                "case {:?} has no note",
                case.question
            );
        }
    }

    /// Prints the score without asserting on it. Run with `--nocapture` before
    /// deciding whether a routing change was worth it, or whether the floor can
    /// be raised.
    #[test]
    fn report_current_routing_score() {
        println!("{}", run(GOLDEN_SET).summary());
    }
}
