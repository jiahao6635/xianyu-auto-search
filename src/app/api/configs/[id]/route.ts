import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('monitor_configs')
      .update({
        search_keyword: body.search_keyword,
        price_min: body.price_min,
        price_max: body.price_max,
        region_province: body.region_province,
        region_city: body.region_city,
        region_district: body.region_district,
        time_range: body.time_range,
        sort_type: body.sort_type,
        cron_expression: body.cron_expression,
        webhook_url: body.webhook_url,
        cookies: body.cookies,
        is_active: body.is_active,
        browser_headless: body.browser_headless ?? false,
        browser_save_debug: body.browser_save_debug ?? true,
        browser_channel: body.browser_channel,
        browser_executable_path: body.browser_executable_path,
        browser_user_data_dir: body.browser_user_data_dir,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parseInt(id))
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ config: data });
  } catch (error) {
    return NextResponse.json(
      { error: '更新配置失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getSupabaseClient();

    const { error } = await client
      .from('monitor_configs')
      .delete()
      .eq('id', parseInt(id));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: '删除配置失败' },
      { status: 500 }
    );
  }
}
