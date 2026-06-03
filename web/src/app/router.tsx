import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../components/common/AppShell';
import { CaseMatrixPage } from '../pages/cases/CaseMatrixPage';
import { WorkLogsPage } from '../pages/work-logs/WorkLogsPage';
import { ExceptionsPage } from '../pages/exceptions/ExceptionsPage';
import { ImportsPage } from '../pages/imports/ImportsPage';
import { ReportsPage } from '../pages/reports/ReportsPage';
import { SettingsPage } from '../pages/settings/SettingsPage';
import { MobileShell } from '../pages/mobile/MobileShell';
import { MobileHomePage } from '../pages/mobile/MobileHomePage';
import { MobileTaskListPage } from '../pages/mobile/MobileTaskListPage';
import { MobileWorkLogPage } from '../pages/mobile/MobileWorkLogPage';
import { MobileExceptionsPage } from '../pages/mobile/MobileExceptionsPage';
import { MobileCaseSummaryPage } from '../pages/mobile/MobileCaseSummaryPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/cases" replace /> },
      { path: 'cases', element: <CaseMatrixPage /> },
      { path: 'work-logs', element: <WorkLogsPage /> },
      { path: 'exceptions', element: <ExceptionsPage /> },
      { path: 'imports', element: <ImportsPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'settings/:section?', element: <SettingsPage /> }
    ]
  },
  {
    path: '/m',
    element: <MobileShell />,
    children: [
      { index: true, element: <MobileHomePage /> },
      { path: 'tasks', element: <MobileTaskListPage /> },
      { path: 'work-logs/new', element: <MobileWorkLogPage /> },
      { path: 'exceptions', element: <MobileExceptionsPage /> },
      { path: 'cases/:id', element: <MobileCaseSummaryPage /> }
    ]
  }
]);
