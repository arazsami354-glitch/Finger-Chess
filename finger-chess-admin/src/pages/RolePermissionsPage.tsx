import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Panel, Badge, LoadingRow } from '../components/ui';

interface PermissionsResponse {
  roles: string[];
  roleDescriptions: Record<string, string>;
  matrix: { area: string; actions: { action: string; roles: string[] }[] }[];
}

const ROLE_LABELS: Record<string, string> = {
  support_agent: 'Support Agent',
  finance_admin: 'Finance Admin',
  super_admin: 'Super Admin',
};

function roleTone(role: string): 'gain' | 'info' {
  return role === 'super_admin' ? 'info' : 'gain';
}

export function RolePermissionsPage() {
  const [data, setData] = useState<PermissionsResponse | null>(null);

  useEffect(() => {
    api.get('/admin/roles/permissions').then(({ data }) => setData(data));
  }, []);

  if (!data) return <LoadingRow />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Role Permissions</h1>

      <div className="grid md:grid-cols-3 gap-4">
        {data.roles.map((role) => (
          <Panel key={role} title={ROLE_LABELS[role] ?? role}>
            <p className="text-sm text-ink-faint leading-relaxed">{data.roleDescriptions[role]}</p>
          </Panel>
        ))}
      </div>

      <Panel title="Permission Matrix">
        <div className="-m-5">
          <table className="w-[calc(100%+2.5rem)]">
            <thead>
              <tr>
                <th className="th">Area</th>
                <th className="th">Action</th>
                <th className="th">Support Agent</th>
                <th className="th">Finance Admin</th>
                <th className="th">Super Admin</th>
              </tr>
            </thead>
            <tbody>
              {data.matrix.flatMap((section) =>
                section.actions.map((action, i) => (
                  <tr key={`${section.area}-${action.action}`}>
                    {i === 0 && (
                      <td className="td text-sm font-medium align-top" rowSpan={section.actions.length}>
                        {section.area}
                      </td>
                    )}
                    <td className="td text-sm text-ink-faint">{action.action}</td>
                    {(['support_agent', 'finance_admin', 'super_admin'] as const).map((role) => (
                      <td key={role} className="td text-center">
                        {action.roles.includes(role) ? <Badge tone={roleTone(role)}>✓</Badge> : <span className="text-ink-faint">—</span>}
                      </td>
                    ))}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
