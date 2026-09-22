import serverless from 'serverless-http';
import type { Handler } from '@netlify/functions';
import { createExpressApp, ensureDatabase } from '../../server/app';

const app = createExpressApp();
const serverlessHandler = serverless(app);

export const handler: Handler = async (event, context) => {
  await ensureDatabase();
  return serverlessHandler(event, context) as any;
};
