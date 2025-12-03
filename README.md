# Elvison AI

React + Vite frontend with an Express backend (`mock-server.js`) that proxies the OpenAI workflow endpoints and Google Sheets MCP. The backend can also serve the built frontend for deployment.

## Quickstart
- Install deps: `npm install`
- Copy `.env.example` to `.env` and fill in your keys (OpenAI, Google, Sheet IDs, MCP).
- Local frontend: `npm run dev` (http://localhost:5173)
- Local backend/API: `node mock-server.js` (http://localhost:3001) – uses `.env`
- Local full build preview: `npm run build` then `npm start` to serve `dist` + API together.

## Railway deployment
- Set environment variables in the Railway service using `.env.example` as a guide (keep secrets out of git).
- Build command: `npm run build`
- Start command: `npm start` (uses `NODE_ENV=production` and serves `dist` if present)
- Expose port `3001` (default `PORT` is configurable via env).

## Notes
- The OpenAI Workflows API must be enabled for your project; otherwise workflow calls will return `Invalid URL`.
- The backend will warn if `dist` is missing when running in production mode. Build before starting in production.
