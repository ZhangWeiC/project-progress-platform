import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../components/common/AppShell';
import { CaseMatrixPage } from '../pages/cases/CaseMatrixPage';
import { WorkLogsPage } from '../pages/work-logs/WorkLogsPage';
import { ProductionPlansPage } from '../pages/production-plans/ProductionPlansPage';
import { ExceptionsPage } from '../pages/exceptions/ExceptionsPage';
import { ImportsPage } from '../pages/imports/ImportsPage';
import { ReportsPage } from '../pages/reports/ReportsPage';
import { SettingsPage } from '../pages/settings/SettingsPage';
import { MobileShell } from '../pages/mobile/MobileShell';
import { MobileTaskListPage } from '../pages/mobile/MobileTaskListPage';
import { MobileWorkLogPage } from '../pages/mobile/MobileWorkLogPage';
import { MobileExceptionsPage } from '../pages/mobile/MobileExceptionsPage';
import { MobileCaseSummaryPage } from '../pages/mobile/MobileCaseSummaryPage';
import { MobileCasesPage } from '../pages/mobile/MobileCasesPage';
import { LoginPage } from '../pages/login/LoginPage';
import { FeishuCallbackPage } from '../pages/auth/FeishuCallbackPage';
import { RequireAuth } from '../components/auth/RequireAuth';

function HomeRedirect() {
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
  return <Navigate to={isMobile ? '/m/cases' : '/cases'} replace />;
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
      { path: 'production-plans', element: <ProductionPlansPage /> },
      { path: 'work-logs', element: <WorkLogsPage /> },
      { path: 'exceptions', element: <ExceptionsPage /> },
      { path: 'imports', element: <ImportsPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'settings/:section?', element: <SettingsPage /> }
    ]
  },
  {
    path: '/m',
    element: <RequireAuth><MobileShell /></RequireAuth>,
    children: [
      { index: true, element: <Navigate to="/m/cases" replace /> },
      { path: 'cases', element: <MobileCasesPage /> },
      { path: 'tasks', element: <MobileTaskListPage /> },
      { path: 'work-logs/new', element: <MobileWorkLogPage /> },
      { path: 'exceptions', element: <MobileExceptionsPage /> },
      { path: 'cases/:id', element: <MobileCaseSummaryPage /> }
    ]
  }
]);
