import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
const root=process.cwd(),modules=path.join(root,'node_modules');
if(fs.lstatSync(modules).isSymbolicLink()||fs.realpathSync(modules).toLowerCase()!==modules.toLowerCase())throw Error('RELEASE_REQUIRES_REAL_NODE_MODULES_RUN_NPM_CI_IN_ISOLATED_COPY');
const require=createRequire(import.meta.url);
const cliPackage=require.resolve('netlify-cli/package.json',{paths:[path.join(process.env.APPDATA||'','npm/node_modules')]});
const cli=JSON.parse(fs.readFileSync(cliPackage,'utf8'));
if(cli.version!=='27.14.2')throw Error('NETLIFY_CLI_27_14_2_REQUIRED');
const zisiRoot=path.join(path.dirname(cliPackage),'node_modules/@netlify/zip-it-and-ship-it');
if(JSON.parse(fs.readFileSync(path.join(zisiRoot,'package.json'),'utf8')).version!=='16.5.1')throw Error('UNEXPECTED_FUNCTION_PACKAGER_VERSION');
const{zipFunctions}=await import(pathToFileURL(path.join(zisiRoot,'dist/main.js')).href);
fs.mkdirSync('release/functions',{recursive:true});
// Netlify V2 functions use NFT even when netlify.toml requests esbuild.
// Trace from real local node_modules, never through an external junction.
const results=await zipFunctions('netlify/functions','release/functions',{basePath:root,repositoryRoot:root,manifest:'release/functions/manifest.json',parallelLimit:1,config:{'*':{nodeBundler:'nft',nodeVersion:'24',nodeModuleFormat:'esm'}}});
const expected=['api','appointment-reminders','license-reminders','license-reminders-background'];
if(results.length!==expected.length||results.some(r=>!expected.includes(r.name)))throw Error('FUNCTION_SET_CHANGED');
if(results.some(r=>r.bundler!=='nft'))throw Error('INCORRECT_FUNCTION_BUNDLER');
// Let an immediately following Netlify CLI deploy reuse these tested archives,
// including V2 invocation modes and both schedules. Source fallback is also
// safe because this build refuses junction-based node_modules.
fs.mkdirSync('.netlify/functions',{recursive:true});fs.copyFileSync('release/functions/manifest.json','.netlify/functions/manifest.json');
const clientOut=path.resolve(root,'release/client');
if(clientOut!==path.join(root,'release','client')||!clientOut.startsWith(root+path.sep))throw Error('UNSAFE_ARTIFACT_PATH');
fs.rmSync(clientOut,{recursive:true,force:true});fs.cpSync('dist/client',clientOut,{recursive:true});
const artifacts=[];function inspect(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())inspect(file);else artifacts.push({path:path.relative(root,file).replaceAll('\\','/'),bytes:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}
inspect(clientOut);for(const result of results){const file=result.path;artifacts.push({path:path.relative(root,file).replaceAll('\\','/'),bytes:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}
fs.writeFileSync('release/artifact-manifest.json',JSON.stringify({node:process.version,netlifyCli:cli.version,packager:'16.5.1',artifacts},null,2));
console.log(JSON.stringify({functions:results.map(r=>({name:r.name,bundler:r.bundler,mode:r.invocationMode,schedule:r.schedule})),client:'release/client'}));
