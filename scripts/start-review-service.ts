import {createReviewService} from '../server/review-service';
import {loadReviewSecretFiles} from '../server/review-settings';
async function start(){
 loadReviewSecretFiles();
 const app=await createReviewService();
 app.listen(Number(process.env.PORT||3100),process.env.REVIEW_BIND_HOST||'127.0.0.1',()=>console.info('Review service ready; no outbound credentials.'));
}
start().catch(()=>{console.error('Review service refused startup; check dedicated configuration.');process.exitCode=1;});
