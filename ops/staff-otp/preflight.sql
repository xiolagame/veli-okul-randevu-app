-- READ ONLY. Operator approval required before running against a live environment.
-- Counts only: never export phone numbers, emails, JWTs, OTPs or school/user data.
SELECT COUNT(*) AS invalid_teacher_notification_contacts FROM teacher_profiles
 WHERE account_deleted_at IS NULL AND COALESCE(email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
SELECT COUNT(*) AS invalid_teacher_phones FROM teacher_profiles
 WHERE account_deleted_at IS NULL AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g') !~ '^(90|0)?5[0-9]{9}$';
SELECT COUNT(*) AS invalid_pending_security_phones FROM pending_staff
 WHERE regexp_replace(phone,'[^0-9]','','g') !~ '^(90|0)?5[0-9]{9}$';
SELECT COUNT(*) AS ambiguous_person_phones FROM (
 SELECT right(regexp_replace(phone,'[^0-9]','','g'),10) FROM users
 GROUP BY right(regexp_replace(phone,'[^0-9]','','g'),10) HAVING COUNT(*)>1
) conflicts;
SELECT COUNT(*) AS teachers_in_multiple_schools FROM (
 SELECT right(regexp_replace(phone,'[^0-9]','','g'),10) FROM teacher_profiles WHERE account_deleted_at IS NULL
 GROUP BY right(regexp_replace(phone,'[^0-9]','','g'),10) HAVING COUNT(DISTINCT school_id)>1
) conflicts;
SELECT COUNT(*) AS preserved_legacy_security_contacts FROM pending_staff WHERE email IS NOT NULL;
SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
