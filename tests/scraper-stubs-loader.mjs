// Isolated test imports only: no Playwright installation, browser, or database.
export async function resolve(specifier, context, next) {
  if (specifier === 'playwright') return {url:'stub:playwright',shortCircuit:true};
  if (specifier === '@/lib/browser-manager') return {url:'stub:browser',shortCircuit:true};
  if (specifier === '@/storage/database/supabase-client') return {url:'stub:database',shortCircuit:true};
  if (['./collection-safety','./monitor-outbox'].includes(specifier)) return next(specifier+'.ts',context);
  return next(specifier,context);
}
export async function load(url, context, next) {
  const sources={
    'stub:playwright': 'export const BrowserContext = null, Cookie = null, ElementHandle = null, Page = null;',
    'stub:browser': 'export const BrowserRuntimeOptions=null; export async function acquireBrowserLease(){throw new Error("browser must not launch in tests");}',
    'stub:database': 'export function getSupabaseClient(){throw new Error("database must not connect in tests");} export const getMonitorBackendClient=getSupabaseClient;',
  };
  if(url in sources) return {format:'module',source:sources[url],shortCircuit:true};
  return next(url,context);
}
