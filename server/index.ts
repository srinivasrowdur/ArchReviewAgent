import 'dotenv/config';

import { createEnterpriseApp } from './app.js';

const port = Number(process.env.PORT ?? 8787);
const app = createEnterpriseApp();

app.listen(port, () => {
  console.log(`Enterprise guardrail server listening on http://localhost:${port}`);
});
