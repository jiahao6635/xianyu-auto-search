import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('monitor_configs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ configs: data });
  } catch (error) {
    return NextResponse.json(
      { error: '获取配置失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('monitor_configs')
      .insert({
        search_keyword: body.search_keyword,
        price_min: body.price_min,
        price_max: body.price_max,
        time_range: body.time_range,
        sort_type: body.sort_type,
        cron_expression: body.cron_expression,
        webhook_url: body.webhook_url,
        cookies: body.cookies,
        is_active: body.is_active ?? true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ config: data });
  } catch (error) {
    return NextResponse.json(
      { error: '创建配置失败' },
      { status: 500 }
    );
  }
}
