/**
 * BIBI Cars - Admin Routing Rules Management
 * Control Layer: Manage lead routing rules
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL, useAuth } from '../../App';
import { useLang } from '../../i18n';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Path,
  Plus,
  Pencil,
  Trash,
  Check,
  X,
  ArrowsDownUp,
  Lightning,
  Users,
  Globe,
  Tag,
  ToggleLeft,
  ToggleRight,
  CaretDown,
  CaretUp
} from '@phosphor-icons/react';

const RoutingRulesPage = () => {
  const { user } = useAuth();
  const { t } = useLang();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [queueStatus, setQueueStatus] = useState(null);

  useEffect(() => {
    fetchRules();
    fetchQueueStatus();
  }, []);

  const fetchRules = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/routing/rules`);
      const rulesData = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.rules || []);
      setRules(rulesData);
    } catch (err) {
      console.error('Error fetching routing rules:', err);
      toast.error('Помилка завантаження правил');
      setRules([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchQueueStatus = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/routing/queue/status`);
      setQueueStatus(res.data);
    } catch (err) {
      console.error('Error fetching queue status:', err);
    }
  };

  const handleSaveRule = async (ruleData) => {
    try {
      if (editingRule?._id) {
        await axios.patch(`${API_URL}/api/routing/rules/${editingRule._id}`, ruleData);
        toast.success('Правило оновлено');
      } else {
        await axios.post(`${API_URL}/api/routing/rules`, ruleData);
        toast.success('Правило створено');
      }
      setShowForm(false);
      setEditingRule(null);
      fetchRules();
    } catch (err) {
      toast.error('Помилка збереження');
    }
  };

  const handleDeleteRule = async (id) => {
    if (!window.confirm('Видалити це правило?')) return;
    try {
      await axios.delete(`${API_URL}/api/routing/rules/${id}`);
      toast.success('Правило видалено');
      fetchRules();
    } catch (err) {
      toast.error('Помилка видалення');
    }
  };

  const handleToggleActive = async (rule) => {
    try {
      await axios.patch(`${API_URL}/api/routing/rules/${rule._id}`, {
        isActive: !rule.isActive
      });
      toast.success(rule.isActive ? 'Правило деактивовано' : 'Правило активовано');
      fetchRules();
    } catch (err) {
      toast.error('Помилка');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[#4F46E5] border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <motion.div 
      data-testid="routing-rules-page"
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            {t('routingRulesTitle')}
          </h1>
          <p className="text-sm text-[#71717A] mt-1">
            {t('routingRulesSubtitle')}
          </p>
        </div>
        <button
          onClick={() => { setEditingRule(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#18181B] text-white rounded-xl hover:bg-[#27272A] transition-colors text-sm font-medium"
          data-testid="create-rule-btn"
        >
          <Plus size={18} weight="bold" />
          {t('addRule')}
        </button>
      </div>

      {/* Queue Status */}
      {queueStatus && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Object.entries(queueStatus.queues || {}).map(([name, count]) => (
            <div key={name} className="bg-white rounded-xl p-4 border border-[#E4E4E7]">
              <div className="flex items-center gap-2 mb-2">
                <Users size={18} className="text-[#4F46E5]" weight="duotone" />
                <span className="text-sm font-medium text-[#71717A]">{name}</span>
              </div>
              <div className="text-2xl font-bold text-[#18181B]">{count}</div>
              <div className="text-xs text-[#A1A1AA]">в черзі</div>
            </div>
          ))}
        </div>
      )}

      {/* Rules List */}
      <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E4E4E7] flex items-center gap-2">
          <Path size={20} className="text-[#4F46E5]" weight="duotone" />
          <h3 className="font-semibold text-[#18181B]">Активні правила ({rules.length})</h3>
        </div>
        
        {rules.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#71717A]">
            Немає правил маршрутизації. Створіть перше правило.
          </div>
        ) : (
          <div className="divide-y divide-[#E4E4E7]">
            {rules.sort((a, b) => a.priority - b.priority).map((rule, idx) => (
              <motion.div
                key={rule._id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.05 }}
                className={`p-5 hover:bg-[#FAFAFA] transition-colors ${!rule.isActive ? 'opacity-60' : ''}`}
                data-testid={`rule-${rule._id}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="inline-flex items-center justify-center w-7 h-7 bg-[#F4F4F5] rounded-lg text-xs font-bold text-[#71717A]">
                        {rule.priority}
                      </span>
                      <h4 className="font-semibold text-[#18181B]">{rule.name}</h4>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        rule.isActive 
                          ? 'bg-[#ECFDF5] text-[#059669]' 
                          : 'bg-[#F4F4F5] text-[#71717A]'
                      }`}>
                        {rule.isActive ? 'Активне' : 'Неактивне'}
                      </span>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 mb-3">
                      {rule.conditions?.source && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#EEF2FF] text-[#4F46E5] text-xs rounded-lg">
                          <Tag size={12} /> Source: {rule.conditions.source}
                        </span>
                      )}
                      {rule.conditions?.country && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#FEF3C7] text-[#D97706] text-xs rounded-lg">
                          <Globe size={12} /> Country: {rule.conditions.country}
                        </span>
                      )}
                      {rule.conditions?.language && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#FCE7F3] text-[#DB2777] text-xs rounded-lg">
                          Language: {rule.conditions.language}
                        </span>
                      )}
                      {rule.conditions?.budget?.min && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#ECFDF5] text-[#059669] text-xs rounded-lg">
                          Budget: ${rule.conditions.budget.min}+
                        </span>
                      )}
                    </div>
                    
                    <div className="text-sm text-[#71717A]">
                      <span className="font-medium">Призначення: </span>
                      {rule.assignToType === 'manager' && `Менеджер: ${rule.assignToId || 'Auto'}`}
                      {rule.assignToType === 'team' && `Команда: ${rule.assignToId || 'Auto'}`}
                      {rule.assignToType === 'queue' && `Черга: ${rule.queueName || 'default'}`}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(rule)}
                      className={`p-2 rounded-lg transition-colors ${
                        rule.isActive 
                          ? 'text-[#059669] hover:bg-[#ECFDF5]' 
                          : 'text-[#71717A] hover:bg-[#F4F4F5]'
                      }`}
                      title={rule.isActive ? 'Деактивувати' : 'Активувати'}
                    >
                      {rule.isActive ? <ToggleRight size={22} weight="fill" /> : <ToggleLeft size={22} />}
                    </button>
                    <button
                      onClick={() => { setEditingRule(rule); setShowForm(true); }}
                      className="p-2 text-[#71717A] hover:text-[#4F46E5] hover:bg-[#EEF2FF] rounded-lg transition-colors"
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      onClick={() => handleDeleteRule(rule._id)}
                      className="p-2 text-[#71717A] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg transition-colors"
                    >
                      <Trash size={18} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Rule Form Modal */}
      <AnimatePresence>
        {showForm && (
          <RuleFormModal
            rule={editingRule}
            onSave={handleSaveRule}
            onClose={() => { setShowForm(false); setEditingRule(null); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const RuleFormModal = ({ rule, onSave, onClose }) => {
  const [form, setForm] = useState({
    name: rule?.name || '',
    priority: rule?.priority || 10,
    isActive: rule?.isActive !== false,
    assignToType: rule?.assignToType || 'queue',
    assignToId: rule?.assignToId || '',
    queueName: rule?.queueName || 'default',
    conditions: {
      source: rule?.conditions?.source || '',
      country: rule?.conditions?.country || '',
      language: rule?.conditions?.language || '',
      budget: {
        min: rule?.conditions?.budget?.min || '',
        max: rule?.conditions?.budget?.max || ''
      }
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = {
      ...form,
      conditions: {
        ...(form.conditions.source && { source: form.conditions.source }),
        ...(form.conditions.country && { country: form.conditions.country }),
        ...(form.conditions.language && { language: form.conditions.language }),
        ...((form.conditions.budget.min || form.conditions.budget.max) && {
          budget: {
            ...(form.conditions.budget.min && { min: Number(form.conditions.budget.min) }),
            ...(form.conditions.budget.max && { max: Number(form.conditions.budget.max) })
          }
        })
      }
    };
    onSave(data);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[#E4E4E7] flex items-center justify-between">
          <h3 className="font-semibold text-lg text-[#18181B]">
            {rule ? 'Редагувати правило' : 'Нове правило'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-[#F4F4F5] rounded-lg">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Name & Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#18181B] mb-1.5">Назва *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                required
                className="w-full px-3 py-2.5 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent"
                placeholder="Hot Leads Rule"
                data-testid="rule-name-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#18181B] mb-1.5">Пріоритет</label>
              <input
                type="number"
                value={form.priority}
                onChange={e => setForm({ ...form, priority: Number(e.target.value) })}
                min="1"
                className="w-full px-3 py-2.5 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent"
                data-testid="rule-priority-input"
              />
            </div>
          </div>

          {/* Assignment Type */}
          <div>
            <label className="block text-sm font-medium text-[#18181B] mb-1.5">Тип призначення</label>
            <select
              value={form.assignToType}
              onChange={e => setForm({ ...form, assignToType: e.target.value })}
              className="w-full px-3 py-2.5 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent"
              data-testid="rule-assign-type-select"
            >
              <option value="queue">Черга</option>
              <option value="manager">Конкретний менеджер</option>
              <option value="team">Команда</option>
            </select>
          </div>

          {form.assignToType === 'queue' && (
            <div>
              <label className="block text-sm font-medium text-[#18181B] mb-1.5">Назва черги</label>
              <input
                type="text"
                value={form.queueName}
                onChange={e => setForm({ ...form, queueName: e.target.value })}
                className="w-full px-3 py-2.5 border border-[#E4E4E7] rounded-xl"
                placeholder="default"
              />
            </div>
          )}

          {form.assignToType !== 'queue' && (
            <div>
              <label className="block text-sm font-medium text-[#18181B] mb-1.5">ID призначення</label>
              <input
                type="text"
                value={form.assignToId}
                onChange={e => setForm({ ...form, assignToId: e.target.value })}
                className="w-full px-3 py-2.5 border border-[#E4E4E7] rounded-xl"
                placeholder="manager-id or team-id"
              />
            </div>
          )}

          {/* Conditions */}
          <div className="border-t border-[#E4E4E7] pt-5">
            <h4 className="font-medium text-[#18181B] mb-3">Умови (фільтри)</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#71717A] mb-1">Source</label>
                <input
                  type="text"
                  value={form.conditions.source}
                  onChange={e => setForm({
                    ...form,
                    conditions: { ...form.conditions, source: e.target.value }
                  })}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-sm"
                  placeholder="facebook, google..."
                />
              </div>
              <div>
                <label className="block text-sm text-[#71717A] mb-1">Country</label>
                <input
                  type="text"
                  value={form.conditions.country}
                  onChange={e => setForm({
                    ...form,
                    conditions: { ...form.conditions, country: e.target.value }
                  })}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-sm"
                  placeholder="UA, US, DE..."
                />
              </div>
              <div>
                <label className="block text-sm text-[#71717A] mb-1">Language</label>
                <input
                  type="text"
                  value={form.conditions.language}
                  onChange={e => setForm({
                    ...form,
                    conditions: { ...form.conditions, language: e.target.value }
                  })}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-sm"
                  placeholder="uk, en..."
                />
              </div>
              <div>
                <label className="block text-sm text-[#71717A] mb-1">Min Budget</label>
                <input
                  type="number"
                  value={form.conditions.budget.min}
                  onChange={e => setForm({
                    ...form,
                    conditions: {
                      ...form.conditions,
                      budget: { ...form.conditions.budget, min: e.target.value }
                    }
                  })}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-sm"
                  placeholder="10000"
                />
              </div>
            </div>
          </div>

          {/* Active Toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setForm({ ...form, isActive: !form.isActive })}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                form.isActive ? 'bg-[#059669]' : 'bg-[#E4E4E7]'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                form.isActive ? 'translate-x-5' : ''
              }`} />
            </button>
            <span className="text-sm text-[#71717A]">Правило активне</span>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-[#E4E4E7] text-[#71717A] rounded-xl hover:bg-[#F4F4F5] transition-colors font-medium"
            >
              Скасувати
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 bg-[#18181B] text-white rounded-xl hover:bg-[#27272A] transition-colors font-medium"
              data-testid="save-rule-btn"
            >
              {rule ? 'Зберегти' : 'Створити'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

export default RoutingRulesPage;
