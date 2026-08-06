import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Panel, Badge, Button, LoadingRow, EmptyState } from '../components/ui';

interface TicketRow {
  id: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  createdAt: string;
  user: { email: string };
}

interface TicketDetail extends TicketRow {
  messages: { id: string; senderType: string; message: string; createdAt: string }[];
}

export function SupportPage() {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('open');
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState('');

  function load() {
    setLoading(true);
    api
      .get('/admin/support/tickets', { params: { status: statusFilter || undefined } })
      .then(({ data }) => setTickets(data))
      .finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter]);

  function openTicket(id: string) {
    api.get(`/admin/support/tickets/${id}`).then(({ data }) => setSelected(data));
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    await api.post(`/admin/support/tickets/${selected.id}/reply`, { message: reply });
    setReply('');
    openTicket(selected.id);
    load();
  }

  async function resolve() {
    if (!selected) return;
    await api.post(`/admin/support/tickets/${selected.id}/resolve`);
    openTicket(selected.id);
    load();
  }

  async function close() {
    if (!selected) return;
    await api.post(`/admin/support/tickets/${selected.id}/close`);
    openTicket(selected.id);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Support Tickets</h1>
        <select className="input w-48" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Panel className="col-span-1" title={`${tickets.length} tickets`}>
          {loading ? (
            <LoadingRow />
          ) : tickets.length === 0 ? (
            <EmptyState message="No tickets match this filter." />
          ) : (
            <div className="-m-5 divide-y divide-border-soft">
              {tickets.map((t) => (
                <div key={t.id} onClick={() => openTicket(t.id)} className="p-4 cursor-pointer hover:bg-surface-raised/50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate">{t.subject}</span>
                    <PriorityBadge priority={t.priority} />
                  </div>
                  <div className="text-xs text-ink-faint">{t.user.email}</div>
                  <Badge tone={t.status === 'open' ? 'warn' : t.status === 'resolved' || t.status === 'closed' ? 'default' : 'info'}>
                    {t.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="col-span-2" title={selected ? selected.subject : 'Thread'}>
          {!selected ? (
            <EmptyState message="Select a ticket to view the conversation." />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge>{selected.category}</Badge>
                <PriorityBadge priority={selected.priority} />
                <Badge tone={selected.status === 'open' ? 'warn' : 'default'}>{selected.status}</Badge>
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                {selected.messages.map((m) => (
                  <div key={m.id} className={`p-3 rounded ${m.senderType === 'admin' ? 'bg-brass/10 ml-8' : 'bg-surface-raised mr-8'}`}>
                    <div className="text-xs text-ink-faint mb-1">
                      {m.senderType === 'admin' ? 'Admin' : 'User'} · {new Date(m.createdAt).toLocaleString()}
                    </div>
                    <div className="text-sm whitespace-pre-wrap">{m.message}</div>
                  </div>
                ))}
              </div>

              {selected.status !== 'closed' && (
                <div className="space-y-2 pt-3 border-t border-border">
                  <textarea className="input" rows={3} placeholder="Type a reply…" value={reply} onChange={(e) => setReply(e.target.value)} />
                  <div className="flex gap-2">
                    <Button tone="brass" onClick={sendReply}>
                      Send Reply
                    </Button>
                    <Button onClick={resolve}>Mark Resolved</Button>
                    <Button tone="danger" onClick={close}>
                      Close Ticket
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const tone: 'loss' | 'warn' | 'default' = priority === 'urgent' ? 'loss' : priority === 'high' ? 'warn' : 'default';
  return <Badge tone={tone}>{priority}</Badge>;
}
