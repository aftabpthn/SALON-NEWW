//! Multi-step planning over the allow-listed tools.
//!
//! Until now a question reached exactly one tool. "Why did revenue drop" got
//! the profit figures and stopped, when the useful answer is profit *plus* the
//! service and staff trends that explain it. The four cross-module tools in
//! `ai_cross_module_tools` were the workaround: each is a hand-written pairing,
//! so the combinations that exist are the ones someone thought to write.
//!
//! A plan is that generalised. It is deliberately not a free-form program:
//!
//! * **The enum is the allow-list.** A [`Plan`] holds `CopilotTool` values, so
//!   there is no representation for a step naming something that does not
//!   exist. This is the same structural guarantee the single-tool path has, and
//!   it is what makes a planner safe to put a language model behind later — a
//!   model that returns nonsense produces no plan rather than a novel query.
//! * **Every step is dispatched separately.** Permissions are re-checked per
//!   tool by `ai_tool_dispatcher`, so a plan cannot widen what its caller may
//!   read by bundling a permitted tool with one they may not run.
//! * **It is bounded.** [`MAX_STEPS`] caps the work one question can cause,
//!   which matters more here than in the single-tool path because a plan
//!   multiplies database reads.
//!
//! What a plan does *not* do is decide anything new. It picks which existing
//! tools to run and in what order; the answers, the evidence and the scope
//! disclosure are produced by the same tools as before, so a planned answer and
//! a directly-asked one cannot disagree.
//!
//! A language-model planner plugs in at [`plan_for`], replacing the intent
//! matching below while keeping every guarantee above — the constraints live in
//! the type and the dispatcher, not in the thing that chooses.

use crate::services::ai_copilot_tools::CopilotTool;

/// The most tools one question may run.
///
/// Five is what the existing diagnostic composite runs, so it is a known-safe
/// ceiling for reads and response size rather than a number picked for looking
/// round.
pub const MAX_STEPS: usize = 5;

/// An ordered, deduplicated, bounded set of tools to answer one question.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    steps: Vec<CopilotTool>,
    /// Why these tools, in the planner's own words. Carried onto the answer so
    /// a reader can tell why a question produced five sections.
    pub rationale: &'static str,
}

impl Plan {
    /// Builds a plan, enforcing every invariant at construction.
    ///
    /// Deduplicates rather than rejecting repeats: a planner naming the same
    /// tool twice is asking for one thing badly, not asking for something
    /// dangerous, and running it twice would only waste a read. Steps past
    /// [`MAX_STEPS`] are dropped rather than failing the plan, because a
    /// truncated answer is more useful than none.
    pub fn new(steps: impl IntoIterator<Item = CopilotTool>, rationale: &'static str) -> Self {
        let mut unique: Vec<CopilotTool> = Vec::new();
        for step in steps {
            if unique.len() >= MAX_STEPS {
                break;
            }
            if !unique.contains(&step) {
                unique.push(step);
            }
        }
        Self {
            steps: unique,
            rationale,
        }
    }

    pub fn steps(&self) -> &[CopilotTool] {
        &self.steps
    }

    /// Whether this plan runs more than one tool, and therefore needs merging
    /// rather than being answered by the single-tool path.
    pub fn is_multi_step(&self) -> bool {
        self.steps.len() > 1
    }

    /// The tool the answer is attributed to. The first step is the one the
    /// question actually asked; the rest are there to explain it.
    pub fn primary(&self) -> Option<CopilotTool> {
        self.steps.first().copied()
    }

    /// Narrows a plan to what this role may run.
    ///
    /// Applied before execution so a plan is not built, dispatched and then
    /// half-refused. The dispatcher still checks every surviving step — this
    /// only avoids doing obviously-doomed work, it is not the access decision.
    pub fn permitted_for(&self, role: &str) -> Self {
        Self {
            steps: self
                .steps
                .iter()
                .copied()
                .filter(|tool| tool.permitted_for(role))
                .collect(),
            rationale: self.rationale,
        }
    }
}

/// Whether the question is unambiguously about one named person.
///
/// Not `subject_candidates`: that is every word left after the question words
/// are stripped, so "why is my profit falling" arrives carrying `["profit",
/// "falling"]` and looks named when nothing was. The tools treat those as
/// *search terms* and fall back when nothing matches, which is fine for a
/// lookup and wrong as a planning signal — reading it that way would collapse
/// every cause question back to a single step.
///
/// The two markers `subject_of` itself privileges are the honest ones: a quoted
/// name, and a run of digits long enough to be a phone number.
fn names_one_person(question: &str) -> bool {
    if question
        .split('"')
        .nth(1)
        .is_some_and(|quoted| !quoted.trim().is_empty())
    {
        return true;
    }
    question.chars().filter(char::is_ascii_digit).count() >= 6
}

