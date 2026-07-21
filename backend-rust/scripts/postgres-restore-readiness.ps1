[CmdletBinding()]
param(
  [string]$Container = 'aurashine-postgres',
  [string]$Database = 'aura_shine',
  [string]$User = 'postgres'
)

$ErrorActionPreference = 'Stop'
$scratch = "aurashine_restore_$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$dump = "/tmp/$scratch.dump"

if ($scratch -notmatch '^aurashine_restore_[0-9]+$') { throw 'unsafe scratch database name' }

try {
  docker exec $Container pg_dump -U $User -d $Database -Fc -f $dump
  docker exec $Container createdb -U $User $scratch
  docker exec $Container pg_restore -U $User -d $scratch --no-owner --no-privileges $dump
  docker exec $Container psql -U $User -d $scratch -v ON_ERROR_STOP=1 -P pager=off -c @'
SELECT current_database() restored_database,
       (SELECT COUNT(*) FROM _sqlx_migrations) migration_count,
       (SELECT COUNT(*) FROM appointments) appointment_count,
       (SELECT COUNT(*) FROM clients) client_count,
       (SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated) unvalidated_foreign_keys;
'@
  docker exec $Container sha256sum $dump
} finally {
  docker exec $Container dropdb -U $User --if-exists --force $scratch
  docker exec $Container rm -f $dump
}
