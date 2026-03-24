'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { 
  Plus, 
  Play, 
  Trash2, 
  Edit, 
  Search, 
  Bell, 
  Clock,
  DollarSign,
  ArrowUpDown,
  Cookie,
  AlertCircle,
  Terminal,
  RefreshCw,
  X
} from 'lucide-react';

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
  created_at: string;
  updated_at: string;
}

export default function Home() {
  const [configs, setConfigs] = useState<MonitorConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingConfig, setEditingConfig] = useState<MonitorConfig | null>(null);
  const [showForm, setShowForm] = useState(false);
  
  // 日志相关状态
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // 表单数据
  const [formData, setFormData] = useState({
    search_keyword: '摩托车',
    price_min: '20000',
    price_max: '',
    time_range: '1hour',
    sort_type: 'newest',
    cron_expression: '0 */30 * * * *',
    webhook_url: '',
    cookies: '',
    is_active: true,
  });

  // 加载配置列表
  const loadConfigs = async () => {
    try {
      const response = await fetch('/api/configs');
      const data = await response.json();
      setConfigs(data.configs || []);
    } catch (error) {
      toast.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载日志
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

  // 自动刷新日志
  useEffect(() => {
    if (showLogs && autoRefresh) {
      loadLogs();
      const timer = setInterval(loadLogs, 3000);
      return () => clearInterval(timer);
    }
  }, [showLogs, autoRefresh, loadLogs]);

  // 打开日志面板时加载日志
  useEffect(() => {
    if (showLogs) {
      loadLogs();
    }
  }, [showLogs, loadLogs]);

  // 保存配置
  const handleSave = async () => {
    try {
      const url = editingConfig ? `/api/configs/${editingConfig.id}` : '/api/configs';
      const method = editingConfig ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          search_keyword: formData.search_keyword,
          price_min: formData.price_min ? parseInt(formData.price_min) : null,
          price_max: formData.price_max ? parseInt(formData.price_max) : null,
          time_range: formData.time_range || null,
          sort_type: formData.sort_type || null,
          cron_expression: formData.cron_expression,
          webhook_url: formData.webhook_url || null,
          cookies: formData.cookies || null,
          is_active: formData.is_active,
        }),
      });

      if (response.ok) {
        toast.success(editingConfig ? '配置已更新' : '配置已创建');
        setShowForm(false);
        setEditingConfig(null);
        resetForm();
        loadConfigs();
      } else {
        const error = await response.json();
        toast.error(error.message || '保存失败');
      }
    } catch (error) {
      toast.error('保存失败');
    }
  };

  // 删除配置
  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个监控配置吗？')) return;

    try {
      const response = await fetch(`/api/configs/${id}`, { method: 'DELETE' });
      if (response.ok) {
        toast.success('配置已删除');
        loadConfigs();
      }
    } catch (error) {
      toast.error('删除失败');
    }
  };

  // 手动触发扫描
  const handleTrigger = async (id: number) => {
    try {
      toast.info('开始扫描...');
      const response = await fetch(`/api/trigger/${id}`, { method: 'POST' });
      const data = await response.json();

      if (response.ok) {
        if (data.warning) {
          toast.warning(data.warning.split('\n')[0]); // 显示第一行警告
        } else if (data.newProducts > 0) {
          toast.success(`扫描完成，发现 ${data.newProducts} 个新商品`);
        } else {
          toast.info('扫描完成，未发现新商品');
        }
        // 刷新日志
        if (showLogs) {
          setTimeout(loadLogs, 1000);
        }
      } else {
        toast.error(data.error || '扫描失败');
        if (data.hint) {
          toast.info(data.hint, { duration: 10000 });
        }
      }
    } catch (error) {
      toast.error('触发扫描失败');
    }
  };

  // 编辑配置
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
    });
    setShowForm(true);
  };

  // 重置表单
  const resetForm = () => {
    setFormData({
      search_keyword: '摩托车',
      price_min: '20000',
      price_max: '',
      time_range: '1hour',
      sort_type: 'newest',
      cron_expression: '0 */30 * * * *',
      webhook_url: '',
      cookies: '',
      is_active: true,
    });
  };

  const getTimeRangeLabel = (range: string | null) => {
    const labels: Record<string, string> = {
      '1hour': '1小时内',
      '24hours': '24小时内',
      '7days': '7天内',
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
    if (cron.includes('*/30 * * * *')) return '每30分钟';
    if (cron.includes('*/60 * * * *') || cron.includes('0 * * * *')) return '每小时';
    if (cron.includes('0 */2 * * *')) return '每2小时';
    if (cron.includes('0 */6 * * *')) return '每6小时';
    return cron;
  };

  // 高亮日志中的关键词
  const highlightLog = (log: string) => {
    if (log.includes('ERROR') || log.includes('error') || log.includes('失败')) {
      return 'text-red-500';
    }
    if (log.includes('WARN') || log.includes('警告')) {
      return 'text-yellow-500';
    }
    if (log.includes('SUCCESS') || log.includes('成功') || log.includes('完成')) {
      return 'text-green-500';
    }
    if (log.includes('监控任务') || log.includes('扫描')) {
      return 'text-blue-400';
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">闲鱼商品监控</h1>
            <p className="text-slate-600 mt-2">定时扫描闲鱼商品，发现新品即时通知</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowLogs(true)}
              className="gap-2"
            >
              <Terminal className="w-4 h-4" />
              查看日志
            </Button>
            <Button
              onClick={() => {
                resetForm();
                setEditingConfig(null);
                setShowForm(true);
              }}
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              新建监控
            </Button>
          </div>
        </div>

        {/* 架构说明卡片 */}
        <Card className="mb-6 border-blue-200 bg-blue-50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium">架构说明</p>
                <p className="mt-1">
                  本项目采用 <strong>前后端分离</strong> 架构：Playwright 爬虫在<strong>服务端</strong>运行，
                  通过 API 触发。点击"立即扫描"后，服务器会启动无头浏览器访问闲鱼并提取商品数据。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 配置列表 */}
        {configs.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <Search className="w-16 h-16 mx-auto text-slate-300 mb-4" />
              <h3 className="text-lg font-semibold text-slate-600 mb-2">还没有监控配置</h3>
              <p className="text-slate-500 mb-4">点击右上角按钮创建第一个监控任务</p>
              <Button onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                创建监控
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {configs.map((config) => (
              <Card key={config.id} className={!config.is_active ? 'opacity-60' : ''}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-xl flex items-center gap-2">
                        <Search className="w-5 h-5" />
                        {config.search_keyword}
                        <Badge variant={config.is_active ? 'default' : 'secondary'}>
                          {config.is_active ? '运行中' : '已暂停'}
                        </Badge>
                      </CardTitle>
                      <CardDescription className="mt-2 flex flex-wrap gap-3">
                        {config.price_min && (
                          <span className="flex items-center gap-1">
                            <DollarSign className="w-4 h-4" />
                            ¥{config.price_min}
                            {config.price_max && ` - ¥${config.price_max}`}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          {getTimeRangeLabel(config.time_range)}
                        </span>
                        <span className="flex items-center gap-1">
                          <ArrowUpDown className="w-4 h-4" />
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
                        <Play className="w-4 h-4 mr-1" />
                        立即扫描
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(config)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(config.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm text-slate-600">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <Bell className="w-4 h-4" />
                        {config.webhook_url ? '已配置通知' : '未配置通知'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Cookie className="w-4 h-4" />
                        {config.cookies ? '已设置Cookie' : '未设置Cookie'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
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

        {/* 创建/编辑表单 */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <CardHeader>
                <CardTitle>{editingConfig ? '编辑监控配置' : '新建监控配置'}</CardTitle>
                <CardDescription>
                  设置搜索条件和通知方式，系统将自动定时扫描
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 搜索关键词 */}
                <div className="space-y-2">
                  <Label htmlFor="keyword">搜索关键词 *</Label>
                  <Input
                    id="keyword"
                    value={formData.search_keyword}
                    onChange={(e) => setFormData({ ...formData, search_keyword: e.target.value })}
                    placeholder="例如：摩托车"
                  />
                </div>

                {/* 价格范围 */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="priceMin">最低价格（元）</Label>
                    <Input
                      id="priceMin"
                      type="number"
                      value={formData.price_min}
                      onChange={(e) => setFormData({ ...formData, price_min: e.target.value })}
                      placeholder="例如：20000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="priceMax">最高价格（元）</Label>
                    <Input
                      id="priceMax"
                      type="number"
                      value={formData.price_max}
                      onChange={(e) => setFormData({ ...formData, price_max: e.target.value })}
                      placeholder="可选"
                    />
                  </div>
                </div>

                {/* 时间范围和排序 */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>时间范围</Label>
                    <Select
                      value={formData.time_range}
                      onValueChange={(value) => setFormData({ ...formData, time_range: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1hour">1小时内</SelectItem>
                        <SelectItem value="24hours">24小时内</SelectItem>
                        <SelectItem value="7days">7天内</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>排序方式</Label>
                    <Select
                      value={formData.sort_type}
                      onValueChange={(value) => setFormData({ ...formData, sort_type: value })}
                    >
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

                {/* Cron 表达式 */}
                <div className="space-y-2">
                  <Label htmlFor="cron">扫描频率</Label>
                  <Select
                    value={formData.cron_expression}
                    onValueChange={(value) => setFormData({ ...formData, cron_expression: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0 */15 * * * *">每15分钟</SelectItem>
                      <SelectItem value="0 */30 * * * *">每30分钟</SelectItem>
                      <SelectItem value="0 * * * * *">每小时</SelectItem>
                      <SelectItem value="0 */2 * * * *">每2小时</SelectItem>
                      <SelectItem value="0 */6 * * * *">每6小时</SelectItem>
                      <SelectItem value="0 0 * * * *">每天凌晨</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    当前: {getCronDescription(formData.cron_expression)}
                  </p>
                </div>

                {/* Cookie 设置 */}
                <div className="space-y-2">
                  <Label htmlFor="cookies" className="flex items-center gap-2">
                    <Cookie className="w-4 h-4" />
                    闲鱼登录 Cookie
                  </Label>
                  <Textarea
                    id="cookies"
                    value={formData.cookies}
                    onChange={(e) => setFormData({ ...formData, cookies: e.target.value })}
                    placeholder="请粘贴从浏览器复制的 Cookie 字符串"
                    rows={3}
                    className="font-mono text-xs"
                  />
                  <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-amber-800">
                      <p className="font-medium mb-1">如何获取 Cookie：</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>在浏览器中登录闲鱼网页版 (goofish.com)</li>
                        <li>按 F12 打开开发者工具</li>
                        <li>切换到 Network 标签页</li>
                        <li>刷新页面，找到任意请求</li>
                        <li>在请求头中找到 Cookie 字段并复制</li>
                      </ol>
                    </div>
                  </div>
                </div>

                {/* Webhook URL */}
                <div className="space-y-2">
                  <Label htmlFor="webhook">Webhook 通知地址</Label>
                  <Input
                    id="webhook"
                    value={formData.webhook_url}
                    onChange={(e) => setFormData({ ...formData, webhook_url: e.target.value })}
                    placeholder="例如：https://api.example.com/webhook"
                  />
                  <p className="text-xs text-slate-500">
                    支持飞书、钉钉、企业微信等机器人 Webhook
                  </p>
                </div>

                {/* 启用状态 */}
                <div className="flex items-center justify-between">
                  <Label htmlFor="active">启用监控</Label>
                  <Switch
                    id="active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                </div>

                {/* 操作按钮 */}
                <div className="flex gap-2 pt-4">
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
                    {editingConfig ? '更新' : '创建'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 日志查看面板 */}
        {showLogs && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <Card className="w-full max-w-5xl max-h-[90vh] flex flex-col">
              <CardHeader className="flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="w-5 h-5" />
                      后台日志
                    </CardTitle>
                    <CardDescription>
                      查看系统运行日志，了解扫描状态
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAutoRefresh(!autoRefresh)}
                      className={autoRefresh ? 'bg-green-100 text-green-700' : ''}
                    >
                      <RefreshCw className={`w-4 h-4 mr-1 ${autoRefresh ? 'animate-spin' : ''}`} />
                      {autoRefresh ? '自动刷新中' : '自动刷新'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadLogs}
                      disabled={logsLoading}
                    >
                      <RefreshCw className={`w-4 h-4 mr-1 ${logsLoading ? 'animate-spin' : ''}`} />
                      刷新
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowLogs(false)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                <div className="h-[60vh] bg-slate-900 rounded-lg p-4 overflow-y-auto font-mono text-xs">
                  {logs.length === 0 ? (
                    <div className="text-slate-400 text-center py-8">
                      暂无日志
                    </div>
                  ) : (
                    logs.map((log, index) => (
                      <div 
                        key={index} 
                        className={`py-0.5 ${highlightLog(log)}`}
                      >
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
