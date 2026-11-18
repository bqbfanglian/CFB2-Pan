import { Env, now } from './common';
import { buckets } from './storage';

export const chooseBucket = `WITH candidates AS (
  SELECT value ->> 'id' AS id, value ->> 'quota' AS quota, value ->> 'priority' AS priority
  FROM json_each(?)
), projected AS (
  SELECT c.*, inputs.bytes
    + COALESCE((SELECT SUM(bytes) FROM entries WHERE bucket_id = c.id), 0)
    + COALESCE((SELECT SUM(bytes) FROM uploads WHERE bucket_id = c.id AND state IN ('open', 'cancelled')), 0) AS projected_bytes
  FROM candidates c CROSS JOIN (SELECT ? AS bytes) inputs
  LEFT JOIN bucket_health h ON h.bucket_id = c.id
  WHERE COALESCE(h.retry_at, 0) <= ?
), target AS (
  SELECT id FROM projected WHERE projected_bytes <= quota
  ORDER BY CAST(projected_bytes AS REAL) / quota, priority, id LIMIT 1
)`;

export function candidateArguments(env: Env, bytes: number, exclude?: ReadonlySet<string>) {
  const candidates = buckets(env).filter(bucket => bucket.writable && !exclude?.has(bucket.id))
    .map(({ id, quota, priority }) => ({ id, quota, priority }));
  return [JSON.stringify(candidates), bytes, now()];
}

export async function summary(env: Env) {
  const quota = buckets(env).reduce((sum, bucket) => sum + bucket.quota, 0);
  const used = await env.DB.prepare(`SELECT COALESCE(SUM(bytes), 0) AS used FROM (
    SELECT bytes FROM entries WHERE kind = 'file'
    UNION ALL SELECT bytes FROM uploads WHERE state IN ('open', 'cancelled')
  )`).first<number>('used');
  return { quota, used: used ?? 0 };
}

export function suspendBucket(db: D1Database, id: string) {
  return db.prepare(`INSERT INTO bucket_health (bucket_id, retry_at) VALUES (?, ?)
    ON CONFLICT (bucket_id) DO UPDATE SET retry_at = MAX(retry_at, excluded.retry_at)`)
    .bind(id, now() + 120).run();
}
