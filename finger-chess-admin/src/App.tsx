import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';

// Route-based code splitting: each admin page becomes its own chunk,
// fetched only when its route is actually visited. Previously every page
// — including ReportsPage (recharts) and its heavier chart dependency —
// was bundled into the single main chunk loaded on first paint, even for
// an admin who only ever opens the Users page. `Dashboard` stays eagerly
// imported since it's the landing route after login and would otherwise
// show a loading flash on the very first navigation.
import { DashboardPage } from './pages/DashboardPage';
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const VerificationPage = lazy(() => import('./pages/VerificationPage').then((m) => ({ default: m.VerificationPage })));
const SecurityPage = lazy(() => import('./pages/SecurityPage').then((m) => ({ default: m.SecurityPage })));
const RolePermissionsPage = lazy(() => import('./pages/RolePermissionsPage').then((m) => ({ default: m.RolePermissionsPage })));
const WalletMonitoringPage = lazy(() => import('./pages/WalletMonitoringPage').then((m) => ({ default: m.WalletMonitoringPage })));
const GameMonitoringPage = lazy(() => import('./pages/GameMonitoringPage').then((m) => ({ default: m.GameMonitoringPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const SupportPage = lazy(() => import('./pages/SupportPage').then((m) => ({ default: m.SupportPage })));
const FraudPage = lazy(() => import('./pages/FraudPage').then((m) => ({ default: m.FraudPage })));
const FairPlayPage = lazy(() => import('./pages/FairPlayPage').then((m) => ({ default: m.FairPlayPage })));
const TournamentsPage = lazy(() => import('./pages/TournamentsPage').then((m) => ({ default: m.TournamentsPage })));
const LogsPage = lazy(() => import('./pages/LogsPage').then((m) => ({ default: m.LogsPage })));

function RequireAuth({ children }: { children: JSX.Element }) {
  const { admin, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-ink-faint font-mono text-sm">loading…</div>;
  if (!admin) return <Navigate to="/login" replace />;
  return children;
}

function RouteFallback() {
  return <div className="p-6 text-ink-faint font-mono text-sm">loading…</div>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="users" element={<Suspense fallback={<RouteFallback />}><UsersPage /></Suspense>} />
            <Route path="verification" element={<Suspense fallback={<RouteFallback />}><VerificationPage /></Suspense>} />
            <Route path="security" element={<Suspense fallback={<RouteFallback />}><SecurityPage /></Suspense>} />
            <Route path="roles" element={<Suspense fallback={<RouteFallback />}><RolePermissionsPage /></Suspense>} />
            <Route path="wallet" element={<Suspense fallback={<RouteFallback />}><WalletMonitoringPage /></Suspense>} />
            <Route path="games" element={<Suspense fallback={<RouteFallback />}><GameMonitoringPage /></Suspense>} />
            <Route path="reports" element={<Suspense fallback={<RouteFallback />}><ReportsPage /></Suspense>} />
            <Route path="support" element={<Suspense fallback={<RouteFallback />}><SupportPage /></Suspense>} />
            <Route path="fraud" element={<Suspense fallback={<RouteFallback />}><FraudPage /></Suspense>} />
            <Route path="fairplay" element={<Suspense fallback={<RouteFallback />}><FairPlayPage /></Suspense>} />
            <Route path="tournaments" element={<Suspense fallback={<RouteFallback />}><TournamentsPage /></Suspense>} />
            <Route path="logs" element={<Suspense fallback={<RouteFallback />}><LogsPage /></Suspense>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
