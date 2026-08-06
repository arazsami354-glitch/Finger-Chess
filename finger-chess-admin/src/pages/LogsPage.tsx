import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Panel, LoadingRow, EmptyState } from '../components/ui';

interface AdminLog {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
}

interface SecurityLog {
  id: string;
  userId: string | null;
  eventType: string;
  ipAddress: string | null;
  createdAt: string;
}

export function LogsPage() {
  const [tab, setTab] = useState<'admin' | 'security'>('admin');
  const [adminLogs, setAdminLogs] = useState<AdminLog[]>([]);
  const [securityLogs, setSecurityLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (tab === 'admin') {
      api.get('/admin/dashboard/logs/admin').then(({ data }) => setAdminLogs(data)).finally(() => setLoading(false));
    } else {
      api.get('/admin/dashboard/logs/security').then(({ data }) => setSecurityLogs(data)).finally(() => setLoading(false));
    }
  }, [tab]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">System Logs</h1>
        <div className="flex gap-2">
          <TabButton active={tab === 'admin'} onClick={() => setTab('admin')}>
            Admin Actions
          </TabButton>
          <TabButton active={tab === 'security'} onClick={() => setTab('security')}>
            Security Events
          </TabButton>
        </div>
      </div>

      <Panel>
        {loading ? (
          <LoadingRow />
        ) : tab === 'admin' ? (
          adminLogs.length === 0 ? (
            <EmptyState message="No admin actions logged yet." />
          ) : (
            <table className="-m-5 w-[calc(100%+2.5rem)]">
              <thead>
                <tr>
                  <th className="th">Admin</th>
                  <th className="th">Action</th>
                  <th className="th">Target</th>
                  <th className="th">When</th>
                </tr>
              </thead>
              <tbody>
                {adminLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="td font-mono text-xs">{l.adminId}</td>
                    <td className="td">{l.action}</td>
                    <td className="td text-xs text-ink-faint">
                      {l.targetType}
                      {l.targetId ? ` · ${l.targetId}` : ''}
                    </td>
                    <td className="td text-xs text-ink-faint font-mono">{new Date(l.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : securityLogs.length === 0 ? (
          <EmptyState message="No security events logged yet." />
        ) : (
          <table className="-m-5 w-[calc(100%+2.5rem)]">
            <thead>
              <tr>
                <th className="th">User</th>
                <th className="th">Event</th>
                <th className="th">IP</th>
                <th className="th">When</th>
              </tr>
            </thead>
            <tbody>
              {securityLogs.map((l) => (
                <tr key={l.id}>
                  <td className="td font-mono text-xs">{l.userId ?? '—'}</td>
                  <td className="td">{l.eventType.replace(/_/g, ' ')}</td>
                  <td className="td font-mono text-xs">{l.ipAddress ?? '—'}</td>
                  <td className="td text-xs text-ink-faint font-mono">{new Date(l.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-sm transition-colors ${active ? 'bg-brass text-canvas font-medium' : 'bg-surface-raised text-ink-muted hover:text-ink'}`}
    >
      {children}
    </button>
  );
}
