// Vercel function: the whole Express app (server/index.ts), bundled by `npm run build` into
// dist-server/app.mjs. vercel.json sends every /api/* request here; Express sees the original path.
import app from '../dist-server/app.mjs';

export default app;
