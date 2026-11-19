import serverless from 'serverless-http';
import { withLambda } from '@netlify/aws-lambda-compat';
import { createExpressApp } from '../../server/app';

const app = createExpressApp();
const serverlessHandler = serverless(app);

export default withLambda(async (event, context) => {
  // Express owns initialization and returns a sanitized 503 on connection failure.
  return serverlessHandler(event, context) as any;
});
