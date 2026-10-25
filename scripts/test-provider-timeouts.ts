import assert from 'node:assert/strict';
import { sendEmail } from '../server/email';
import { sendWhatsAppAuthenticationCode } from '../server/whatsapp-cloud';

const originalFetch=globalThis.fetch, originalTimeout=AbortSignal.timeout;
const previous={...process.env};
process.env.RESEND_API_KEY='local-fixture';process.env.EMAIL_FROM='fixture@example.test';process.env.WHATSAPP_AUTH_ENABLED='true';process.env.WHATSAPP_PHONE_NUMBER_ID='123456789';process.env.WHATSAPP_ACCESS_TOKEN='local-fixture';
const controllers:AbortController[]=[], budgets:number[]=[];let requests=0;
AbortSignal.timeout=(milliseconds:number)=>{const controller=new AbortController();controllers.push(controller);budgets.push(milliseconds);return controller.signal;};
globalThis.fetch=async(_input,init)=>{requests++;assert(init?.signal);const signal=init.signal;return new Promise<Response>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
try{
 const email=assert.rejects(()=>sendEmail({to:'fixture@example.test',subject:'Synthetic',html:'Synthetic'}));
 assert.equal(requests,1);controllers[0].abort(new DOMException('Synthetic deadline','TimeoutError'));await email;
 const whatsapp=assert.rejects(()=>sendWhatsAppAuthenticationCode('+905551234567','123456'));
 assert.equal(requests,2);controllers[1].abort(new DOMException('Synthetic deadline','TimeoutError'));await whatsapp;
 assert.deepEqual(budgets,[8000,8000]);assert.equal(requests,2,'timeouts must not cause automatic resend');
 console.log('Provider deadlines PASS: both outbound transports bind an 8s AbortSignal, reject aborts and perform no automatic retry. Controlled aborts; no network or real messages.');
}finally{globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;for(const key of ['RESEND_API_KEY','EMAIL_FROM','WHATSAPP_AUTH_ENABLED','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_ACCESS_TOKEN']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
