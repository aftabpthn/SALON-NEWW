#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${K6_EVIDENCE_ENVIRONMENT:?K6_EVIDENCE_ENVIRONMENT is required}"
: "${K6_EVIDENCE_START_TIME:?K6_EVIDENCE_START_TIME is required}"
: "${K6_EVIDENCE_END_TIME:?K6_EVIDENCE_END_TIME is required}"

output_dir="${K6_EVIDENCE_OUTPUT_DIR:-backend-rust/load-tests/artifacts/aws}"
mkdir -p "$output_dir"

resource_prefix="aurashine-${K6_EVIDENCE_ENVIRONMENT}"
rds_id="${resource_prefix}-postgres"
redis_id="${resource_prefix}-redis"
alb_name="${resource_prefix}-api"

alb_arn="$(aws elbv2 describe-load-balancers --names "$alb_name" --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
target_group_arn="$(aws elbv2 describe-target-groups --names "$alb_name" --query 'TargetGroups[0].TargetGroupArn' --output text)"
alb_suffix="${alb_arn#*:loadbalancer/}"
target_group_suffix="${target_group_arn#*:targetgroup/}"
parameter_group="$(aws rds describe-db-instances --db-instance-identifier "$rds_id" --query 'DBInstances[0].DBParameterGroups[0].DBParameterGroupName' --output text)"
slow_query_threshold="$(aws rds describe-db-parameters --db-parameter-group-name "$parameter_group" --query 'Parameters[?ParameterName==`log_min_duration_statement`].ParameterValue | [0]' --output text)"

if [[ "$slow_query_threshold" != "500" ]]; then
  echo "RDS log_min_duration_statement must be 500 ms for valid slow-query evidence; found: $slow_query_threshold" >&2
  exit 1
fi

jq -n \
  --arg alb "$alb_suffix" \
  --arg target "$target_group_suffix" \
  --arg rds "$rds_id" \
  --arg redis "$redis_id" \
  '[
    {Id:"alb_p95",MetricStat:{Metric:{Namespace:"AWS/ApplicationELB",MetricName:"TargetResponseTime",Dimensions:[{Name:"LoadBalancer",Value:$alb},{Name:"TargetGroup",Value:$target}]},Period:60,Stat:"p95"},ReturnData:true},
    {Id:"alb_5xx",MetricStat:{Metric:{Namespace:"AWS/ApplicationELB",MetricName:"HTTPCode_Target_5XX_Count",Dimensions:[{Name:"LoadBalancer",Value:$alb},{Name:"TargetGroup",Value:$target}]},Period:60,Stat:"Sum"},ReturnData:true},
    {Id:"rds_connections",MetricStat:{Metric:{Namespace:"AWS/RDS",MetricName:"DatabaseConnections",Dimensions:[{Name:"DBInstanceIdentifier",Value:$rds}]},Period:60,Stat:"Maximum"},ReturnData:true},
    {Id:"rds_cpu",MetricStat:{Metric:{Namespace:"AWS/RDS",MetricName:"CPUUtilization",Dimensions:[{Name:"DBInstanceIdentifier",Value:$rds}]},Period:60,Stat:"Average"},ReturnData:true},
    {Id:"rds_read_latency",MetricStat:{Metric:{Namespace:"AWS/RDS",MetricName:"ReadLatency",Dimensions:[{Name:"DBInstanceIdentifier",Value:$rds}]},Period:60,Stat:"Average"},ReturnData:true},
    {Id:"rds_write_latency",MetricStat:{Metric:{Namespace:"AWS/RDS",MetricName:"WriteLatency",Dimensions:[{Name:"DBInstanceIdentifier",Value:$rds}]},Period:60,Stat:"Average"},ReturnData:true},
    {Id:"redis_hits",MetricStat:{Metric:{Namespace:"AWS/ElastiCache",MetricName:"CacheHits",Dimensions:[{Name:"ReplicationGroupId",Value:$redis}]},Period:60,Stat:"Sum"},ReturnData:false},
    {Id:"redis_misses",MetricStat:{Metric:{Namespace:"AWS/ElastiCache",MetricName:"CacheMisses",Dimensions:[{Name:"ReplicationGroupId",Value:$redis}]},Period:60,Stat:"Sum"},ReturnData:false},
    {Id:"redis_hit_rate",Expression:"IF((redis_hits + redis_misses) > 0, 100 * redis_hits / (redis_hits + redis_misses), 100)",Label:"Redis cache hit percent",ReturnData:true},
    {Id:"redis_connections",MetricStat:{Metric:{Namespace:"AWS/ElastiCache",MetricName:"CurrConnections",Dimensions:[{Name:"ReplicationGroupId",Value:$redis}]},Period:60,Stat:"Maximum"},ReturnData:true},
    {Id:"redis_evictions",MetricStat:{Metric:{Namespace:"AWS/ElastiCache",MetricName:"Evictions",Dimensions:[{Name:"ReplicationGroupId",Value:$redis}]},Period:60,Stat:"Sum"},ReturnData:true}
  ]' > "$output_dir/metric-queries.json"

aws cloudwatch get-metric-data \
  --region "$AWS_REGION" \
  --start-time "$K6_EVIDENCE_START_TIME" \
  --end-time "$K6_EVIDENCE_END_TIME" \
  --scan-by TimestampAscending \
  --metric-data-queries "file://$output_dir/metric-queries.json" \
  > "$output_dir/cloudwatch-metrics.json"

start_epoch="$(date -u -d "$K6_EVIDENCE_START_TIME" +%s)"
end_epoch="$(date -u -d "$K6_EVIDENCE_END_TIME" +%s)"
log_group="/aws/rds/instance/${rds_id}/postgresql"
query_string='fields @timestamp, @message | filter @message like /duration: [0-9]/ | parse @message /duration: (?<durationMs>[0-9.]+) ms/ | filter durationMs >= 500 | sort durationMs desc | limit 100'
query_id="$(aws logs start-query --region "$AWS_REGION" --log-group-name "$log_group" --start-time "$start_epoch" --end-time "$end_epoch" --query-string "$query_string" --query queryId --output text)"

for _ in $(seq 1 30); do
  aws logs get-query-results --region "$AWS_REGION" --query-id "$query_id" > "$output_dir/rds-slow-queries.json"
  status="$(jq -r '.status' "$output_dir/rds-slow-queries.json")"
  if [[ "$status" == "Complete" || "$status" == "Failed" || "$status" == "Cancelled" || "$status" == "Timeout" ]]; then
    break
  fi
  sleep 2
done

jq -n \
  --arg capturedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg environment "$K6_EVIDENCE_ENVIRONMENT" \
  --arg region "$AWS_REGION" \
  --arg startTime "$K6_EVIDENCE_START_TIME" \
  --arg endTime "$K6_EVIDENCE_END_TIME" \
  --arg rds "$rds_id" \
  --arg redis "$redis_id" \
  --arg alb "$alb_name" \
  '{capturedAt:$capturedAt,environment:$environment,region:$region,startTime:$startTime,endTime:$endTime,rdsInstance:$rds,redisReplicationGroup:$redis,loadBalancer:$alb}' \
  > "$output_dir/metadata.json"

test "$(jq -r '.status' "$output_dir/rds-slow-queries.json")" = "Complete"

