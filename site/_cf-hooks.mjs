import { pathToFileURL } from 'node:url';

export async function resolve(specifier, _context, nextResolve) {
  if (specifier.startsWith('cloudflare:')) {
    return { url: pathToFileURL('C:/Worldfront.News/site/_cf-shims.mjs').href, shortCircuit: true };
  }
  return nextResolve(specifier, _context);
}