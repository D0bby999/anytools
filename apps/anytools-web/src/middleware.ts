import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Skip: API routes, Next internals, files with extensions (favicon, sitemap.xml, robots.txt, manifest.json, icons, og-image.png)
  matcher: [
    '/((?!api|_next|_vercel|.*\\..*|sitemap.xml|robots.txt|manifest.json|opengraph-image).*)',
  ],
};
