/**
 * BIBI Cars - Team Tasks Control
 * Task management for team lead
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL, useAuth } from '../../App';
import { useLang } from '../../i18n';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { uk } from 'date-fns/locale';
import {
  ListChecks,
  Clock,
  Warning,
  CreditCard,
  Truck,
  ArrowUp,
  ArrowsClockwise,
  Eye,
  Fire
} from '@phosphor-icons/react';

const TeamTasksPage = () => {
  const { user } = useAuth();
  const { t } = useLang();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overdue');

  useEffect(() => {
    fetchTasks();
  }, [activeTab]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      let url = `${API_URL}/api/team/tasks`;
      if (activeTab === 'overdue') url = `${API_URL}/api/team/tasks/overdue`;
      else if (activeTab !== 'all') url += `?type=${activeTab}`;

      const res = await axios.get(url).catch(() => 
        axios.get(`${API_URL}/api/tasks`)
      );
      const tasksData = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.tasks || []);
      setTasks(tasksData);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEscalate = async (taskId) => {
    try {
      await axios.post(`${API_URL}/api/team/tasks/${taskId}/escalate`);
      toast.success('Task escalated');
      fetchTasks();
    } catch (err) {
      toast.error(t('actionError'));
    }
  };

  const handleReassign = async (taskId) => {
    toast.info(t('functionInDev') || 'In development');
  };

  const tabs = [
    { id: 'overdue', labelKey: 'overdueFilter', icon: Clock, color: '#DC2626' },
    { id: 'high', labelKey: 'highPriorityFilter', icon: Fire, color: '#D97706' },
    { id: 'blocked', labelKey: 'blockedFilter', icon: Warning, color: '#7C3AED' },
    { id: 'payment', labelKey: 'paymentRelated', icon: CreditCard, color: '#059669' },
    { id: 'shipment', labelKey: 'shipmentRelated', icon: Truck, color: '#0891B2' },
  ];

  return (
    <motion.div 
      data-testid="team-tasks-page"
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
          Team Tasks Control
        </h1>
        <p className="text-sm text-[#71717A] mt-1">
          {t('teamTasks') || 'Team Tasks'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === tab.id
                ? 'bg-[#18181B] text-white'
                : 'bg-white border border-[#E4E4E7] text-[#71717A] hover:bg-[#F4F4F5]'
            }`}
          >
            <tab.icon size={16} style={{ color: activeTab === tab.id ? 'white' : tab.color }} />
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Tasks Table */}
      <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-[#4F46E5] border-t-transparent rounded-full mx-auto"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#F4F4F5]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#71717A] uppercase">Task</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Manager</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Lead/Deal</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Priority</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Due At</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Age</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#71717A] uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7]">
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-[#71717A]">
                      Задач не знайдено
                    </td>
                  </tr>
                ) : (
                  tasks.map((task, idx) => (
                    <motion.tr
                      key={task._id || idx}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.02 }}
                      className="hover:bg-[#FAFAFA] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div>
                          <div className="font-medium text-[#18181B]">{task.title || task.type}</div>
                          <div className="text-xs text-[#71717A]">{task.type}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-sm">
                        {task.assigneeName || task.assignee?.name || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-[#71717A]">
                        {task.leadName || task.dealVin?.slice(-6) || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          task.priority === 'high' || task.priority === 'urgent' ? 'bg-[#FEF2F2] text-[#DC2626]' :
                          task.priority === 'medium' ? 'bg-[#FEF3C7] text-[#D97706]' :
                          'bg-[#F4F4F5] text-[#71717A]'
                        }`}>
                          {task.priority || 'normal'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-[#71717A]">
                        {task.dueAt ? format(new Date(task.dueAt), 'dd MMM, HH:mm', { locale: uk }) : 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          task.status === 'overdue' ? 'bg-[#FEF2F2] text-[#DC2626]' :
                          task.status === 'pending' ? 'bg-[#FEF3C7] text-[#D97706]' :
                          task.status === 'completed' ? 'bg-[#ECFDF5] text-[#059669]' :
                          'bg-[#F4F4F5] text-[#71717A]'
                        }`}>
                          {task.status || 'pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-[#71717A]">
                        {task.ageInHours ? `${task.ageInHours}h` : 'N/A'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleReassign(task._id)}
                            className="p-2 text-[#71717A] hover:text-[#4F46E5] hover:bg-[#EEF2FF] rounded-lg transition-colors"
                            title="Reassign"
                          >
                            <ArrowsClockwise size={16} />
                          </button>
                          <button
                            onClick={() => handleEscalate(task._id)}
                            className="p-2 text-[#71717A] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg transition-colors"
                            title="Escalate"
                          >
                            <ArrowUp size={16} />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default TeamTasksPage;
