import { Router } from 'express';
import { AuthenticatedRequest } from './auth';
import { getDb } from './database/postgres';
import { operationCategories, OperationCategory, OperationItem } from '../src/types/operations';

// Display/lookup normalization only; this does not change identity or authorization.
export function canonicalOperationPhoneSql(expression: string) {
  const clean = `regexp_replace(COALESCE(${expression},''),'[[:space:]()-]','','g')`;
  return `(CASE WHEN ${clean} ~ '^(\\+?90|0)?5[0-9]{9}$' THEN '+90'||right(${clean},10) END)`;
}
const canonical = canonicalOperationPhoneSql;
const ctes = `WITH staff_source AS (
 SELECT tp.id,'teacher' AS role,tp.first_name,tp.last_name,tp.phone,tp.email,tp.branch,
 CASE WHEN tp.user_id IS NULL OR (u.is_phone_verified IS NOT TRUE AND NULLIF(u.password_hash,'') IS NULL) THEN 'pending'
 WHEN EXISTS(SELECT 1 FROM school_memberships sm WHERE sm.school_id=$1 AND sm.user_id=tp.user_id AND sm.role='teacher' AND sm.status='active') THEN 'active' ELSE 'inactive' END AS status
 FROM teacher_profiles tp LEFT JOIN users u ON u.id=tp.user_id WHERE tp.school_id=$1 AND tp.account_deleted_at IS NULL
 UNION ALL SELECT u.id,'security',u.first_name,u.last_name,u.phone,u.email,'' AS branch,
 CASE WHEN u.is_phone_verified=TRUE OR NULLIF(u.password_hash,'') IS NOT NULL THEN 'active' ELSE 'pending' END
 FROM users u WHERE EXISTS(SELECT 1 FROM school_memberships sm WHERE sm.school_id=$1 AND sm.user_id=u.id AND sm.role='security' AND sm.status='active')
 UNION ALL SELECT ps.id,'security',ps.first_name,ps.last_name,ps.phone,ps.email,'','pending' FROM pending_staff ps WHERE ps.school_id=$1 AND ps.role='security'
), staff AS (
 SELECT *,jsonb_build_object('id',id,'kind','staff','name',concat_ws(' ',first_name,last_name),'phone',phone,'email',COALESCE(email,''),'branch',COALESCE(branch,''),'role',role,'status',status,'editKind',role,
 'values',jsonb_build_object('fullName',concat_ws(' ',first_name,last_name),'phone',phone,'email',COALESCE(email,'')) || CASE WHEN role='teacher' THEN jsonb_build_object('branch',COALESCE(branch,'')) ELSE '{}'::jsonb END,
 'activationCreatedAt',(SELECT i.created_at FROM invitations i WHERE i.school_id=$1 AND i.purpose='staff_activation' AND i.target_role=staff_source.role
   AND ${canonical('i.target_phone')}=${canonical('staff_source.phone')} AND i.revoked_at IS NULL AND i.consumed_at IS NULL AND i.is_active=TRUE AND i.expires_at>NOW() ORDER BY i.created_at DESC LIMIT 1)) AS payload
 FROM staff_source WHERE status<>'inactive'
), roster AS (
 SELECT sr.*,${canonical('sr.parent_phone')} AS canonical_phone,
 EXISTS(SELECT 1 FROM users u WHERE ${canonical('u.phone')}=${canonical('sr.parent_phone')}) AS has_account,
 EXISTS(SELECT 1 FROM students s JOIN student_parent_relations rel ON rel.school_id=s.school_id AND rel.student_id=s.id JOIN users u ON u.id=rel.parent_user_id
 WHERE s.school_id=$1 AND s.name=sr.student_name AND s.class_name=sr.class_name AND s.student_number IS NOT DISTINCT FROM sr.student_number AND ${canonical('u.phone')}=${canonical('sr.parent_phone')}) AS has_relation
 FROM school_roster sr WHERE sr.school_id=$1 AND sr.parent_account_deleted_at IS NULL
), pending_children AS (
 SELECT min(id) AS id,canonical_phone,min(parent_name) AS parent_name,student_name,class_name,COALESCE(student_number,'') AS student_number,(array_agg(birth_date::text ORDER BY id))[1] AS birth_date
 FROM roster WHERE canonical_phone IS NOT NULL AND NOT has_account AND is_claimed=FALSE
 GROUP BY canonical_phone,student_name,class_name,COALESCE(student_number,'')
), pending_parents AS (
 SELECT min(id) AS id,canonical_phone,jsonb_build_object('id',min(id),'kind','parent','name',min(parent_name),'phone',canonical_phone,'status','pending',
 'students',jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',id,'name',student_name,'className',class_name,'studentNumber',COALESCE(student_number,''),'birthDate',birth_date)) ORDER BY class_name,student_name,id)) AS payload
 FROM pending_children GROUP BY canonical_phone
), problems AS (
 SELECT 'student:'||s.id AS id,jsonb_build_object('id',s.id,'kind','missing','name',s.name,'editKind','student',
 'values',jsonb_strip_nulls(jsonb_build_object('name',s.name,'className',s.class_name,'studentNumber',COALESCE(s.student_number,''),'birthDate',s.birth_date::text)),
 'issues',array_remove(ARRAY[CASE WHEN trim(s.name)='' THEN 'Öğrenci adı eksik' END,CASE WHEN trim(s.class_name)='' THEN 'Sınıf eksik' END,
 CASE WHEN NOT EXISTS(SELECT 1 FROM student_parent_relations rel WHERE rel.school_id=$1 AND rel.student_id=s.id) THEN 'Veli bağlantısı yok' END],NULL)) AS payload
 FROM students s WHERE s.school_id=$1 AND (trim(s.name)='' OR trim(s.class_name)='' OR NOT EXISTS(SELECT 1 FROM student_parent_relations rel WHERE rel.school_id=$1 AND rel.student_id=s.id))
 UNION ALL SELECT 'roster:'||r.id,jsonb_build_object('id',r.id,'kind','missing','name',r.student_name,'phone',r.parent_phone,'editKind','roster',
 'values',jsonb_strip_nulls(jsonb_build_object('studentName',r.student_name,'className',r.class_name,'studentNumber',COALESCE(r.student_number,''),'parentName',r.parent_name,'parentPhone',r.parent_phone,'birthDate',r.birth_date::text)),
 'issues',array_remove(ARRAY[CASE WHEN trim(r.student_name)='' THEN 'Öğrenci adı eksik' END,CASE WHEN trim(r.class_name)='' THEN 'Sınıf eksik' END,
 CASE WHEN trim(r.parent_name)='' THEN 'Veli adı eksik' END,CASE WHEN r.canonical_phone IS NULL THEN 'Telefon eksik veya geçersiz' END,
 CASE WHEN r.has_account AND NOT r.is_claimed AND NOT r.has_relation THEN 'Mevcut hesapla öğrenci bağlantısı tamamlanmamış' END],NULL))
 FROM roster r WHERE trim(r.student_name)='' OR trim(r.class_name)='' OR trim(r.parent_name)='' OR r.canonical_phone IS NULL OR (r.has_account AND NOT r.is_claimed AND NOT r.has_relation)
 UNION ALL SELECT role||':'||id,payload||jsonb_build_object('kind','missing','issues',array_remove(ARRAY[
 CASE WHEN trim(first_name)='' OR trim(last_name)='' THEN 'Ad veya soyad eksik' END,
 CASE WHEN ${canonical('phone')} IS NULL THEN 'Telefon eksik veya geçersiz' END,
 CASE WHEN role='teacher' AND trim(COALESCE(branch,''))='' THEN 'Branş eksik' END,
 CASE WHEN status='pending' AND COALESCE(email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN 'Aktivasyon e-postası eksik veya geçersiz' END],NULL))
 FROM staff WHERE trim(first_name)='' OR trim(last_name)='' OR ${canonical('phone')} IS NULL OR (role='teacher' AND trim(COALESCE(branch,''))='')
 OR (status='pending' AND COALESCE(email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
), meetings AS NOT MATERIALIZED (
 SELECT a.id,a.date,a.start_time,CASE WHEN a.status='completed' THEN 'checked_out' ELSE a.status END AS status,
 jsonb_build_object('id',a.id,'kind','appointment','name',a.student_name,'appointment',jsonb_build_object('id',a.id,'studentName',a.student_name,'parentName',a.parent_name,'teacherName',a.teacher_name,'className',a.class_name,'date',a.date,'startTime',a.start_time,'endTime',a.end_time,'status',CASE WHEN a.status='completed' THEN 'checked_out' ELSE a.status END,'notes',COALESCE(a.notes,''))) AS payload
 FROM appointments a WHERE a.school_id=$1
), operation_rows AS (
 SELECT 'pending-parents' AS category,id,payload,payload->>'name' AS sort_key FROM pending_parents
 UNION ALL SELECT 'pending-staff',role||':'||id,payload,payload->>'name' FROM staff WHERE status='pending'
 UNION ALL SELECT 'teachers',id,payload,payload->>'name' FROM staff WHERE role='teacher'
 UNION ALL SELECT 'missing',id,payload,payload->>'name' FROM problems
 UNION ALL SELECT 'pending-appointments',id,payload,date||' '||start_time FROM meetings WHERE status='pending'
 UNION ALL SELECT 'appointments',id,payload,date||' '||start_time FROM meetings
 UNION ALL SELECT 'today',id,payload,date||' '||start_time FROM meetings WHERE date=to_char(NOW() AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD')
)`;
export const operationsRouter = Router({ mergeParams: true });
operationsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await (await getDb()).query<{ category: string; total: number }>(ctes + ` SELECT category,COUNT(*)::integer AS total FROM operation_rows GROUP BY category
      UNION ALL SELECT 'status:'||status,COUNT(*)::integer FROM meetings GROUP BY status`, [req.membership!.schoolId]);
    const counts = Object.fromEntries(operationCategories.map((category) => [category, 0])) as Record<OperationCategory, number>;
    const statuses: Record<string, number> = {};
    for (const row of result.rows) {
      if (row.category.startsWith('status:')) statuses[row.category.slice(7)] = Number(row.total);
      else if (operationCategories.includes(row.category as OperationCategory)) counts[row.category as OperationCategory] = Number(row.total);
    }
    res.json({ counts, statuses });
  } catch { res.status(500).json({ error: 'Operasyon özeti alınamadı.' }); }
});
operationsRouter.get('/:category', async (req: AuthenticatedRequest, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const category = String(req.params.category);
  const page = Number(req.query.page ?? 0), q = String(req.query.q || '').trim();
  const status = String(req.query.status || '');
  if (!operationCategories.includes(category as OperationCategory) || !Number.isSafeInteger(page) || page < 0 || page > 100000 || q.length > 100 ||
      (status && !['pending', 'booked', 'checked_in', 'checked_out', 'cancelled', 'rejected'].includes(status))) return res.status(400).json({ error: 'Filtreleri kontrol edin.' });
  try {
    // Count and page are evaluated in one statement/snapshot.
    const result = await (await getDb()).query<{ total: number; items: OperationItem[] }>(ctes + `, filtered AS (
      SELECT * FROM operation_rows WHERE category=$2 AND ($3='' OR strpos(lower(payload::text),lower($3))>0)
        AND ($4='' OR payload->'appointment'->>'status'=$4)
    ), page_rows AS (SELECT * FROM filtered ORDER BY sort_key,id LIMIT 25 OFFSET $5)
    SELECT (SELECT COUNT(*)::integer FROM filtered) AS total,COALESCE((SELECT jsonb_agg(payload ORDER BY sort_key,id) FROM page_rows),'[]'::jsonb) AS items`,
      [req.membership!.schoolId, category, q, status, page * 25]);
    res.json({ ...result.rows[0], page, pageSize: 25 });
  } catch { res.status(500).json({ error: 'Operasyon kayıtları alınamadı.' }); }
});
