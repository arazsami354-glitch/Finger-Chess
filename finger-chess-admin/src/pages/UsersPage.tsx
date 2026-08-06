import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Panel, Badge, Button, LoadingRow, EmptyState } from '../components/ui';

interface UserRow {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
  kycStatus: string;
  role: string;
  createdAt: string;
}

interface UserDetail extends UserRow {
  statusReason: string | null;
  suspendedUntil: string | null;
  dateOfBirth: string | null;
  chatMutedUntil: string | null;
  pendingKycDocuments: number;
  hasAcceptedCurrentRules: boolean;
  rulesAcceptedAt: string | null;
  wallet: { availableBalance: string; lockedBalance: string; pendingBalance: string; currency: string } | null;
  gamesPlayed: number;
  openFraudSignals: number;
  anticheatFlags: number;
  openTickets: number;
}

export function UsersPage() {
  const { can } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<UserDetail | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionOpen, setActionOpen] = useState<'ban' | 'suspend' | 'mute' | null>(null);

  function load() {
    setLoading(true);
    api
      .get('/admin/users', { params: { search: search || undefined, status: statusFilter || undefined } })
      .then(({ data }) => setUsers(data))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [search, statusFilter]);

  function openDetail(id: string) {
    api.get(`/admin/users/${id}`).then(({ data }) => setSelected(data));
  }

  async function handleBan() {
    if (!selected) return;
    await api.post(`/admin/users/${selected.id}/ban`, { reason: actionReason });
    setActionOpen(null);
    setActionReason('');
    openDetail(selected.id);
    load();
  }

  async function handleSuspend() {
    if (!selected) return;
    await api.post(`/admin/users/${selected.id}/suspend`, { reason: actionReason });
    setActionOpen(null);
    setActionReason('');
    openDetail(selected.id);
    load();
  }

  async function handleReactivate() {
    if (!selected) return;
    await api.post(`/admin/users/${selected.id}/reactivate`, {});
    openDetail(selected.id);
    load();
  }

  async function handleMuteChat() {
    if (!selected) return;
    await api.post(`/admin/users/${selected.id}/mute-chat`, { reason: actionReason, category: 'chat_abuse' });
    setActionOpen(null);
    setActionReason('');
    openDetail(selected.id);
    load();
  }

  async function handleUnmuteChat() {
    if (!selected) return;
    await api.post(`/admin/users/${selected.id}/unmute-chat`, {});
    openDetail(selected.id);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Users</h1>
        <div className="flex gap-3">
          <input className="input w-64" placeholder="Search email or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="banned">Banned</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Panel className="col-span-2" title={`${users.length} users`}>
          {loading ? (
            <LoadingRow />
          ) : users.length === 0 ? (
            <EmptyState message="No users match this filter." />
          ) : (
            <table className="-m-5 w-[calc(100%+2.5rem)]">
              <thead>
                <tr>
                  <th className="th">Email</th>
                  <th className="th">Status</th>
                  <th className="th">KYC</th>
                  <th className="th">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} onClick={() => openDetail(u.id)} className="cursor-pointer hover:bg-surface-raised/50">
                    <td className="td">
                      <div>{u.email}</div>
                      {u.fullName && <div className="text-xs text-ink-faint">{u.fullName}</div>}
                    </td>
                    <td className="td">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="td">
                      <Badge tone={u.kycStatus === 'verified' ? 'gain' : 'default'}>{u.kycStatus}</Badge>
                    </td>
                    <td className="td text-ink-muted font-mono text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Detail">
          {!selected ? (
            <EmptyState message="Select a user to view details." />
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-ink font-medium">{selected.email}</div>
                <div className="text-xs text-ink-faint">{selected.id}</div>
              </div>

              <div className="flex gap-2">
                <StatusBadge status={selected.status} />
                <Badge tone={selected.kycStatus === 'verified' ? 'gain' : 'default'}>{selected.kycStatus}</Badge>
                <Badge>{selected.role}</Badge>
              </div>

              {selected.statusReason && (
                <div className="text-xs text-ink-muted bg-surface-raised rounded p-2">
                  <span className="text-ink-faint">Reason: </span>
                  {selected.statusReason}
                </div>
              )}

              {selected.wallet && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <MiniStat label="Available" value={selected.wallet.availableBalance} />
                  <MiniStat label="Locked" value={selected.wallet.lockedBalance} />
                  <MiniStat label="Pending" value={selected.wallet.pendingBalance} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <MiniRow label="Games played" value={selected.gamesPlayed} />
                <MiniRow label="Open fraud signals" value={selected.openFraudSignals} warn={selected.openFraudSignals > 0} />
                <MiniRow label="Anti-cheat flags" value={selected.anticheatFlags} warn={selected.anticheatFlags > 0} />
                <MiniRow label="Open tickets" value={selected.openTickets} />
                <MiniRow label="Pending KYC docs" value={selected.pendingKycDocuments} warn={selected.pendingKycDocuments > 0} />
              </div>

              <div className="text-xs space-y-1">
                <div className="flex items-center justify-between bg-surface-raised rounded px-2 py-1.5">
                  <span className="text-ink-faint">Age</span>
                  <span className="font-mono text-ink">{selected.dateOfBirth ? computeAge(selected.dateOfBirth) : 'not provided'}</span>
                </div>
                <div className="flex items-center justify-between bg-surface-raised rounded px-2 py-1.5">
                  <span className="text-ink-faint">Platform rules</span>
                  {selected.hasAcceptedCurrentRules ? (
                    <Badge tone="gain">accepted {new Date(selected.rulesAcceptedAt!).toLocaleDateString()}</Badge>
                  ) : (
                    <Badge tone="warn">not accepted</Badge>
                  )}
                </div>
                {selected.chatMutedUntil && new Date(selected.chatMutedUntil) > new Date() && (
                  <div className="flex items-center justify-between bg-surface-raised rounded px-2 py-1.5">
                    <span className="text-ink-faint">Chat restricted until</span>
                    <span className="font-mono text-warn">{new Date(selected.chatMutedUntil).toLocaleString()}</span>
                  </div>
                )}
              </div>

              {can('finance_admin', 'super_admin') && (
                <div className="pt-3 border-t border-border space-y-2">
                  {selected.status === 'active' ? (
                    <div className="flex flex-wrap gap-2">
                      <Button tone="danger" onClick={() => setActionOpen('ban')}>
                        Ban
                      </Button>
                      <Button onClick={() => setActionOpen('suspend')}>Suspend</Button>
                      {selected.chatMutedUntil && new Date(selected.chatMutedUntil) > new Date() ? (
                        <Button onClick={handleUnmuteChat}>Unmute Chat</Button>
                      ) : (
                        <Button onClick={() => setActionOpen('mute')}>Mute Chat</Button>
                      )}
                    </div>
                  ) : (
                    <Button tone="brass" onClick={handleReactivate}>
                      Reactivate
                    </Button>
                  )}

                  {actionOpen && (
                    <div className="space-y-2 pt-2">
                      <textarea
                        className="input"
                        placeholder="Reason (required, visible in the audit log)"
                        value={actionReason}
                        onChange={(e) => setActionReason(e.target.value)}
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <Button
                          tone="danger"
                          disabled={actionReason.length < 5}
                          onClick={actionOpen === 'ban' ? handleBan : actionOpen === 'suspend' ? handleSuspend : handleMuteChat}
                        >
                          Confirm {actionOpen === 'mute' ? 'mute' : actionOpen}
                        </Button>
                        <Button onClick={() => setActionOpen(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function computeAge(dateOfBirthIso: string): number {
  const dob = new Date(dateOfBirthIso);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getUTCMonth() > dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() >= dob.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

function StatusBadge({ status }: { status: string }) {
  const tone: 'gain' | 'loss' | 'warn' = status === 'active' ? 'gain' : status === 'banned' ? 'loss' : 'warn';
  return <Badge tone={tone}>{status}</Badge>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-raised rounded p-2">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="font-mono text-sm">${Number(value).toFixed(2)}</div>
    </div>
  );
}

function MiniRow({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between bg-surface-raised rounded px-2 py-1.5">
      <span className="text-ink-faint">{label}</span>
      <span className={`font-mono ${warn ? 'text-warn' : 'text-ink'}`}>{value}</span>
    </div>
  );
}
