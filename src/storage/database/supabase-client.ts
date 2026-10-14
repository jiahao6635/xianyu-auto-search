import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';

let envLoaded = false;

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

function loadEnv(): void {
  if (envLoaded) return;
  // Only explicit local configuration; do not retrieve cloud credentials implicitly.
  loadDotenv({ quiet: true });
  envLoaded = true;
}

function getSupabaseCredentials(): SupabaseCredentials {
  loadEnv();

  const url = process.env.COZE_SUPABASE_URL;
  const anonKey = process.env.COZE_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('COZE_SUPABASE_URL is not set');
  }
  if (!anonKey) {
    throw new Error('COZE_SUPABASE_ANON_KEY is not set');
  }

  return { url, anonKey };
}

function getSupabaseClient(token?: string): SupabaseClient {
  const { url, anonKey } = getSupabaseCredentials();

  if (token) {
    return createClient(url, anonKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
      db: {
        timeout: 60000,
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return createClient(url, anonKey, {
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getMonitorBackendClient(): SupabaseClient {
  loadEnv();
  const url = process.env.COZE_SUPABASE_URL;
  const key = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('监控持久队列需要用户配置服务端 COZE_SUPABASE_SERVICE_ROLE_KEY，并人工应用迁移；本轮不采集或发送');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export { loadEnv, getSupabaseCredentials, getSupabaseClient, getMonitorBackendClient };