/// Whether the question asks *why*, rather than *what*.
///
/// This is the signal that separates a plan from a lookup. "Which services are
/// declining" wants a list; "why are services declining" wants the list plus
/// whatever explains it, and answering the second with the first is the gap
/// this module exists to close.
fn asks_for_a_cause(text: &str) -> bool {
    const CAUSE_MARKERS: &[&str] = &[
        "why",
        "reason",
        "cause",
        "explain",
        "kyun",
        "kyu",
        "kyon",
        "wajah",
        "vajah",
        "samjhao",
        "क्यों",
        "वजह",
        "कारण",
    ];
    CAUSE_MARKERS.iter().any(|marker| text.contains(marker))
}

/// Supporting tools that help explain a primary finding.
///
/// Ordered by how directly each explains the primary, because the order is what
/// the answer reads in. Only tools that read a *different* module are listed: a
/// second view of the same data explains nothing.
fn supporting_tools(primary: CopilotTool) -> &'static [CopilotTool] {
    match primary {
        // Money down: the two things that move it are what was sold and who
        // sold it, then whether discounting ate the margin.
        CopilotTool::ProfitIntelligence => &[
            CopilotTool::ServiceDecline,
            CopilotTool::StaffPerformanceDecline,
            CopilotTool::OfferPerformance,
        ],
        // A service falling off is either fewer people, or the same people
        // going elsewhere for it, or the staff who deliver it.
        CopilotTool::ServiceDecline => &[
            CopilotTool::LapsedClients,
            CopilotTool::StaffPerformanceDecline,
        ],
        // Staff numbers falling can be demand-led rather than performance-led;
        // the service trend is what tells the two apart.
        CopilotTool::StaffPerformanceDecline => &[CopilotTool::ServiceDecline],
        // Clients drifting away: what they used to come for, and whether a
        // membership was holding them.
        CopilotTool::LapsedClients => {
            &[CopilotTool::MembershipRenewals, CopilotTool::ServiceDecline]
        }
        // A renewal queue is only alarming in the context of who is already
        // drifting.
        CopilotTool::MembershipRenewals => &[CopilotTool::LapsedClients],
        // Offers that are not paying back are usually a pricing question, so
        // the margin view is what completes it.
        CopilotTool::OfferPerformance => &[CopilotTool::ProfitIntelligence],
        // Stock risk is driven by what is being consumed.
        CopilotTool::InventoryRisk => &[CopilotTool::ServiceDecline],
        // Everything else answers on its own. The composites are already
        // multi-module by construction, and workflow help reads no data.
        _ => &[],
    }
}

/// Chooses the tools that answer a question.
///
/// The single-tool detection is the primary; a cause question adds the
/// supporting tools that explain it. A question that does not ask why produces
/// a one-step plan, which is exactly the old behaviour — so this cannot change
/// the answer to anything that worked before.
///
/// This is the seam a language-model planner replaces. Whatever chooses the
/// steps, it can only choose from the enum and the result is still bounded,
/// deduplicated and dispatched per tool.
pub fn plan_for(question: &str) -> Plan {
    let Some(matched) = crate::services::ai_copilot_tools::detect(question) else {
        return Plan::new([], "no tool matched the question");
    };
    let primary = matched.tool;
    let text = question.to_ascii_lowercase();

    // A question about one named person stays about that person. Widening
    // "why did Anita stop coming" into branch-wide trends answers a different
    // question than the one asked.
    if names_one_person(question) {
        return Plan::new([primary], "a question about one named subject");
    }
    if !asks_for_a_cause(&text) {
        return Plan::new([primary], "a direct question, answered by one tool");
    }
    let supporting = supporting_tools(primary);
    if supporting.is_empty() {
        return Plan::new([primary], "no supporting view adds to this answer");
    }
    Plan::new(
        std::iter::once(primary).chain(supporting.iter().copied()),
        "a cause question, answered with the views that explain it",
    )
}

