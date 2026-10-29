import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
// Installed only in the isolated review process, before application/provider imports.
// PostgreSQL TCP remains available. Container networking additionally denies all Internet egress.
export function installReviewOutboundDeny(){
 const deny=()=>{throw Error('Review environment: external delivery/network request blocked');};
 globalThis.fetch=(async()=>deny()) as typeof fetch;
 http.request=deny as typeof http.request;http.get=deny as typeof http.get;
 https.request=deny as typeof https.request;https.get=deny as typeof https.get;
 syncBuiltinESMExports();
}
