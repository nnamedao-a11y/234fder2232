import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../App';
import { useLang } from '../i18n';
import { toast } from 'sonner';
import { Plus, Clock, Warning } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { motion } from 'framer-motion';

const TASK_STATUSES = ['todo', 'in_progress', 'completed', 'cancelled'];
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const Tasks = () => {
  const { t } = useLang();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ title: '', description: '', priority: 'medium', dueDate: '' });

  useEffect(() => { fetchTasks(); }, [statusFilter]);

  const fetchTasks = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      const res = await axios.get(`${API_URL}/api/tasks?${params}`);
      setTasks(res.data.data || []);
    } catch (err) { toast.error(t('error')); } finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/api/tasks`, formData);
      toast.success(t('taskCreated'));
      setShowModal(false);
      setFormData({ title: '', description: '', priority: 'medium', dueDate: '' });
      fetchTasks();
    } catch (err) { toast.error(t('error')); }
  };

  const handleStatusChange = async (id, status) => {
    try {
      await axios.put(`${API_URL}/api/tasks/${id}`, { status });
      toast.success(t('statusUpdated'));
      fetchTasks();
    } catch (err) { toast.error(t('error')); }
  };

  const statusLabels = { todo: t('taskTodo'), in_progress: t('taskInProgress'), completed: t('taskCompleted'), cancelled: t('taskCancelled') };
  const priorityLabels = { low: t('priorityLow'), medium: t('priorityMedium'), high: t('priorityHigh'), urgent: t('priorityUrgent') };
  const priorityColors = { low: { bg: '#F4F4F5', text: '#71717A' }, medium: { bg: '#DBEAFE', text: '#2563EB' }, high: { bg: '#FEF3C7', text: '#D97706' }, urgent: { bg: '#FEE2E2', text: '#DC2626' } };
  const isOverdue = (dueDate) => dueDate && new Date(dueDate) < new Date();

  return (
    <motion.div data-testid="tasks-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>{t('tasksTitle')}</h1>
          <p className="text-sm text-[#71717A] mt-1">{t('taskManagement')}</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary w-full sm:w-auto" data-testid="create-task-btn">
          <Plus size={18} weight="bold" />{t('newTask')}
        </button>
      </div>

      <div className="card p-5 mb-5">
        <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[180px] input" data-testid="tasks-status-filter"><SelectValue placeholder={t('allStatuses')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allStatuses')}</SelectItem>
            {TASK_STATUSES.map(s => (<SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        {loading ? (<div className="text-center py-12 text-[#71717A]">{t('loading')}</div>
        ) : tasks.length === 0 ? (<div className="text-center py-12 text-[#71717A]">{t('noTasks')}</div>
        ) : tasks.map(task => (
          <div key={task.id} className={`card p-5 ${isOverdue(task.dueDate) && task.status !== 'completed' ? 'border-l-4 border-l-[#DC2626]' : ''}`} data-testid={`task-card-${task.id}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="font-semibold text-[#18181B]">{task.title}</h3>
                  <span className="badge" style={{ backgroundColor: priorityColors[task.priority].bg, color: priorityColors[task.priority].text }}>
                    {priorityLabels[task.priority]}
                  </span>
                </div>
                {task.description && <p className="text-sm text-[#71717A] mb-3">{task.description}</p>}
                {task.dueDate && (
                  <div className={`flex items-center gap-2 text-sm ${isOverdue(task.dueDate) && task.status !== 'completed' ? 'text-[#DC2626]' : 'text-[#71717A]'}`}>
                    {isOverdue(task.dueDate) && task.status !== 'completed' ? <Warning size={16} /> : <Clock size={16} />}
                    <span>{new Date(task.dueDate).toLocaleDateString('uk-UA')}</span>
                  </div>
                )}
              </div>
              <Select value={task.status} onValueChange={(v) => handleStatusChange(task.id, v)}>
                <SelectTrigger className="w-[160px] input" data-testid={`task-status-${task.id}`}><SelectValue /></SelectTrigger>
                <SelectContent>{TASK_STATUSES.map(s => (<SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>))}</SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md bg-white rounded-2xl border border-[#E4E4E7]" data-testid="task-modal">
          <DialogHeader><DialogTitle className="text-xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>{t('newTask')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5 mt-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('taskTitle')}</label>
              <input type="text" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} required className="input w-full" data-testid="task-title-input" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('priority')}</label>
                <Select value={formData.priority} onValueChange={(v) => setFormData({...formData, priority: v})}>
                  <SelectTrigger className="input" data-testid="task-priority-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{TASK_PRIORITIES.map(p => (<SelectItem key={p} value={p}>{priorityLabels[p]}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('deadline')}</label>
                <input type="date" value={formData.dueDate} onChange={(e) => setFormData({...formData, dueDate: e.target.value})} className="input w-full" data-testid="task-duedate-input" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">{t('description')}</label>
              <textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={3} className="input w-full resize-none" data-testid="task-description-input" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">{t('cancel')}</button>
              <button type="submit" className="btn-primary flex-1" data-testid="task-submit-btn">{t('create')}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default Tasks;
