import React, { useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL || '';

export const ConsultationCTAForm = () => {
  const [form, setForm] = useState({ name: '', phone: '', desiredCar: '', budget: '', wishes: '' });
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim() || !form.budget.trim()) {
      toast.error('Please fill in required fields');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API}/api/public/leads/quick`, form);
      toast.success('Request sent — we will contact you shortly');
      setForm({ name: '', phone: '', desiredCar: '', budget: '', wishes: '' });
    } catch (err) {
      toast.error('Could not send request');
    } finally {
      setLoading(false);
    }
  };

  const Field = ({ label, children }) => (
    <label className="block mb-6">
      <span className="block text-[14px] text-white mb-3">{label}</span>
      {children}
    </label>
  );

  return (
    <section className="bg-[#1D1D1B] py-[100px]" data-testid="consultation-section">
      <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px] text-center">
        <h2 className="text-[56px] md:text-[80px] font-bold uppercase text-[#FEAE00] leading-tight">
          Don't postpone buying a car
        </h2>
        <h3 className="text-[48px] md:text-[80px] font-bold text-white leading-tight mb-16">Free consultation</h3>
        <form onSubmit={submit} className="max-w-[372px] mx-auto text-left" data-testid="consultation-form">
          <Field label="Full Name*">
            <input className="input-dark" placeholder="Enter your Full name" value={form.name} onChange={set('name')} data-testid="consultation-name" required />
          </Field>
          <Field label="Your Phone Number*">
            <input className="input-dark" placeholder="+359" value={form.phone} onChange={set('phone')} data-testid="consultation-phone" required />
          </Field>
          <Field label="Desired Car">
            <input className="input-dark" placeholder="Audi Q7" value={form.desiredCar} onChange={set('desiredCar')} data-testid="consultation-car" />
          </Field>
          <Field label="Your Budget*">
            <input className="input-dark" placeholder="Enter your budget" value={form.budget} onChange={set('budget')} data-testid="consultation-budget" required />
          </Field>
          <Field label="Additional Wishes">
            <textarea className="input-dark" style={{ height: 90, padding: '12px 16px' }} placeholder="Write additional wishes" value={form.wishes} onChange={set('wishes')} data-testid="consultation-wishes" />
          </Field>
          <button type="submit" disabled={loading} className="btn-amber w-full" data-testid="consultation-submit">
            {loading ? 'SENDING…' : 'SEND REQUEST'}
          </button>
        </form>
      </div>
    </section>
  );
};

export default ConsultationCTAForm;
