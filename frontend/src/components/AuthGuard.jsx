import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkAuthStatus } from '../api/auth';
import { isAuthenticated } from '../utils/auth';

export default function AuthGuard({ children }) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const status = await checkAuthStatus();
        if (!status.is_configured) {
          navigate('/setup', { replace: true });
        } else if (!isAuthenticated()) {
          navigate('/login', { replace: true });
        } else {
          setReady(true);
        }
      } catch {
        navigate('/login', { replace: true });
      }
    })();
  }, [navigate]);

  if (!ready) return null;
  return children;
}
