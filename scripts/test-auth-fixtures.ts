import crypto from 'crypto';
import { getDb } from '../server/database/postgres';

// Real request/verify endpoints, mock WhatsApp transport; never a runtime auth bypass.
export async function loginLocalStaffWithWhatsApp(phone: string, request: (path:string, body:object)=>Promise<any>) {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw Error('Local fixtures only');
  const keys=['WHATSAPP_AUTH_ENABLED','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_ACCESS_TOKEN'] as const;
  const old=keys.map(k=>process.env[k]),fetchBefore=globalThis.fetch;let code='';
  Object.assign(process.env,{WHATSAPP_AUTH_ENABLED:'true',WHATSAPP_PHONE_NUMBER_ID:'123456789',WHATSAPP_ACCESS_TOKEN:'local-fixture-only'});
  globalThis.fetch=async(input,init)=>{
    if(String(input).startsWith('https://graph.facebook.com/')){
      code=JSON.parse(String(init?.body)).template.components[0].parameters[0].text;
      return new Response('{"messages":[{"id":"local-test"}]}',{status:200});
    }
    return fetchBefore(input,init);
  };
  try {
    const start=await request('/auth/whatsapp/request-code',{purpose:'login',phone});
    if(start.status!==200||!/^\d{6}$/.test(code))throw Error('Local mock OTP request failed');
    return await request('/auth/whatsapp/verify-code',{phone,challengeId:start.body.challengeId,code});
  } finally { globalThis.fetch=fetchBefore;keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];}); }
}
import { hashPassword } from '../server/passwords';

const FIXTURE_PHONES = [
  '+905551234567',
  '+905559876543',
  '+905321112233',
  '+905559998877',
  '+905550001122',
];

export function createTestPassword(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export async function bootstrapLocalPasswordFixtures(
  db: Awaited<ReturnType<typeof getDb>>
): Promise<string> {
  if (db.engineType !== 'PostgreSQL (Embedded Persistent Engine)') {
    throw new Error('Test password fixtures may only be bootstrapped in local PGlite.');
  }

  const password = createTestPassword();

  for (const phone of FIXTURE_PHONES) {
    const result = await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE phone = $2 RETURNING id;',
      [hashPassword(password), phone]
    );

    if (result.rows.length !== 1) {
      throw new Error(`Test fixture user was not found for phone ${phone}.`);
    }
  }

  return password;
}
