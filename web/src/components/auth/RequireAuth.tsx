import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getAuthSession } from '../../services/auth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!getAuthSession()) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  return children;
}
