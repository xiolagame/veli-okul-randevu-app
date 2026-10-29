import crypto from 'node:crypto';
import path from 'node:path';
const textExtensions=new Set(['.entitlements','.toml','.lock','.ts','.tsx','.js','.mjs','.json','.yaml','.yml','.css','.html','.sql','.swift','.plist','.xcprivacy','.storyboard','.xcscheme','.pbxproj','.xml','.sh','.md','.xcconfig']);
const additionalTextExtensions=new Set(['.gradle','.properties','.java','.pro','.bat','.hash']);
const textNames=new Set(['.gitignore','.gitattributes','.gitconfig','.node-version','gradlew','webhook-crons','.bootstrap-complete','.restore-complete','.gitkeep']);
export const isTextSource=p=>textExtensions.has(path.extname(p).toLowerCase())||additionalTextExtensions.has(path.extname(p).toLowerCase())||textNames.has(path.basename(p));
export function contentHash(file,bytes){
  let canonical=bytes;
  if(isTextSource(file)){
    const text=bytes.toString('utf8');
    if(!Buffer.from(text,'utf8').equals(bytes))throw new Error('Invalid UTF-8 source: '+file);
    canonical=text.replaceAll('\r\n','\n');
  }
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
export function forbiddenPackagePath(rel,extractedIpa=false){
  if(extractedIpa && rel==='embedded.mobileprovision')return false;
  return /(^|\/)(\.env(?:\..*)?|server|migrations|scripts|credentials?|service[-_]?account)(\/|$)|(^|\/)(?:credentials?|service[-_]?account)(?:[-_.][^/]*)?\.json$|\.(pem|key|p8|p12|mobileprovision|map)$/i.test(rel);
}
