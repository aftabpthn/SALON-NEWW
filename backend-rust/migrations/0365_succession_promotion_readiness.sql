ALTER TABLE staff_succession_plans
  ADD COLUMN IF NOT EXISTS target_role_id TEXT REFERENCES roles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS critical_role BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS closed_by TEXT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closure_note TEXT NOT NULL DEFAULT '';

ALTER TABLE staff_succession_candidates
  DROP CONSTRAINT IF EXISTS staff_succession_candidates_status_check;

ALTER TABLE staff_succession_candidates
  ADD COLUMN IF NOT EXISTS signal_snapshot_json JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (JSONB_TYPEOF(signal_snapshot_json)='object'),
  ADD COLUMN IF NOT EXISTS evidence_coverage_percent INTEGER NOT NULL DEFAULT 0 CHECK (evidence_coverage_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nominated_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_note TEXT NOT NULL DEFAULT '',
  ADD CONSTRAINT staff_succession_candidates_status_check CHECK (status IN ('proposed','approved','rejected','removed'));

UPDATE staff_succession_candidates SET nominated_by=created_by WHERE nominated_by='';

CREATE TABLE IF NOT EXISTS staff_succession_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES staff_succession_plans(id) ON DELETE RESTRICT,
  candidate_id TEXT REFERENCES staff_succession_candidates(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_succession_history_scope
  ON staff_succession_history(tenant_id,branch_id,plan_id,candidate_id,created_at,id);

CREATE OR REPLACE FUNCTION protect_staff_succession_history()
RETURNS TRIGGER AS $$ BEGIN
  RAISE EXCEPTION 'succession history is immutable';
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_succession_history_immutable ON staff_succession_history;
CREATE TRIGGER trg_staff_succession_history_immutable
  BEFORE UPDATE OR DELETE ON staff_succession_history
  FOR EACH ROW EXECUTE FUNCTION protect_staff_succession_history();

CREATE OR REPLACE FUNCTION staff_succession_signal_snapshot(
  p_tenant_id TEXT,
  p_branch_id TEXT,
  p_plan_id TEXT,
  p_staff_id TEXT
) RETURNS JSONB LANGUAGE SQL STABLE AS $$
WITH plan AS (
  SELECT target_role_id FROM staff_succession_plans
  WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND id=p_plan_id AND status='active'
), requirements AS (
  SELECT DISTINCT requirement.id,requirement.skill_name,requirement.required_level,requirement.certification_required
  FROM staff_skill_requirements requirement CROSS JOIN plan
  WHERE requirement.tenant_id=p_tenant_id AND requirement.branch_id=p_branch_id AND requirement.active=TRUE AND (
    (plan.target_role_id IS NOT NULL AND requirement.scope_type='role' AND requirement.scope_id=plan.target_role_id)
    OR (plan.target_role_id IS NULL AND (
      (requirement.scope_type='role' AND EXISTS(
        SELECT 1 FROM staff_role_assignments assignment
        WHERE assignment.tenant_id=p_tenant_id AND assignment.branch_id=p_branch_id
          AND assignment.staff_id=p_staff_id AND assignment.role_id=requirement.scope_id
      )) OR (requirement.scope_type='service' AND (
        EXISTS(SELECT 1 FROM staff_catalog_assignments assignment
          WHERE assignment.tenant_id=p_tenant_id AND assignment.branch_id=p_branch_id
            AND assignment.staff_id=p_staff_id AND assignment.item_type='service' AND assignment.item_id=requirement.scope_id)
        OR EXISTS(SELECT 1 FROM staff_service_assignments assignment
          WHERE assignment.tenant_id=p_tenant_id AND assignment.branch_id=p_branch_id
            AND assignment.staff_id=p_staff_id AND assignment.service_id=requirement.scope_id)
      ))
    ))
  )
), certified AS (
  SELECT LOWER(skill_name) skill_key,MAX(skill_level)::INTEGER available_level
  FROM staff_skill_licenses
  WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND staff_id=p_staff_id
    AND verification_status='verified' AND (expires_on IS NULL OR expires_on>=CURRENT_DATE)
  GROUP BY LOWER(skill_name)
), trained AS (
  SELECT LOWER(profile.skill_name) skill_key,MAX(profile.skill_level)::INTEGER available_level
  FROM staff_tasks task JOIN staff_course_profiles profile
    ON profile.tenant_id=task.tenant_id AND profile.branch_id=task.branch_id AND profile.document_id=task.course_document_id
  WHERE task.tenant_id=p_tenant_id AND task.branch_id=p_branch_id AND task.staff_id=p_staff_id
    AND task.status='completed' AND profile.skill_name<>''
  GROUP BY LOWER(profile.skill_name)
), requirement_status AS (
  SELECT requirement.*,
    CASE WHEN requirement.certification_required THEN COALESCE(certified.available_level,0)
      ELSE GREATEST(COALESCE(certified.available_level,0),COALESCE(trained.available_level,0)) END available_level
  FROM requirements requirement
  LEFT JOIN certified ON certified.skill_key=LOWER(requirement.skill_name)
  LEFT JOIN trained ON trained.skill_key=LOWER(requirement.skill_name)
), skills AS (
  SELECT COUNT(*)::INTEGER required_count,
    COUNT(*) FILTER(WHERE available_level>=required_level)::INTEGER met_count,
    CASE WHEN COUNT(*)=0 THEN NULL ELSE ROUND(COUNT(*) FILTER(WHERE available_level>=required_level)*100.0/COUNT(*))::INTEGER END score,
    COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('skillName',skill_name,'requiredLevel',required_level,
      'availableLevel',available_level,'met',available_level>=required_level) ORDER BY skill_name),'[]'::JSONB) details
  FROM requirement_status
), appraisal AS (
  SELECT review.final_score score,review.id review_id,review.final_rating,review.approved_at
  FROM staff_performance_reviews review
  WHERE review.tenant_id=p_tenant_id AND review.branch_id=p_branch_id AND review.staff_id=p_staff_id
    AND review.status IN ('approved','acknowledged') AND review.final_score IS NOT NULL
  ORDER BY review.approved_at DESC NULLS LAST,review.updated_at DESC NULLS LAST,review.created_at DESC LIMIT 1
), attendance_source AS (
  SELECT COALESCE(record.manual_status,record.status) attendance_status,record.late_minutes
  FROM staff_attendance_records record
  WHERE record.tenant_id=p_tenant_id AND record.branch_id=p_branch_id AND record.staff_id=p_staff_id
    AND record.business_date BETWEEN CURRENT_DATE-89 AND CURRENT_DATE
), attendance AS (
  SELECT COUNT(*) FILTER(WHERE attendance_status IN ('clocked_in','clocked_out','present','late','half_day','absent'))::INTEGER recorded_days,
    CASE WHEN COUNT(*) FILTER(WHERE attendance_status IN ('clocked_in','clocked_out','present','late','half_day','absent'))=0 THEN NULL
      ELSE GREATEST(0,ROUND((SUM(CASE WHEN attendance_status IN ('clocked_in','clocked_out','present','late') THEN 1.0 WHEN attendance_status='half_day' THEN 0.5 ELSE 0 END)*100.0)
        /COUNT(*) FILTER(WHERE attendance_status IN ('clocked_in','clocked_out','present','late','half_day','absent'))
        - LEAST(20,COALESCE(SUM(late_minutes),0)/30.0))::INTEGER) END score,
    COALESCE(SUM(late_minutes),0)::INTEGER late_minutes
  FROM attendance_source
), training AS (
  SELECT COUNT(*)::INTEGER assigned_count,COUNT(*) FILTER(WHERE status='completed')::INTEGER completed_count,
    CASE WHEN COUNT(*)=0 THEN NULL ELSE ROUND(COUNT(*) FILTER(WHERE status='completed')*100.0/COUNT(*))::INTEGER END score
  FROM staff_tasks
  WHERE tenant_id=p_tenant_id AND branch_id=p_branch_id AND staff_id=p_staff_id
    AND task_type='training' AND created_at>=NOW()-INTERVAL '365 days'
), components AS (
  SELECT skills.score skill_score,appraisal.score appraisal_score,attendance.score attendance_score,training.score training_score,
    skills.required_count,skills.met_count,skills.details skill_details,
    appraisal.review_id,appraisal.final_rating,appraisal.approved_at,
    attendance.recorded_days,attendance.late_minutes,training.assigned_count,training.completed_count,
    ((skills.score IS NOT NULL)::INTEGER+(appraisal.score IS NOT NULL)::INTEGER+
      (attendance.score IS NOT NULL)::INTEGER+(training.score IS NOT NULL)::INTEGER)*25 coverage,
    ROUND((COALESCE(skills.score*30,0)+COALESCE(appraisal.score*30,0)+COALESCE(attendance.score*20,0)+COALESCE(training.score*20,0))::NUMERIC
      /NULLIF((CASE WHEN skills.score IS NOT NULL THEN 30 ELSE 0 END)+(CASE WHEN appraisal.score IS NOT NULL THEN 30 ELSE 0 END)
        +(CASE WHEN attendance.score IS NOT NULL THEN 20 ELSE 0 END)+(CASE WHEN training.score IS NOT NULL THEN 20 ELSE 0 END),0))::INTEGER total_score
  FROM skills LEFT JOIN appraisal ON TRUE CROSS JOIN attendance CROSS JOIN training
), scored AS (
  SELECT COALESCE(total_score,0) score,components.* FROM components
)
SELECT JSONB_BUILD_OBJECT(
  'score',score,'readiness',CASE WHEN score>=85 THEN 'ready_now' WHEN score>=70 THEN 'short_term' WHEN score>=50 THEN 'long_term' ELSE 'not_ready' END,
  'coveragePercent',coverage,'calculatedAt',NOW(),
  'periods',JSONB_BUILD_OBJECT('attendanceStart',CURRENT_DATE-89,'attendanceEnd',CURRENT_DATE,'trainingStart',CURRENT_DATE-364,'trainingEnd',CURRENT_DATE),
  'skills',JSONB_BUILD_OBJECT('score',skill_score,'requiredCount',required_count,'metCount',met_count,'details',skill_details),
  'appraisal',JSONB_BUILD_OBJECT('score',appraisal_score,'reviewId',review_id,'rating',final_rating,'approvedAt',approved_at),
  'attendance',JSONB_BUILD_OBJECT('score',attendance_score,'recordedDays',recorded_days,'lateMinutes',late_minutes),
  'training',JSONB_BUILD_OBJECT('score',training_score,'assignedCount',assigned_count,'completedCount',completed_count)
) FROM scored;
$$;
