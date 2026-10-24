import { TransactionClient } from './database/postgres';

export class PhoneIdentityAmbiguityError extends Error {
  constructor() {
    super('Canonical phone identity is ambiguous');
    this.name = 'PhoneIdentityAmbiguityError';
  }
}

export interface PhoneCollisionAuditResult {
  totalUsers: number;
  validCanonicalPhoneRows: number;
  collisionGroups: number;
  formatCollisionGroups: number;
  usersInCollisionGroups: number;
  largestCollisionGroup: number;
  invalidPhoneRows: number;
}

export async function auditCanonicalPhoneCollisions(client: TransactionClient): Promise<PhoneCollisionAuditResult> {
  const result = await client.query<{
    total_users: string | number;
    valid_canonical_phone_rows: string | number;
    collision_groups: string | number;
    format_collision_groups: string | number;
    users_in_collision_groups: string | number;
    largest_collision_group: string | number;
    invalid_phone_rows: string | number;
  }>(
    `WITH normalized AS (
       SELECT id,phone AS raw_phone,
         CASE
           WHEN regexp_replace(phone,'[^0-9]','','g') ~ '^905[0-9]{9}$'
             THEN '+' || regexp_replace(phone,'[^0-9]','','g')
           WHEN regexp_replace(phone,'[^0-9]','','g') ~ '^05[0-9]{9}$'
             THEN '+9' || regexp_replace(phone,'[^0-9]','','g')
           WHEN regexp_replace(phone,'[^0-9]','','g') ~ '^5[0-9]{9}$'
             THEN '+90' || regexp_replace(phone,'[^0-9]','','g')
           ELSE NULL
         END AS canonical_phone
       FROM users
     ), collisions AS (
       SELECT canonical_phone,COUNT(*)::integer AS user_count,
         COUNT(DISTINCT raw_phone)::integer AS raw_format_count
       FROM normalized WHERE canonical_phone IS NOT NULL
       GROUP BY canonical_phone HAVING COUNT(*) > 1
     )
     SELECT
       (SELECT COUNT(*) FROM normalized) AS total_users,
       (SELECT COUNT(*) FROM normalized WHERE canonical_phone IS NOT NULL) AS valid_canonical_phone_rows,
       (SELECT COUNT(*) FROM collisions) AS collision_groups,
       (SELECT COUNT(*) FROM collisions WHERE raw_format_count > 1) AS format_collision_groups,
       COALESCE((SELECT SUM(user_count) FROM collisions),0) AS users_in_collision_groups,
       COALESCE((SELECT MAX(user_count) FROM collisions),0) AS largest_collision_group,
       (SELECT COUNT(*) FROM normalized WHERE canonical_phone IS NULL) AS invalid_phone_rows`,
  );
  const row = result.rows[0];
  return {
    totalUsers: Number(row.total_users),
    validCanonicalPhoneRows: Number(row.valid_canonical_phone_rows),
    collisionGroups: Number(row.collision_groups),
    formatCollisionGroups: Number(row.format_collision_groups),
    usersInCollisionGroups: Number(row.users_in_collision_groups),
    largestCollisionGroup: Number(row.largest_collision_group),
    invalidPhoneRows: Number(row.invalid_phone_rows),
  };
}
