import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try {
 await db.exec(`CREATE TABLE pending_staff(id text PRIMARY KEY,email varchar(150) NOT NULL);
   CREATE TABLE teacher_profiles(id text PRIMARY KEY,email varchar(150));
   INSERT INTO pending_staff VALUES('legacy-security','legacy@example.test');
   INSERT INTO teacher_profiles VALUES('legacy-teacher','notify@example.test');`);
 const sql=fs.readFileSync('server/database/migrations/20261031173726_staff_phone_activation.sql','utf8');
 await db.exec(sql);await db.exec(sql);
 await db.exec("INSERT INTO pending_staff VALUES('new-security',NULL)");
 assert.equal((await db.query<any>("SELECT email FROM pending_staff WHERE id='legacy-security'")).rows[0].email,'legacy@example.test');
 assert.equal((await db.query<any>("SELECT email FROM teacher_profiles WHERE id='legacy-teacher'")).rows[0].email,'notify@example.test');
 // A destructive rollback must fail rather than inventing emails for new security rows.
 await assert.rejects(db.exec('ALTER TABLE pending_staff ALTER COLUMN email SET NOT NULL'),/null values/);
 console.log('Staff migration PASS: old schema upgrade, idempotency, nullable security contact, legacy security/teacher emails and IDs retained, unsafe rollback blocked.');
}finally{await db.close();}
