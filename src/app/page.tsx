'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowUpDown,
  Bell,
  Bug,
  Clock,
  Cookie,
  DollarSign,
  Edit,
  Eye,
  Play,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

interface MonitorConfig {
  id: number;
  search_keyword: string;
  price_min: number | null;
  price_max: number | null;
  time_range: string | null;
  sort_type: string | null;
  cron_expression: string;
  webhook_url: string | null;
  cookies: string | null;
  is_active: boolean;
  browser_headless: boolean | null;
  browser_save_debug: boolean | null;
  browser_channel: string | null;
  browser_executable_path: string | null;
  browser_user_data_dir: string | null;
  created_at: string;
  updated_at: string | null;
}

interface FormDataState {
  search_keyword: string;
  price_min: string;
  price_max: string;
  time_range: string;
  sort_type: string;
  cron_expression: string;
  webhook_url: string;
  cookies: string;
  is_active: boolean;
  browser_headless: boolean;
  browser_save_debug: boolean;
  browser_channel: string;
  browser_executable_path: string;
  browser_user_data_dir: string;
}

const defaultFormData: FormDataState = {
  search_keyword: '摩托车',
  price_min: '20000',
  price_max: '',
  time_range: '1hour',
  sort_type: 'newest',
  cron_expression: '0 */30 * * * *',
  webhook_url: '',
  cookies: '',
  is_active: true,
  browser_headless: false,
  browser_save_debug: true,
  browser_channel: 'system',
  browser_executable_path: '',
  browser_user_data_dir: '',
};

