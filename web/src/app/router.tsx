import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../components/common/AppShell';
import { CaseMatrixPage } from '../pages/cases/CaseMatrixPage';
import { SettingsPage } from '../pages/settings/SettingsPage';
import { DesignWorkTimelinePage } from '../pages/design-work/DesignWorkTimelinePage';
import { LoginPage } from '../pages/login/LoginPage';
import { FeishuCallbackPage } from '../pages/auth/FeishuCallbackPage';
import { RequireAuth } from '../components/auth/RequireAuth';
import { getAuthSession } from '../services/auth';

function HomeRedirect() {
  return <Navigate to="/cases" replace />;
}

function AdminOnly({ children }: { children: JSX.Element }) {
  const user = getAuthSession()?.user;
  if (user?.permission_level !== 'manager') return <Navigate to="/cases" replace />;
  return children;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/auth/feishu/callback', element: <FeishuCallbackPage /> },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'dashboard', element: <Navigate to="/cases" replace /> },
      { path: 'cases', element: <CaseMatrixPage /> },
      { path: 'design-work', element: <DesignWorkTimelinePage /> },
      { path: 'settings/:section?', element: <AdminOnly><SettingsPage /></AdminOnly> }
    ]
  }
]);
