/**
 * BIBI Cars - Admin Score Rules Management
 * Control Layer: Manage scoring rules for leads, deals, managers, shipments
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL, useAuth } from '../../App';
import { useLang } from '../../i18n';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChartLineUp,
  Plus,
  Pencil,
  Trash,
  Fire,
  Heart,
  User,
  Truck,
  ToggleLeft,
  ToggleRight,
  X,
  Tag,
  Lightning,
  Info
} from '@phosphor-icons/react';

const ScoreRulesPage = () => {
  const { user } = useAuth();
  const { t } = useLang();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('lead_score');
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/scoring/rules`);
      const rulesData = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.rules || []);
      setRules(rulesData);
    } catch (err) {
      console.error('Error fetching score rules:', err);
      toast.error('Помилка завантаження правил');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRule = async (rule) => {
    try {
      await axios.patch(`${API_URL}/api/scoring/rules/${rule.code}/toggle`, {
        isActive: !rule.isActive
      });
      toast.success(rule.isActive ? 'Правило деактивовано' : 'Правило активовано');
      fetchRules();
    } catch (err) {
      toast.error('Помилка');
    }
  };

  const handleDeleteRule = async (code) => {
    if (!window.confirm('Видалити це правило?')) return;
    try {
      await axios.delete(`${API_URL}/api/scoring/rules/${code}`);
      toast.success('Правило видалено');
      fetchRules();
    } catch (err) {
      toast.error('Помилка видалення');
    }
  };

  const handleSaveRule = async (ruleData) => {
    try {
      if (editingRule?.code) {
        await axios.patch(`${API_URL}/api/scoring/rules/${editingRule.code}`, ruleData);
        toast.success('Правило оновлено');
      } else {
        await axios.post(`${API_URL}/api/scoring/rules`, ruleData);
        toast.success('Правило створено');
      }
      setShowForm(false);
      setEditingRule(null);
      fetchRules();
    } catch (err) {
      toast.error('Помилка збереження');
    }
  };

  const scoreTypes = [
    { id: 'lead_score', label: 'Lead Score', icon: Fire, color: '#DC2626', bgColor: '#FEF2F2', description: 'Оцінка лідів (cold/warm/hot)' },
    { id: 'deal_health', label: 'Deal Health', icon: Heart, color: '#059669', bgColor: '#ECFDF5', description: 'Здоровя угоди (low/medium/high)' },
    { id: 'manager_performance', label: 'Manager Performance', icon: User, color: '#4F46E5', bgColor: '#EEF2FF', description: 'Продуктивність менеджера' },
    { id: 'shipment_risk', label: 'Shipment Risk', icon: Truck, color: '#D97706', bgColor: '#FEF3C7', description: 'Ризик доставки' },
  ];

  const filteredRules = rules.filter(r => r.scoreType === activeTab);
  const activeType = scoreTypes.find(t => t.id === activeTab);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[#4F46E5] border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <motion.div 
      data-testid="score-rules-page"
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            {t('scoreRulesTitle')}
          </h1>
          <p className="text-sm text-[#71717A] mt-1">
            {t('scoreRulesSubtitle')}
          </p>
        </div>
        <button
          onClick={() => { setEditingRule(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#18181B] text-white rounded-xl hover:bg-[#27272A] transition-colors text-sm font-medium"
          data-testid="create-score-rule-btn"
        >
          <Plus size={18} weight="bold" />
          {t('addScoreRule')}
        </button>
      </div>

      {/* Score Type Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {scoreTypes.map((type) => {
          const count = rules.filter(r => r.scoreType === type.id).length;
          const activeCount = rules.filter(r => r.scoreType === type.id && r.isActive).length;
          return (
            <motion.div
              key={type.id}
              whileHover={{ scale: 1.02 }}
              onClick={() => setActiveTab(type.id)}
              className={`cursor-pointer rounded-2xl p-5 border transition-all ${
                activeTab === type.id 
                  ? 'border-[#18181B] shadow-md' 
                  : 'border-[#E4E4E7] hover:border-[#A1A1AA]'
              }`}
              style={{ backgroundColor: activeTab === type.id ? type.bgColor : 'white' }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="p-2.5 rounded-xl" style={{ backgroundColor: type.bgColor }}>
                  <type.icon size={22} weight="duotone" style={{ color: type.color }} />
                </div>
                <span className="text-2xl font-bold" style={{ color: type.color }}>
                  {count}
                </span>
              </div>
              <h4 className="font-semibold text-[#18181B] mb-1">{type.label}</h4>
              <p className="text-xs text-[#71717A]">{type.description}</p>
              <div className="mt-2 text-xs text-[#A1A1AA]">{activeCount} активних</div>
            </motion.div>
          );
        })}
      </div>

      {/* Rules List */}
      <div className="bg-white rounded-2xl border border-[#E4E4E7] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E4E4E7] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {activeType && (
              <>
                <activeType.icon size={20} style={{ color: activeType.color }} weight="duotone" />
                <h3 className="font-semibold text-[#18181B]">{activeType.label} Rules ({filteredRules.length})</h3>
              </>
            )}
          </div>
        </div>
        
        {filteredRules.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#71717A]">
            Немає правил для цієї категорії
          </div>
        ) : (
          <div className="divide-y divide-[#E4E4E7]">
            {filteredRules.map((rule, idx) => (
              <motion.div
                key={rule.code}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.03 }}
                className={`p-5 hover:bg-[#FAFAFA] transition-colors ${!rule.isActive ? 'opacity-60' : ''}`}
                data-testid={`rule-${rule.code}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-semibold text-[#18181B]">{rule.name}</h4>
                      <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${
                        rule.points > 0 
                          ? 'bg-[#ECFDF5] text-[#059669]' 
                          : 'bg-[#FEF2F2] text-[#DC2626]'
                      }`}>
                        {rule.points > 0 ? '+' : ''}{rule.points} pts
                      </span>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        rule.isActive 
                          ? 'bg-[#ECFDF5] text-[#059669]' 
                          : 'bg-[#F4F4F5] text-[#71717A]'
                      }`}>
                        {rule.isActive ? 'Активне' : 'Неактивне'}
                      </span>
                    </div>
                    
                    <p className="text-sm text-[#71717A] mb-2">{rule.description}</p>
                    
                    <div className="flex items-center gap-2 text-xs text-[#A1A1AA]">
                      <Tag size={12} />
                      <span className="font-mono">{rule.code}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleRule(rule)}
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
                      onClick={() => handleDeleteRule(rule.code)}
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

      {/* Info Block */}
      <div className="bg-[#EEF2FF] rounded-2xl p-5 flex items-start gap-4">
        <Info size={24} className="text-[#4F46E5] flex-shrink-0" weight="duotone" />
        <div>
          <h4 className="font-semibold text-[#18181B] mb-1">Як працює скоринг</h4>
          <p className="text-sm text-[#71717A]">
            Система автоматично перераховує score при кожній події (дзвінок, зміна статусу, оплата тощо). 
            Правила з більшим points мають більший вплив. Score впливає на пріоритизацію лідів, 
            виявлення ризикових угод та оцінку ефективності менеджерів.
          </p>
        </div>
      </div>

      {/* Score Rule Form Modal */}
      <AnimatePresence>
        {showForm && (
          <ScoreRuleFormModal
            rule={editingRule}
            scoreType={activeTab}
            onSave={handleSaveRule}
            onClose={() => { setShowForm(false); setEditingRule(null); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const ScoreRuleFormModal = ({ rule, scoreType, onSave, onClose }) => {
  const [form, setForm] = useState({
    code: rule?.code || '',
    name: rule?.name || '',
    description: rule?.description || '',
    scoreType: rule?.scoreType || scoreType,
    points: rule?.points || 10,
    isActive: rule?.isActive !== false,
    condition: {
      field: rule?.condition?.field || '',
      operator: rule?.condition?.operator || 'exists',
      value: rule?.condition?.value || ''
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = {
      ...form,
      condition: form.condition.field ? form.condition : undefined
    };
    onSave(data);
  };

  const operators = [
    { value: 'exists', label: 'Існує' },
    { value: 'equals', label: 'Дорівнює' },
    { value: 'gt', label: 'Більше ніж' },
    { value: 'lt', label: 'Менше ніж' },
    { value: 'gte', label: 'Більше або дорівнює' },
    { value: 'lte', label: 'Менше або дорівнює' },
    { value: 'contains', label: 'Містить' },
    { value: 'in', label: 'Один з' },
  ];

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
            {rule ? 'Редагувати правило' : 'Нове правило скорингу'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-[#F4F4F5] rounded-lg">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Code */}
          <div>
            <label className="block text-sm font-medium text-[#18181B] mb-1.5">Код (унікальний) *</label>
            <input
              type="text"
              value={form.code}
              onChange={e => setForm({ ...form, code: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
              required
              disabled={!!rule}
              className="w-full px-3 py-2.5 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent disabled:bg-[#F4F4F5] font-mono text-sm"
              placeholder="lead_hot_source"
              data-testid="score-rule-code-input"
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-[#18181B] mb-1.5">Назва *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              required
              className="w-full px-3 py-2.5 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent"
              placeholder="Hot Lead from Premium Source"
              data-testid="score-rule-name-input"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[#18181B] mb-1.5">Опис</label>
            <textarea
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent resize-none"
              placeholder="Опис правила..."
            />
          </div>

          {/* Score Type & Points */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#18181B] mb-1.5">Тип Score</label>
              <select
                value={form.scoreType}
                onChange={e => setForm({ ...form, scoreType: e.target.value })}
                className="w-full px-3 py-2.5 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent"
              >
                <option value="lead_score">Lead Score</option>
                <option value="deal_health">Deal Health</option>
                <option value="manager_performance">Manager Performance</option>
                <option value="shipment_risk">Shipment Risk</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#18181B] mb-1.5">Бали</label>
              <input
                type="number"
                value={form.points}
                onChange={e => setForm({ ...form, points: Number(e.target.value) })}
                className="w-full px-3 py-2.5 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent"
                placeholder="10"
                data-testid="score-rule-points-input"
              />
              <p className="text-xs text-[#71717A] mt-1">Використовуйте від'ємні для штрафів</p>
            </div>
          </div>

          {/* Condition */}
          <div className="border-t border-[#E4E4E7] pt-5">
            <h4 className="font-medium text-[#18181B] mb-3">Умова (опціонально)</h4>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[#71717A] mb-1">Поле</label>
                <input
                  type="text"
                  value={form.condition.field}
                  onChange={e => setForm({
                    ...form,
                    condition: { ...form.condition, field: e.target.value }
                  })}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-sm"
                  placeholder="source"
                />
              </div>
              <div>
                <label className="block text-xs text-[#71717A] mb-1">Оператор</label>
                <select
                  value={form.condition.operator}
                  onChange={e => setForm({
                    ...form,
                    condition: { ...form.condition, operator: e.target.value }
                  })}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-sm"
                >
                  {operators.map(op => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#71717A] mb-1">Значення</label>
                <input
                  type="text"
                  value={form.condition.value}
                  onChange={e => setForm({
                    ...form,
                    condition: { ...form.condition, value: e.target.value }
                  })}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-lg text-sm"
                  placeholder="facebook"
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
              data-testid="save-score-rule-btn"
            >
              {rule ? 'Зберегти' : 'Створити'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

export default ScoreRulesPage;