export default function Home() {
  const [configs, setConfigs] = useState<MonitorConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingConfig, setEditingConfig] = useState<MonitorConfig | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [formData, setFormData] = useState<FormDataState>(defaultFormData);

  const loadConfigs = async () => {
    try {
      const response = await fetch('/api/configs');
      const data = await response.json();
      setConfigs(data.configs || []);
    } catch {
      toast.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = useCallback(async () => {
    try {
      setLogsLoading(true);
      const response = await fetch('/api/logs?lines=150');
      const data = await response.json();
      setLogs(data.logs || []);
    } catch (error) {
      console.error('加载日志失败:', error);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfigs();
  }, []);

  useEffect(() => {
    if (!showLogs || !autoRefresh) {
      return;
    }

    loadLogs();
    const timer = setInterval(loadLogs, 3000);
    return () => clearInterval(timer);
  }, [showLogs, autoRefresh, loadLogs]);

  useEffect(() => {
    if (showLogs) {
      loadLogs();
    }
  }, [showLogs, loadLogs]);

  const updateForm = <K extends keyof FormDataState>(key: K, value: FormDataState[K]) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setFormData(defaultFormData);
  };

  const openCreateForm = () => {
    setEditingConfig(null);
    resetForm();
    setShowForm(true);
  };

  const handleEdit = (config: MonitorConfig) => {
    setEditingConfig(config);
    setFormData({
      search_keyword: config.search_keyword,
      price_min: config.price_min?.toString() || '',
      price_max: config.price_max?.toString() || '',
      time_range: config.time_range || '1hour',
      sort_type: config.sort_type || 'newest',
      cron_expression: config.cron_expression,
      webhook_url: config.webhook_url || '',
      cookies: config.cookies || '',
      is_active: config.is_active,
      browser_headless: config.browser_headless ?? false,
      browser_save_debug: config.browser_save_debug ?? true,
      browser_channel: config.browser_channel || 'system',
      browser_executable_path: config.browser_executable_path || '',
      browser_user_data_dir: config.browser_user_data_dir || '',
    });
    setShowForm(true);
  };

  const buildPayload = () => ({
    search_keyword: formData.search_keyword,
    price_min: formData.price_min ? parseInt(formData.price_min, 10) : null,
    price_max: formData.price_max ? parseInt(formData.price_max, 10) : null,
    time_range: formData.time_range || null,
    sort_type: formData.sort_type || null,
    cron_expression: formData.cron_expression,
    webhook_url: formData.webhook_url || null,
    cookies: formData.cookies || null,
    is_active: formData.is_active,
    browser_headless: formData.browser_headless,
    browser_save_debug: formData.browser_save_debug,
    browser_channel: formData.browser_channel === 'system' ? null : formData.browser_channel,
    browser_executable_path: formData.browser_executable_path || null,
    browser_user_data_dir: formData.browser_user_data_dir || null,
  });

  const handleSave = async () => {
    try {
      const url = editingConfig ? `/api/configs/${editingConfig.id}` : '/api/configs';
      const method = editingConfig ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });

      if (!response.ok) {
        const error = await response.json();
        toast.error(error.message || error.error || '保存失败');
        return;
      }

      toast.success(editingConfig ? '配置已更新' : '配置已创建');
      setShowForm(false);
      setEditingConfig(null);
      resetForm();
      loadConfigs();
    } catch {
      toast.error('保存失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这条监控配置吗？')) {
      return;
    }

    try {
      const response = await fetch(`/api/configs/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        toast.error('删除失败');
        return;
      }
      toast.success('配置已删除');
      loadConfigs();
    } catch {
      toast.error('删除失败');
    }
  };

  const handleTrigger = async (id: number) => {
    try {
      toast.info('开始扫描...');
      const response = await fetch(`/api/trigger/${id}`, { method: 'POST' });
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || '扫描失败');
        if (data.hint) {
          toast.info(data.hint, { duration: 10000 });
        }
        return;
      }

      if (data.warning) {
        toast.warning(data.warning.split('\n')[0]);
      } else if (data.newProducts > 0) {
        toast.success(`扫描完成，发现 ${data.newProducts} 个新商品`);
      } else {
        toast.info('扫描完成，未发现新商品');
      }

      if (showLogs) {
        setTimeout(loadLogs, 1000);
      }
    } catch {
      toast.error('触发扫描失败');
    }
  };

  const getTimeRangeLabel = (range: string | null) => {
    const labels: Record<string, string> = {
      '1hour': '1 小时内',
      '24hours': '24 小时内',
      '7days': '7 天内',
    };
    return labels[range || ''] || '不限';
  };

  const getSortTypeLabel = (sort: string | null) => {
    const labels: Record<string, string> = {
      'newest': '最新上架',
      'price_asc': '价格从低到高',
      'price_desc': '价格从高到低',
    };
    return labels[sort || ''] || '默认排序';
  };

  const getCronDescription = (cron: string) => {
    if (cron === '0 */5 * * * *') return '每 5 分钟';
    if (cron === '0 */10 * * * *') return '每 10 分钟';
    if (cron === '0 */15 * * * *') return '每 15 分钟';
    if (cron === '0 */30 * * * *') return '每 30 分钟';
    if (cron === '0 * * * * *') return '每小时';
    if (cron === '0 */2 * * * *') return '每 2 小时';
    if (cron === '0 */6 * * * *') return '每 6 小时';
    if (cron === '0 0 * * * *') return '每天整点';
    return cron;
  };

  const getBrowserModeLabel = (config: MonitorConfig) => {
    const mode = config.browser_headless ? '无头' : '可视';
    const channel = config.browser_channel || '系统默认';
    return `${mode} / ${channel}`;
  };

  const highlightLog = (log: string) => {
    if (log.includes('ERROR') || log.includes('error') || log.includes('失败')) {
      return 'text-red-400';
    }
    if (log.includes('WARN') || log.includes('警告')) {
      return 'text-yellow-400';
    }
    if (log.includes('成功') || log.includes('完成')) {
      return 'text-green-400';
    }
    if (log.includes('扫描') || log.includes('监控')) {
      return 'text-blue-300';
    }
    return 'text-slate-300';
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="text-lg text-slate-600">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">闲鱼商品监控</h1>
            <p className="mt-2 text-slate-600">定时扫描闲鱼搜索结果，发现新商品后记录并通知。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowLogs(true)} className="gap-2">
              <Terminal className="h-4 w-4" />
              查看日志
            </Button>
            <Button onClick={openCreateForm} className="gap-2">
              <Plus className="h-4 w-4" />
              新建监控
            </Button>
          </div>
        </div>

        <Card className="mb-6 border-amber-200 bg-amber-50/80">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 text-amber-700" />
              <div className="text-sm text-amber-900">
                <p className="font-medium">浏览器行为说明</p>
                <p className="mt-1">
                  现在每条监控都可以在配置页里单独设置浏览器模式。你可以切换无头/可视模式、选择
                  `chrome` 或 `msedge`、指定本机浏览器路径，或复用本地用户目录来继承登录态。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {configs.length === 0 ? (
          <Card className="py-12 text-center">
            <CardContent>
              <Search className="mx-auto mb-4 h-16 w-16 text-slate-300" />
              <h3 className="mb-2 text-lg font-semibold text-slate-700">还没有监控配置</h3>
              <p className="mb-4 text-slate-500">先创建一条配置，测试搜索结果和浏览器调试选项。</p>
              <Button onClick={openCreateForm}>
                <Plus className="mr-2 h-4 w-4" />
                创建监控
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {configs.map(config => (
              <Card key={config.id} className={!config.is_active ? 'opacity-60' : ''}>
                <CardHeader>
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-xl">
                        <Search className="h-5 w-5" />
                        {config.search_keyword}
                        <Badge variant={config.is_active ? 'default' : 'secondary'}>
                          {config.is_active ? '运行中' : '已暂停'}
                        </Badge>
                      </CardTitle>
                      <CardDescription className="mt-3 flex flex-wrap gap-3 text-sm">
                        {config.price_min && (
                          <span className="flex items-center gap-1">
                            <DollarSign className="h-4 w-4" />
                            {config.price_min}
                            {config.price_max ? ` - ${config.price_max}` : ''} 元
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {getTimeRangeLabel(config.time_range)}
                        </span>
                        <span className="flex items-center gap-1">
                          <ArrowUpDown className="h-4 w-4" />
                          {getSortTypeLabel(config.sort_type)}
                        </span>
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTrigger(config.id)}
                        disabled={!config.is_active}
                      >
                        <Play className="mr-1 h-4 w-4" />
                        立即扫描
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleEdit(config)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleDelete(config.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-3 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="flex items-center gap-1">
                        <Bell className="h-4 w-4" />
                        {config.webhook_url ? '已配置通知' : '未配置通知'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Cookie className="h-4 w-4" />
                        {config.cookies ? '已配置 Cookie' : '未配置 Cookie'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="h-4 w-4" />
                        {getBrowserModeLabel(config)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Bug className="h-4 w-4" />
                        {config.browser_save_debug ?? true ? '保存调试文件' : '不保存调试文件'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {getCronDescription(config.cron_expression)}
                      </span>
                    </div>
                    <span>创建于 {new Date(config.created_at).toLocaleString('zh-CN')}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="max-h-[92vh] w-full max-w-3xl overflow-y-auto">
              <CardHeader>
                <CardTitle>{editingConfig ? '编辑监控配置' : '新建监控配置'}</CardTitle>
                <CardDescription>搜索条件、Cookie、通知和浏览器行为都可以在这里集中配置。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="keyword">搜索关键词</Label>
                  <Input
                    id="keyword"
                    value={formData.search_keyword}
                    onChange={e => updateForm('search_keyword', e.target.value)}
                    placeholder="例如：摩托车"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="priceMin">最低价格（元）</Label>
                    <Input
                      id="priceMin"
                      type="number"
                      value={formData.price_min}
                      onChange={e => updateForm('price_min', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="priceMax">最高价格（元）</Label>
                    <Input
                      id="priceMax"
                      type="number"
                      value={formData.price_max}
                      onChange={e => updateForm('price_max', e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>发布时间范围</Label>
                    <Select value={formData.time_range} onValueChange={value => updateForm('time_range', value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1hour">1 小时内</SelectItem>
                        <SelectItem value="24hours">24 小时内</SelectItem>
                        <SelectItem value="7days">7 天内</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>排序方式</Label>
                    <Select value={formData.sort_type} onValueChange={value => updateForm('sort_type', value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="newest">最新上架</SelectItem>
                        <SelectItem value="price_asc">价格从低到高</SelectItem>
                        <SelectItem value="price_desc">价格从高到低</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>扫描频率</Label>
                  <Select
                    value={formData.cron_expression}
                    onValueChange={value => updateForm('cron_expression', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0 */5 * * * *">每 5 分钟</SelectItem>
                      <SelectItem value="0 */10 * * * *">每 10 分钟</SelectItem>
                      <SelectItem value="0 */15 * * * *">每 15 分钟</SelectItem>
                      <SelectItem value="0 */30 * * * *">每 30 分钟</SelectItem>
                      <SelectItem value="0 * * * * *">每小时</SelectItem>
                      <SelectItem value="0 */2 * * * *">每 2 小时</SelectItem>
                      <SelectItem value="0 */6 * * * *">每 6 小时</SelectItem>
                      <SelectItem value="0 0 * * * *">每天整点</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">当前：{getCronDescription(formData.cron_expression)}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cookies" className="flex items-center gap-2">
                    <Cookie className="h-4 w-4" />
                    闲鱼 Cookie
                  </Label>
                  <Textarea
                    id="cookies"
                    value={formData.cookies}
                    onChange={e => updateForm('cookies', e.target.value)}
                    rows={4}
                    className="font-mono text-xs"
                    placeholder="粘贴从浏览器复制的 Cookie 字符串或 JSON 导出内容"
                  />
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    建议先在本地浏览器中确认已登录 goofish.com，再复制 Cookie。
                    如果你准备复用本机用户目录，也可以只填少量 Cookie 作为补充。
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="webhook">Webhook 通知地址</Label>
                  <Input
                    id="webhook"
                    value={formData.webhook_url}
                    onChange={e => updateForm('webhook_url', e.target.value)}
                    placeholder="https://example.com/webhook"
                  />
                </div>

                <Card className="border-slate-200 bg-slate-50/80">
                  <CardHeader>
                    <CardTitle className="text-base">浏览器调试配置</CardTitle>
                    <CardDescription>
                      这些选项会覆盖默认 `.env` 配置，按当前监控单独生效。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>浏览器通道</Label>
                        <Select
                          value={formData.browser_channel}
                          onValueChange={value => updateForm('browser_channel', value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="system">系统默认</SelectItem>
                            <SelectItem value="chrome">Chrome</SelectItem>
                            <SelectItem value="msedge">Edge</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="browserExec">浏览器可执行文件</Label>
                        <Input
                          id="browserExec"
                          value={formData.browser_executable_path}
                          onChange={e => updateForm('browser_executable_path', e.target.value)}
                          placeholder="可选，例如 C:\Program Files\Google\Chrome\Application\chrome.exe"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="userDataDir">用户目录</Label>
                      <Input
                        id="userDataDir"
                        value={formData.browser_user_data_dir}
                        onChange={e => updateForm('browser_user_data_dir', e.target.value)}
                        placeholder="可选，例如 C:\Users\你的用户名\AppData\Local\Microsoft\Edge\User Data"
                      />
                      <p className="text-xs text-slate-500">
                        用于尝试复用本地登录态。最好先关闭对应浏览器，再用这个目录启动。
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="flex items-center justify-between rounded-lg border bg-white p-3">
                        <div>
                          <p className="font-medium text-slate-900">无头模式</p>
                          <p className="text-xs text-slate-500">关闭后会弹出真实浏览器窗口，便于观察搜索过程。</p>
                        </div>
                        <Switch
                          checked={formData.browser_headless}
                          onCheckedChange={checked => updateForm('browser_headless', checked)}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border bg-white p-3">
                        <div>
                          <p className="font-medium text-slate-900">保存调试文件</p>
                          <p className="text-xs text-slate-500">
                            在 `.next/debug/xianyu/` 里保存截图和 HTML。
                          </p>
                        </div>
                        <Switch
                          checked={formData.browser_save_debug}
                          onCheckedChange={checked => updateForm('browser_save_debug', checked)}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="font-medium text-slate-900">启用监控</p>
                    <p className="text-xs text-slate-500">关闭后配置保留，但不会自动扫描。</p>
                  </div>
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={checked => updateForm('is_active', checked)}
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setShowForm(false);
                      setEditingConfig(null);
                    }}
                  >
                    取消
                  </Button>
                  <Button className="flex-1" onClick={handleSave}>
                    {editingConfig ? '更新配置' : '创建配置'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {showLogs && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="flex max-h-[90vh] w-full max-w-5xl flex-col">
              <CardHeader className="flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="h-5 w-5" />
                      后台日志
                    </CardTitle>
                    <CardDescription>用来检查浏览器启动方式、登录态、截图保存路径和提取结果。</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAutoRefresh(!autoRefresh)}
                      className={autoRefresh ? 'bg-green-100 text-green-700' : ''}
                    >
                      <RefreshCw className={`mr-1 h-4 w-4 ${autoRefresh ? 'animate-spin' : ''}`} />
                      {autoRefresh ? '自动刷新中' : '自动刷新'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={loadLogs} disabled={logsLoading}>
                      <RefreshCw className={`mr-1 h-4 w-4 ${logsLoading ? 'animate-spin' : ''}`} />
                      刷新
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowLogs(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                <div className="h-[60vh] overflow-y-auto rounded-lg bg-slate-950 p-4 font-mono text-xs">
                  {logs.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">暂无日志</div>
                  ) : (
                    logs.map((log, index) => (
                      <div key={index} className={`py-0.5 ${highlightLog(log)}`}>
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
