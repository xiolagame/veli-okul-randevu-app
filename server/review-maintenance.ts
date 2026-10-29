import type {TransactionClient} from './database/postgres';
import type {ReviewIdentity} from './review-access';
import {seedReviewFixtures} from './review-fixtures';
export async function resetReviewFixtures(tx:TransactionClient,identities:ReviewIdentity[]){
 const marker=await tx.query<{id:string}>('SELECT id FROM review_environment');
 if(marker.rows.length!==1||marker.rows[0].id!=='isolated-store-review')throw Error('Missing review-only marker');
 const schoolScope=await tx.query<{id:string}>('SELECT id FROM schools');
 const userScope=await tx.query<{id:string;auth_version:number}>('SELECT id,auth_version FROM users FOR UPDATE');
 const members=await tx.query<{user_id:string;school_id:string}>('SELECT user_id,school_id FROM school_memberships');
 const isolatedUser=(id:string)=>identities.some(i=>i.userId===id)||(members.rows.some(m=>m.user_id===id)&&members.rows.filter(m=>m.user_id===id).every(m=>['review-apple','review-google'].includes(m.school_id)));
 if(schoolScope.rows.some(x=>!['review-apple','review-google'].includes(x.id))||userScope.rows.some(x=>!isolatedUser(x.id)))throw Error('Non-review records: reset refused');
 await tx.query('DELETE FROM schools');await tx.query('DELETE FROM users');
 await seedReviewFixtures(tx,identities);
 for(const i of identities){const previous=userScope.rows.find(x=>x.id===i.userId)?.auth_version||0;await tx.query('UPDATE users SET auth_version=$1 WHERE id=$2',[previous+1,i.userId]);}
 // Keep deletion receipts/audit history. Old JWTs never revive after reseeding.
}
