import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertTriangle, Phone, CheckCircle2, XCircle, Copy, PlayCircle, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

const RingostatAdminPage = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [health, setHealth] = useState(null);
  const [settings, setSettings] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [staff, setStaff] = useState([]);
  const [calls, setCalls] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);

  // Filters for calls history
  const [filters, setFilters] = useState({
    period: 'today',
    manager: null,
    status: null,
    direction: null
  });

  // Load data
  useEffect(() => {
    loadHealth();
    loadSettings();
    loadMappings();
    loadCalls();
    loadEvents();
  }, []);

  const loadHealth = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/ringostat/health`);
      const data = await res.json();
      setHealth(data);
    } catch (error) {
      console.error('Failed to load health:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/ringostat/settings`);
      const data = await res.json();
      setSettings(data);
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMappings = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/ringostat/mappings`);
      const data = await res.json();
      setMappings(data.mappings || []);
      setStaff(data.staff || []);
    } catch (error) {
      console.error('Failed to load mappings:', error);
    }
  };

  const loadCalls = async () => {
    try {
      const params = new URLSearchParams(filters).toString();
      const res = await fetch(`${BACKEND_URL}/api/admin/ringostat/calls?${params}`);
      const data = await res.json();
      setCalls(data.calls || []);
    } catch (error) {
      console.error('Failed to load calls:', error);
    }
  };

  const loadEvents = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/ringostat/events`);
      const data = await res.json();
      setEvents(data.events || []);
    } catch (error) {
      console.error('Failed to load events:', error);
    }
  };

  const handleSaveSettings = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/ringostat/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      
      if (res.ok) {
        toast({ title: 'Настройки сохранены' });
        loadHealth();
      }
    } catch (error) {
      toast({ title: 'Ошибка сохранения', variant: 'destructive' });
    }
  };

  const handleTestConnection = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/ringostat/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: settings.api_key,
          project_id: settings.project_id
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        toast({ title: '✓ Подключение успешно' });
      } else {
        toast({ title: data.error, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Ошибка тестирования', variant: 'destructive' });
    }
  };

  const handleTestWebhook = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/ringostat/test-webhook`, {
        method: 'POST'
      });
      
      if (res.ok) {
        toast({ title: 'Тестовое событие отправлено' });
        setTimeout(() => {
          loadEvents();
          loadHealth();
        }, 1000);
      }
    } catch (error) {
      toast({ title: 'Ошибка', variant: 'destructive' });
    }
  };

  const handleAddMapping = async (extension, managerId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/ringostat/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extension, manager_id: managerId })
      });
      
      if (res.ok) {
        toast({ title: 'Mapping создан' });
        loadMappings();
        loadHealth();
      }
    } catch (error) {
      toast({ title: 'Ошибка', variant: 'destructive' });
    }
  };

  const handleDeleteMapping = async (extension) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/ringostat/mappings/${extension}`, {
        method: 'DELETE'
      });
      
      if (res.ok) {
        toast({ title: 'Mapping удален' });
        loadMappings();
        loadHealth();
      }
    } catch (error) {
      toast({ title: 'Ошибка', variant: 'destructive' });
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Скопировано' });
  };

  if (loading) {
    return <div className="p-8">Загрузка...</div>;
  }

  const getAttentionAlerts = () => {
    const alerts = [];
    
    if (health?.unassigned?.extensions > 0) {
      alerts.push({
        type: 'warning',
        message: `${health.unassigned.extensions} extension(s) не привязаны к менеджеру`
      });
    }
    
    if (health?.connection?.status === 'disconnected') {
      alerts.push({
        type: 'error',
        message: 'Ringostat не подключен'
      });
    }
    
    if (health?.unassigned?.calls_today > 0) {
      alerts.push({
        type: 'warning',
        message: `${health.unassigned.calls_today} звонков сегодня без менеджера`
      });
    }
    
    return alerts;
  };

  const webhookUrl = `${window.location.origin}/api/integrations/ringostat/webhook`;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Ringostat Operations Control</h1>
        <p className="text-muted-foreground mt-1">Управление звонками, webhook, менеджерами и логикой</p>
      </div>

      {/* Health Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Подключение</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                {health?.connection?.status === 'connected' ? (
                  <div className="flex items-center text-green-600">
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Connected
                  </div>
                ) : (
                  <div className="flex items-center text-red-600">
                    <XCircle className="h-4 w-4 mr-1" />
                    Disconnected
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Last webhook</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {health?.webhook?.last_event ? (
                <span className="text-sm">{new Date(health.webhook.last_event).toLocaleTimeString()}</span>
              ) : (
                <span className="text-sm text-muted-foreground">Нет данных</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Звонков сегодня</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{health?.calls_today || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Требует внимания</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {getAttentionAlerts().length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Attention Alerts */}
      {getAttentionAlerts().length > 0 && (
        <div className="space-y-2">
          {getAttentionAlerts().map((alert, i) => (
            <Alert key={i} variant={alert.type === 'error' ? 'destructive' : 'default'}>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{alert.message}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="settings">Настройки</TabsTrigger>
          <TabsTrigger value="calls">История звонков</TabsTrigger>
          <TabsTrigger value="debug">Отладка</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Operational Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Webhook</div>
                  <div>{health?.webhook?.events_today > 0 ? '🟢 Работает' : '🔴 Нет событий'}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">API key</div>
                  <div>{health?.connection?.api_key_set ? '✅ Настроен' : '⚠️ Не настроен'}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Project ID</div>
                  <div>{health?.connection?.project_id_set ? '✅ Настроен' : '⚠️ Не настроен'}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Manager mappings</div>
                  <div>{health?.mappings?.total - health?.mappings?.unmapped} из {health?.mappings?.total}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button onClick={handleTestConnection}>Test Connection</Button>
              <Button onClick={handleTestWebhook} variant="outline">Send Test Event</Button>
              <Button onClick={() => setActiveTab('settings')} variant="outline">Open Settings</Button>
              <Button onClick={() => setActiveTab('calls')} variant="outline">Call History</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          {/* Connection & Auth */}
          <Card>
            <CardHeader>
              <CardTitle>Ringostat Connection</CardTitle>
              <CardDescription>API ключ и Project ID</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="flex gap-2">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={settings?.api_key || ''}
                    onChange={(e) => setSettings({ ...settings, api_key: e.target.value })}
                    placeholder="Введите API ключ"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Project ID</Label>
                <Input
                  value={settings?.project_id || ''}
                  onChange={(e) => setSettings({ ...settings, project_id: e.target.value })}
                  placeholder="12345"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleTestConnection}>Test Connection</Button>
                <Button onClick={handleSaveSettings}>Save</Button>
              </div>
            </CardContent>
          </Card>

          {/* Webhook Setup */}
          <Card>
            <CardHeader>
              <CardTitle>Webhook Configuration</CardTitle>
              <CardDescription>Настройте этот URL в Ringostat</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Webhook URL</Label>
                <div className="flex gap-2">
                  <Input value={webhookUrl} readOnly />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(webhookUrl)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Last webhook</div>
                  <div>{health?.webhook?.last_event ? new Date(health.webhook.last_event).toLocaleString() : 'Нет данных'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Events today</div>
                  <div>{health?.webhook?.events_today || 0}</div>
                </div>
              </div>
              <Button onClick={handleTestWebhook} variant="outline">Send Test Webhook</Button>
            </CardContent>
          </Card>

          {/* Manager Mapping */}
          <Card>
            <CardHeader>
              <CardTitle>Extension → Manager Mapping</CardTitle>
              <CardDescription>Привязка внутренних номеров к менеджерам CRM (CORE функция)</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Extension</TableHead>
                    <TableHead>CRM Manager</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((mapping) => (
                    <TableRow key={mapping.extension}>
                      <TableCell>{mapping.extension}</TableCell>
                      <TableCell>
                        {mapping.manager_name ? (
                          <div>
                            <div className="font-medium">{mapping.manager_name}</div>
                            <div className="text-sm text-muted-foreground">{mapping.manager_email}</div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Not assigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={mapping.status === 'assigned' ? 'default' : 'destructive'}>
                          {mapping.status === 'assigned' ? '✅' : '⚠️'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteMapping(mapping.extension)}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              <div className="mt-4 flex gap-2">
                <Input placeholder="Extension (101)" id="newExt" />
                <Select onValueChange={(value) => {
                  const ext = document.getElementById('newExt').value;
                  if (ext) handleAddMapping(ext, value);
                }}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select manager" />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Automation Rules */}
          <Card>
            <CardHeader>
              <CardTitle>Automation Rules</CardTitle>
              <CardDescription>Критичные правила автоматизации</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Auto-create lead on unknown inbound call</Label>
                <Switch
                  checked={settings?.automation_rules?.auto_create_lead}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      automation_rules: { ...settings.automation_rules, auto_create_lead: checked }
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Create callback task on missed call</Label>
                <Switch
                  checked={settings?.automation_rules?.missed_call_task}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      automation_rules: { ...settings.automation_rules, missed_call_task: checked }
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Missed call task deadline (minutes)</Label>
                <Input
                  type="number"
                  value={settings?.automation_rules?.missed_call_task_minutes || 5}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      automation_rules: { ...settings.automation_rules, missed_call_task_minutes: parseInt(e.target.value) }
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Require call outcome after answered call</Label>
                <Switch
                  checked={settings?.automation_rules?.require_outcome}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      automation_rules: { ...settings.automation_rules, require_outcome: checked }
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Show outcome form if duration &gt; (seconds)</Label>
                <Input
                  type="number"
                  value={settings?.automation_rules?.require_outcome_duration || 10}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      automation_rules: { ...settings.automation_rules, require_outcome_duration: parseInt(e.target.value) }
                    })
                  }
                />
              </div>
              <Button onClick={handleSaveSettings}>Save Rules</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Calls History Tab */}
        <TabsContent value="calls" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Select value={filters.period} onValueChange={(v) => setFilters({ ...filters, period: v })}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Сегодня</SelectItem>
                  <SelectItem value="week">Неделя</SelectItem>
                  <SelectItem value="month">Месяц</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={loadCalls}>Применить</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Calls History</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Время</TableHead>
                    <TableHead>Номер</TableHead>
                    <TableHead>Направление</TableHead>
                    <TableHead>Длительность</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Lead</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls.map((call) => (
                    <TableRow key={call.id}>
                      <TableCell>{new Date(call.started_at).toLocaleString()}</TableCell>
                      <TableCell>{call.from}</TableCell>
                      <TableCell>
                        <Badge variant={call.direction === 'inbound' ? 'default' : 'secondary'}>
                          {call.direction}
                        </Badge>
                      </TableCell>
                      <TableCell>{call.duration}s</TableCell>
                      <TableCell>
                        <Badge variant={call.status === 'answered' ? 'default' : 'destructive'}>
                          {call.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {call.lead ? call.lead.name : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setSelectedCall(call)}>
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Debug Tab */}
        <TabsContent value="debug" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Debug Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>Last webhook payload: {health?.webhook?.last_event ? new Date(health.webhook.last_event).toLocaleString() : 'Нет данных'}</div>
              <div>Events today: {health?.webhook?.events_today || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Events</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Call ID</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.slice(0, 10).map((evt) => (
                    <TableRow key={evt.id}>
                      <TableCell>{new Date(evt.timestamp).toLocaleString()}</TableCell>
                      <TableCell><Badge>{evt.event_type}</Badge></TableCell>
                      <TableCell className="font-mono text-sm">{evt.call_id}</TableCell>
                      <TableCell>{evt.direction}</TableCell>
                      <TableCell>{evt.from}</TableCell>
                      <TableCell>{evt.duration}s</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Manual Tools</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button onClick={handleTestConnection}>Test Connection</Button>
              <Button onClick={handleTestWebhook} variant="outline">Test Webhook</Button>
              <Button onClick={() => { loadHealth(); loadEvents(); }} variant="outline">Reload Data</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Call Details Drawer */}
      <Sheet open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Call Details</SheetTitle>
            <SheetDescription>Детали звонка</SheetDescription>
          </SheetHeader>
          {selectedCall && (
            <div className="mt-6 space-y-4">
              <div>
                <div className="text-sm text-muted-foreground">Call ID</div>
                <div className="font-mono text-sm">{selectedCall.call_id}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Time</div>
                <div>{new Date(selectedCall.started_at).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Direction</div>
                <Badge>{selectedCall.direction}</Badge>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Duration</div>
                <div>{selectedCall.duration} seconds</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Phone</div>
                <div>{selectedCall.from}</div>
              </div>
              {selectedCall.lead && (
                <div>
                  <div className="text-sm text-muted-foreground">Lead</div>
                  <div>{selectedCall.lead.name}</div>
                  <div className="text-sm text-muted-foreground">{selectedCall.lead.phone}</div>
                </div>
              )}
              {selectedCall.recording_url && (
                <Button className="w-full">
                  <PlayCircle className="h-4 w-4 mr-2" />
                  Play Recording
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default RingostatAdminPage;