import crypto from 'node:crypto';
import path from 'node:path';
const textExtensions=new Set(['.entitlements','.toml','.lock','.ts','.tsx','.js','.mjs','.json','.yaml','.yml','.css','.html','.sql','.swift','.plist','.xcprivacy','.storyboard','.xcscheme','.pbxproj','.xml','.sh','.md','.xcconfig']);
export const isTextSource=p=>textExtensions.has(path.extname(p).toLowerCase())||['.gitignore','.gitattributes','.gitconfig','.node-version'].includes(path.basename(p));
export function contentHash(file,bytes){return crypto.createHash('sha256').update(isTextSource(file)?bytes.toString('utf8').replaceAll('\r\n','\n'):bytes).digest('hex');}
export function forbiddenPackagePath(rel,extractedIpa=false){
  if(extractedIpa && rel==='embedded.mobileprovision')return false;
  return /(^|\/)(\.env(?:\..*)?|server|migrations|scripts|credentials?|service[-_]?account)(\/|$)|(^|\/)(?:credentials?|service[-_]?account)(?:[-_.][^/]*)?\.json$|\.(pem|key|p8|p12|mobileprovision|map)$/i.test(rel);
}
