import serverless from 'serverless-http';
import { withLambda } from '@netlify/aws-lambda-compat';
import { createExpressApp, ensureDatabase } from '../../server/app';

const app = createExpressApp();
const serverlessHandler = serverless(app);

export default withLambda(async (event, context) => {
  await ensureDatabase();
  return serverlessHandler(event, context) as any;
});
