import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { setupUser } from '../api/auth';
import { setToken } from '../utils/auth';

function checkRules(password) {
  return {
    length: password.length >= 12,
    uppercase: /[A-Z]/.test(password),
    digit: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

function strengthLevel(rules) {
  const passed = Object.values(rules).filter(Boolean).length;
  if (passed <= 1) return { label: 'Weak', color: 'bg-red-500', width: 'w-1/4' };
  if (passed === 2) return { label: 'Fair', color: 'bg-orange-400', width: 'w-2/4' };
  if (passed === 3) return { label: 'Good', color: 'bg-yellow-400', width: 'w-3/4' };
  return { label: 'Strong', color: 'bg-green-500', width: 'w-full' };
}

export default function Setup() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const rules = checkRules(password);
  const allRulesPassed = Object.values(rules).every(Boolean);
  const strength = password ? strengthLevel(rules) : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!allRulesPassed) {
      setError('Password does not meet all requirements.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const data = await setupUser(username, password);
      setToken(data.access_token);
      navigate('/', { replace: true });
    } catch (err) {
      if (err.response?.status === 409) {
        setError('Account already configured.');
      } else {
        setError('Setup failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-gray-800">Finance Manager</h1>
          <p className="text-sm text-gray-400 mt-1">Create your account</p>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
            {error.includes('already configured') && (
              <> <Link to="/login" className="underline font-medium">Log in instead</Link></>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />

            {password && (
              <div className="mt-2">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full transition-all ${strength.color} ${strength.width}`} />
                  </div>
                  <span className="text-xs text-gray-500 w-12">{strength.label}</span>
                </div>
                <ul className="space-y-0.5 mt-2">
                  {[
                    { key: 'length', label: 'At least 12 characters' },
                    { key: 'uppercase', label: 'At least 1 uppercase letter' },
                    { key: 'digit', label: 'At least 1 digit' },
                    { key: 'special', label: 'At least 1 special character' },
                  ].map(({ key, label }) => (
                    <li key={key} className={`text-xs flex items-center gap-1.5 ${rules[key] ? 'text-green-600' : 'text-red-500'}`}>
                      <span>{rules[key] ? '✓' : '✗'}</span>
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
