import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
assert.equal(JSON.parse(fs.readFileSync('node_modules/body-parser/package.json')).version,'2.4.0');
const code=String.raw`
import express from 'express';import {gzipSync} from 'node:zlib';import http from 'node:http';import assert from 'node:assert/strict';
const app=express();app.use(express.json({limit:'1mb'}));app.get('/health',(_req,res)=>res.json({ok:true}));app.post('/parse',(_req,res)=>res.json({ok:true}));app.use((err,req,res,next)=>res.status(400).json({code:'INVALID_BODY'}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
try{for(const bad of [false,true]){const compressed=gzipSync(Buffer.from(JSON.stringify({synthetic:true})));const body=bad?Buffer.concat([compressed,Buffer.from('invalid-trailing-data')]):compressed;const status=await new Promise((resolve,reject)=>{const req=http.request(url+'/parse',{method:'POST',headers:{'Content-Type':'application/json','Content-Encoding':'gzip','Content-Length':body.length}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(body);});assert([200,400].includes(status));const health=await fetch(url+'/health');assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true});}}finally{await new Promise(r=>server.close(r));}
`;
const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr||result.error?.message);console.log('HTTP parser safety PASS: valid and malformed compressed bodies do not terminate the isolated server; subsequent health remains 200. No production requests.');
