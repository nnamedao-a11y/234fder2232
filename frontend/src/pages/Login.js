import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { useLang } from '../i18n';
import { toast } from 'sonner';
import { Eye, EyeSlash, ArrowRight } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

const Login = () => {
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(email, password);
      toast.success(t('loginSuccess'));
      
      // Redirect based on user role
      const role = user?.role;
      if (role === 'manager') {
        navigate('/manager');
      } else if (role === 'team_lead') {
        navigate('/team');
      } else {
        // owner, master_admin, admin, moderator -> full admin
        navigate('/admin');
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        toast.error('Забагато спроб. Спробуйте через 1 хвилину.');
      } else if (status === 401) {
        toast.error('Невірний email або пароль');
      } else {
        toast.error(err.response?.data?.detail || err.response?.data?.message || t('loginError'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F7F8] flex items-center justify-center p-4">
      <motion.div 
        className="w-full max-w-md"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="bg-white rounded-2xl border border-[#E4E4E7] p-8 shadow-sm">
          {/* Logo */}
          <div className="flex items-center justify-center mb-8">
            <img 
              src="/images/logo.svg" 
              alt="Logo" 
              className="h-12 w-auto"
            />
          </div>

          <form onSubmit={handleSubmit} data-testid="login-form">
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
                  {t('email')}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input w-full"
                  placeholder="email@example.com"
                  required
                  data-testid="login-email-input"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
                  {t('password')}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input w-full pr-12"
                    placeholder="••••••••"
                    required
                    data-testid="login-password-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#18181B] transition-colors"
                    data-testid="toggle-password-btn"
                  >
                    {showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 mt-2"
                data-testid="login-submit-btn"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    {t('loading')}
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    {t('loginButton')}
                    <ArrowRight size={18} />
                  </span>
                )}
              </button>
            </div>
          </form>

          <p className="text-center text-xs text-[#71717A] mt-6">
            BIBI Cars CRM · Production mode
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