/// Runs a plan's supporting steps and folds what they found into the answer.
///
/// The primary answer is produced first and is never replaced — a plan adds
/// context to it, so a cause question cannot come back with a *different*
/// conclusion than the same question asked directly. Supporting findings are
/// appended as evidence lines naming the tool they came from, the same shape
/// the existing diagnostic composite uses, so a reader can trace any line back.
///
/// Every step goes through `ai_tool_dispatcher::dispatch`, which re-resolves
/// scope and re-checks the domain permission. Bundling steps behind one
/// question cannot widen what the caller may read.
///
/// A supporting step that fails or is refused is dropped silently. It is extra
/// context by definition, and losing the whole answer because a secondary read
/// failed would be a worse outcome than a shorter one. A refusal is not
/// described either, so the answer does not leak what it withheld.
pub async fn augment(
    db: &sqlx::PgPool,
    tenant_id: &str,
    claims: &crate::services::auth_service::AuthClaims,
    actor: &crate::services::ai_copilot_tools::ToolActor,
    question: &str,
    mut answer: crate::services::ai_copilot_tools::CopilotAnswer,
) -> crate::services::ai_copilot_tools::CopilotAnswer {
    let plan = plan_for(question).permitted_for(&actor.role);
    if !plan.is_multi_step() {
        return answer;
    }
    let primary = plan.primary();
    for step in plan.steps().iter().copied() {
        if Some(step) == primary {
            continue;
        }
        let matched = crate::services::ai_copilot_tools::continue_tool(step, Vec::new());
        let outcome = crate::services::ai_tool_dispatcher::dispatch(
            db,
            tenant_id,
            claims,
            actor,
            &matched,
            &crate::services::ai_scope_service::ScopeRequest::default(),
        )
        .await;
        let Ok(part) = outcome else {
            continue;
        };
        answer
            .evidence
            .push(format!("[{}] {}", part.tool, part.headline));
        // Naming every module the figures came from keeps a folded-in number
        // as traceable as one the primary tool produced.
        if !answer.sources.contains(&part.source) {
            answer.sources.push(part.source);
        }
    }
    answer
}

#[cfg(test)]
mod tests {
    use super::{plan_for, Plan, MAX_STEPS};
    use crate::services::ai_copilot_tools::CopilotTool;

    #[test]
    fn a_direct_question_still_runs_exactly_one_tool() {
        // The compatibility guarantee: anything that worked before must not
        // start running four extra queries.
        for question in [
            "which services are declining",
            "which clients have stopped coming",
            "which products will run out soon",
            "how do I create a bill",
        ] {
            let plan = plan_for(question);
            assert_eq!(
                plan.steps().len(),
                1,
                "{question:?} should stay single-step"
            );
            assert!(!plan.is_multi_step());
        }
    }

    #[test]
    fn a_cause_question_plans_the_views_that_explain_it() {
        let plan = plan_for("why is my profit falling");
        assert_eq!(plan.primary(), Some(CopilotTool::ProfitIntelligence));
        assert!(plan.is_multi_step());
        assert!(plan.steps().contains(&CopilotTool::ServiceDecline));
        assert!(plan.steps().contains(&CopilotTool::StaffPerformanceDecline));
    }

    #[test]
    fn a_hinglish_cause_question_plans_the_same_way() {
        // Routing works in the register these questions arrive in, so planning
        // has to as well or the feature only exists in English.
        let plan = plan_for("service kam kyun ho rahi hai");
        assert!(plan.is_multi_step(), "expected a plan, got {plan:?}");
        assert_eq!(plan.primary(), Some(CopilotTool::ServiceDecline));
    }

    #[test]
    fn a_question_about_one_person_is_never_widened() {
        // "Why did Anita stop coming" is about Anita. Answering it with
        // branch-wide trends answers a question nobody asked.
        let plan = plan_for("why did \"Anita Sharma\" stop coming");
        assert_eq!(
            plan.steps().len(),
            1,
            "named subject must not fan out: {plan:?}"
        );
    }

    #[test]
    fn an_unmatched_question_plans_nothing() {
        let plan = plan_for("what is the weather today");
        assert!(plan.steps().is_empty());
        assert_eq!(plan.primary(), None);
    }

    #[test]
    fn a_plan_is_bounded_and_deduplicated() {
        let plan = Plan::new(
            [
                CopilotTool::ProfitIntelligence,
                CopilotTool::ProfitIntelligence,
                CopilotTool::ServiceDecline,
                CopilotTool::LapsedClients,
                CopilotTool::InventoryRisk,
                CopilotTool::OfferPerformance,
                CopilotTool::RegularClients,
                CopilotTool::MembershipRenewals,
            ],
            "test",
        );
        assert_eq!(plan.steps().len(), MAX_STEPS);
        // The duplicate collapsed rather than consuming a slot.
        assert_eq!(plan.steps()[0], CopilotTool::ProfitIntelligence);
        assert_eq!(plan.steps()[1], CopilotTool::ServiceDecline);
    }

    #[test]
    fn a_plan_narrows_to_what_the_role_may_run() {
        // A receptionist asking why profit is down must not get the money
        // views bundled in behind a permitted step.
        let plan = plan_for("why is my profit falling").permitted_for("receptionist");
        assert!(
            !plan.steps().contains(&CopilotTool::ProfitIntelligence),
            "finance leaked into a receptionist plan: {plan:?}"
        );
        assert!(
            !plan.steps().contains(&CopilotTool::StaffPerformanceDecline),
            "staff comparison leaked into a receptionist plan: {plan:?}"
        );
    }

    #[test]
    fn an_owner_keeps_the_whole_plan() {
        let plan = plan_for("why is my profit falling");
        let owner = plan.clone().permitted_for("owner");
        assert_eq!(owner, plan, "owner plan should not be narrowed");
    }
}
