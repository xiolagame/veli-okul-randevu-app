import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let stage = 'isolated setup';
async function run() {
  if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') throw new Error('Isolated environment required');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
  process.env.PLATFORM_ADMIN_USER_IDS = 'synthetic-platform';
  const auth = await import('../server/auth');
  const { createToken } = auth;
  const { createDatabaseRoleDiagnostic } = await import('../server/platform-database-diagnostic');
  const { createExpressApp } = await import('../server/app');
  const token = (userId = 'synthetic-platform', auth_method: Parameters<typeof createToken>[0]['auth_method'] = 'phone_centric_platform', version = 5, ttl = 60) =>
    createToken({ userId, phone: '+905551234567', auth_method, auth_version: version }, ttl);
  const sentinel = 'SYNTHETIC_SECRET_MUST_NOT_LEAK';
  let opens = 0, closes = 0, mode = '', storedVersion = 5;
  let gate:Promise<void>|undefined, started:()=>void=()=>{};
  const queries: Array<{ sql: string; values?: string[] }> = [];
  const probe = createDatabaseRoleDiagnostic(async () => {
    opens++;
    if(gate){started();await gate;}
    if (mode === 'connect-error') throw Object.assign(new Error(sentinel), { connectionString: sentinel, stack: sentinel });
    return {
      async query(sql, values) {
        queries.push({ sql, values });
        if (sql === 'SELECT id, auth_version FROM users WHERE id = $1') {
          if (mode === 'auth-error') throw new Error(sentinel);
          return { rows: mode === 'missing-user' ? [] : [{ id: mode === 'wrong-user' ? 'another-account' : 'synthetic-platform', auth_version: storedVersion, extra: sentinel }] };
        }
        assert.equal(sql, 'SELECT current_user, session_user;');
        assert.equal(values, undefined);
        if (mode === 'query-error') throw Object.assign(new Error(sentinel), { detail: sentinel, code: sentinel });
        return { rows: mode === 'empty-result' ? [] : [{ current_user: mode === 'invalid-result' ? { password: sentinel } : 'synthetic_backend', session_user: 'synthetic_login', connectionString: sentinel }] };
      },
      async close() { closes++; if (mode === 'close-error') throw new Error(sentinel); },
    };
  });
  const app = express();
  app.all('/probe', probe);
  const mockServer = http.createServer(app), actualServer = http.createServer(createExpressApp());
  await new Promise<void>(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  await new Promise<void>(resolve => actualServer.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (mockServer.address() as import('node:net').AddressInfo).port;
  const actual = 'http://127.0.0.1:' + (actualServer.address() as import('node:net').AddressInfo).port;
  const originalLogs = [console.log, console.warn, console.error];
  let logged = 0;
  console.log = console.warn = console.error = () => { logged++; };
  async function request(url = base+'/probe', jwt?: string, method = 'GET') {
    const response = await fetch(url, { method, headers: { ...(jwt ? { authorization: 'Bearer '+jwt } : {}), 'content-type':'application/json' }, ...(method === 'POST' ? { body:'malformed JSON '+sentinel } : {}) });
    const text = await response.text();
    assert(!text.includes(sentinel));
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    assert.match(response.headers.get('vary') || '', /Authorization/i);
    return { status:response.status, body:JSON.parse(text) };
  }
  try {
    stage = 'unauthorized requests never connect';
    for (const jwt of [undefined, 'invalid-token', token('synthetic-platform','phone_centric_platform',5,-1)]) assert.equal((await request(undefined,jwt)).status,401);
    for (const role of ['parent','teacher','security','school-admin']) assert.equal((await request(undefined,token('synthetic-'+role))).status,403);
    for (const weak of ['phone_centric','whatsapp_otp','whatsapp_admin'] as const) assert.equal((await request(undefined,token('synthetic-platform',weak))).status,403);
    assert.equal((await request(base+'/probe?token='+encodeURIComponent(token()))).status,401);
    assert.equal(opens,0); assert.equal(queries.length,0);
    stage = 'role allowlist and independent two-factor session';
    for (const method of ['phone_centric_platform','password'] as const) {
      const result = await request(base+'/probe?sql=DROP_TABLE&schoolId=foreign',token('synthetic-platform',method));
      assert.equal(result.status,200); assert.deepEqual(result.body,{current_user:'synthetic_backend',session_user:'synthetic_login'});
    }
    assert.equal(closes,2); assert.equal(queries.length,4);
    assert(queries.every(q=>q.sql==='SELECT current_user, session_user;' || (q.sql==='SELECT id, auth_version FROM users WHERE id = $1' && q.values?.[0]==='synthetic-platform')));
    stage = 'session invalidation and account removal';
    const roleQueriesBefore=queries.filter(q=>q.sql==='SELECT current_user, session_user;').length;
    storedVersion=6; assert.equal((await request(undefined,token())).status,401); storedVersion=5;
    for (const value of ['missing-user','wrong-user']) { mode=value; assert.equal((await request(undefined,token())).status,401); }
    assert.equal(queries.filter(q=>q.sql==='SELECT current_user, session_user;').length,roleQueriesBefore);
    mode=''; process.env.PLATFORM_ADMIN_USER_IDS=''; const before=opens;
    assert.equal((await request(undefined,token())).status,403); assert.equal(opens,before); process.env.PLATFORM_ADMIN_USER_IDS='synthetic-platform';
    stage = 'sanitized failures and cleanup';
    for (const value of ['connect-error','auth-error','query-error','empty-result','invalid-result']) {
      mode=value; const result=await request(undefined,token());
      assert.equal(result.status,503); assert.deepEqual(result.body,{code:'DATABASE_ROLE_CHECK_UNAVAILABLE'});
    }
    mode='close-error'; assert.equal((await request(undefined,token())).status,200); mode='';
    assert.equal(closes,opens-1,'every successfully opened connection must be closed, including all error paths');
    const openBeforePost=opens; assert.equal((await request(undefined,token(),'POST')).status,405); assert.equal(opens,openBeforePost);
    stage='concurrent diagnostics do not open extra connections';
    let release:()=>void=()=>{};
    const ready=new Promise<void>(resolve=>{started=resolve;});gate=new Promise<void>(resolve=>{release=resolve;});
    const pending=request(undefined,token());await ready;const held=opens;
    const busy=await request(undefined,token());assert.equal(busy.status,429);assert.deepEqual(busy.body,{code:'DATABASE_ROLE_CHECK_BUSY'});assert.equal(opens,held);
    release();assert.equal((await pending).status,200);gate=undefined;
    stage = 'real app mounts before bootstrap/parsers';
    for (const prefix of ['/api','/.netlify/functions/api']) {
      const url=actual+prefix+'/platform/diagnostics/database-role';
      assert.equal((await request(url)).status,401);
      assert.equal((await request(url,token('synthetic-parent'))).status,403);
      assert.equal((await request(url,token(),'POST')).status,405);
      assert.deepEqual((await request(url,token())).body,{code:'DATABASE_ROLE_CHECK_UNAVAILABLE'},'missing production credentials must not initialize a local DB');
    }
    stage = 'default pg client and TLS configuration without a real network';
    const fakeEnv={DATABASE_URL:'postgresql://synthetic:fixture@invalid.test/db?sslmode=disable',SUPABASE_DB_CA_B64:Buffer.from('-----BEGIN CERTIFICATE-----\nSYNTHETIC\n-----END CERTIFICATE-----').toString('base64')};
    const tlsExports:Record<string,any>={}, diagnosticExports:Record<string,any>={};
    const compile=(file:string)=>ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    vm.runInNewContext(compile('../server/database/tls.ts'),{exports:tlsExports,process:{env:fakeEnv},Buffer,URL});
    let clientOptions:any,ended=0,connectCalls=0;
    const driverQueries:string[]=[];
    class FakeClient {
      constructor(options:any){clientOptions=options;}
      on(){return this;}
      async connect(){connectCalls++;if(mode==='connect-error')throw new Error(sentinel);}
      async query(sql:string){driverQueries.push(sql);return {rows:sql.startsWith('SELECT id,')?[{id:'synthetic-platform',auth_version:5}]:[{current_user:'synthetic_backend',session_user:'synthetic_login'}]};}
      async end(){ended++;}
    }
    vm.runInNewContext(compile('../server/platform-database-diagnostic.ts'),{exports:diagnosticExports,process:{env:fakeEnv},require:(name:string)=>{
      if(name==='pg')return{Client:FakeClient};if(name==='./auth')return auth;if(name==='./database/tls')return tlsExports;throw new Error('Unexpected diagnostic import');
    }});
    const tlsHandler=diagnosticExports.createDatabaseRoleDiagnostic();
    app.all('/tls',(req,res,next)=>Promise.resolve(tlsHandler(req,res,next)));
    assert.equal((await request(base+'/tls',token())).status,200);
    assert.equal(clientOptions.ssl.rejectUnauthorized,true);assert.equal(clientOptions.ssl.ca,Buffer.from(fakeEnv.SUPABASE_DB_CA_B64,'base64').toString('utf8'));
    assert.equal(new URL(clientOptions.connectionString).searchParams.has('sslmode'),false);
    assert.equal(clientOptions.connectionTimeoutMillis,5000);assert.equal(clientOptions.query_timeout,5000);
    assert.deepEqual(driverQueries,['SELECT id, auth_version FROM users WHERE id = $1','SELECT current_user, session_user;']);assert.equal(ended,1);
    mode='connect-error';assert.equal((await request(base+'/tls',token())).status,503);assert.equal(ended,2,'failed connection must also close');mode='';
    fakeEnv.SUPABASE_DB_CA_B64=Buffer.from('INVALID CERTIFICATE').toString('base64');assert.equal((await request(base+'/tls',token())).status,503);assert.equal(connectCalls,2,'invalid CA must fail before connecting');
    assert.equal(logged,0,'no driver errors, tokens or secret-bearing objects may be logged');
  } finally {
    [console.log,console.warn,console.error]=originalLogs;
    await Promise.all([mockServer,actualServer].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));
  }
  console.log('Platform database diagnostic PASS: signed/current Platform sessions, weak-token/role/session denial, zero unauthorized DB connections, exact SELECT allowlist, TLS-preserving default path, sanitized failures, cleanup, no logs/secret leakage and both real API path mounts. Mock connection only; production role NOT VERIFIED.');
}
run().catch(()=>{console.error('Platform database diagnostic FAILED at '+stage+'. No credentials or response bodies logged.');process.exitCode=1;});
