"use client";

import { useState, useEffect, useCallback } from "react";
import { clsx } from "clsx";

type ChecklistOwner = "gestor" | "cliente";
type ChecklistTask = {
  id: string;
  clientId: string;
  title: string;
  dueDate?: string;
  owner: ChecklistOwner;
  done: boolean;
  doneAt?: string;
  createdBy: "manager" | "client";
  createdAt: string;
};
type ClientGroup = { clientId: string; clientName: string; tasks: ChecklistTask[] };

type Props = {
  mode?: "single-client" | "all-clients";
  fetchUrl: string;
  apiBase: string; // "/api/cliente/checklist" ou "/api/gestor/checklist" — base pra POST/PUT/DELETE
  clientId?: string; // obrigatório no modo single-client
};

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function isOverdue(task: ChecklistTask) {
  if (!task.dueDate || task.done) return false;
  return new Date(task.dueDate).getTime() < new Date().setHours(0, 0, 0, 0);
}

function TaskRow({ task, apiBase, onChanged }: { task: ChecklistTask; apiBase: string; onChanged: (t: ChecklistTask | null) => void }) {
  const [busy, setBusy] = useState(false);
  const overdue = isOverdue(task);

  async function toggleDone() {
    setBusy(true);
    const res = await fetch(`${apiBase}/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !task.done }),
    });
    if (res.ok) onChanged(await res.json());
    setBusy(false);
  }

  async function remove() {
    if (!confirm("Excluir esta tarefa?")) return;
    setBusy(true);
    const res = await fetch(`${apiBase}/${task.id}`, { method: "DELETE" });
    if (res.ok) onChanged(null);
    setBusy(false);
  }

  return (
    <div className={clsx("flex items-start gap-2 rounded-lg border px-3 py-2 bg-white", overdue ? "border-red-200" : "border-slate-200")}>
      <button
        onClick={toggleDone}
        disabled={busy}
        title={task.done ? "Marcar como pendente" : "Marcar como concluída"}
        className={clsx(
          "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold shrink-0 mt-0.5",
          task.done ? "border-emerald-300 bg-emerald-100 text-emerald-700" : "border-slate-300 text-slate-300 hover:border-indigo-400"
        )}
      >
        ✓
      </button>
      <div className="flex-1 min-w-0">
        <p className={clsx("text-sm text-slate-700", task.done && "line-through text-slate-400")}>{task.title}</p>
        {task.dueDate && (
          <p className={clsx("text-[11px] font-medium mt-0.5", overdue ? "text-red-600" : "text-slate-400")}>
            {overdue ? "⚠️ venceu em " : "até "}{fmtDate(task.dueDate)}
          </p>
        )}
      </div>
      <button onClick={remove} disabled={busy} title="Excluir" className="text-slate-300 hover:text-red-500 shrink-0">🗑</button>
    </div>
  );
}

function AddTaskForm({ apiBase, clientId, owner, onAdded }: { apiBase: string; clientId?: string; owner: ChecklistOwner; onAdded: (t: ChecklistTask) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!title.trim()) return;
    setSaving(true);
    const res = await fetch(apiBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), dueDate: dueDate || undefined, owner, clientId }),
    });
    if (res.ok) {
      onAdded(await res.json());
      setTitle(""); setDueDate(""); setOpen(false);
    }
    setSaving(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
        + Nova tarefa
      </button>
    );
  }

  return (
    <div className="space-y-2 bg-indigo-50 rounded-lg border border-indigo-100 p-2.5">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="O que precisa ser feito?"
        autoFocus
        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
      />
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
      />
      <div className="flex gap-2">
        <button onClick={submit} disabled={!title.trim() || saving} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          {saving ? "Salvando..." : "Adicionar"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancelar</button>
      </div>
    </div>
  );
}

function OwnerColumn({ title, tasks, apiBase, clientId, owner, onTaskChanged, onTaskAdded }: {
  title: string;
  tasks: ChecklistTask[];
  apiBase: string;
  clientId?: string;
  owner: ChecklistOwner;
  onTaskChanged: (id: string, t: ChecklistTask | null) => void;
  onTaskAdded: (t: ChecklistTask) => void;
}) {
  const done = tasks.filter((t) => t.done).length;
  return (
    <div className="flex-1 min-w-[260px] space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">{title}</p>
        <span className="text-[11px] text-slate-400">{done}/{tasks.length}</span>
      </div>
      <div className="space-y-1.5">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} apiBase={apiBase} onChanged={(updated) => onTaskChanged(t.id, updated)} />
        ))}
        {tasks.length === 0 && <p className="text-xs text-slate-400 italic">Nenhuma tarefa.</p>}
      </div>
      <AddTaskForm apiBase={apiBase} clientId={clientId} owner={owner} onAdded={onTaskAdded} />
    </div>
  );
}

function ClientChecklistSection({ tasks, clientId, clientName, apiBase, onChanged }: {
  tasks: ChecklistTask[];
  clientId: string;
  clientName?: string;
  apiBase: string;
  onChanged: (tasks: ChecklistTask[]) => void;
}) {
  function handleTaskChanged(id: string, updated: ChecklistTask | null) {
    onChanged(updated ? tasks.map((t) => (t.id === id ? updated : t)) : tasks.filter((t) => t.id !== id));
  }
  function handleTaskAdded(t: ChecklistTask) {
    onChanged([...tasks, t]);
  }

  const totalDone = tasks.filter((t) => t.done).length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        {clientName && <p className="text-sm font-bold text-slate-800">{clientName}</p>}
        <span className="text-xs text-slate-400">{totalDone} de {tasks.length} concluídas</span>
      </div>
      {tasks.length > 0 && (
        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-emerald-400 transition-all" style={{ width: `${tasks.length ? (totalDone / tasks.length) * 100 : 0}%` }} />
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-5">
        <OwnerColumn
          title="Tarefas do Gestor"
          tasks={tasks.filter((t) => t.owner === "gestor")}
          apiBase={apiBase}
          clientId={clientId}
          owner="gestor"
          onTaskChanged={handleTaskChanged}
          onTaskAdded={handleTaskAdded}
        />
        <OwnerColumn
          title="Tarefas do Cliente"
          tasks={tasks.filter((t) => t.owner === "cliente")}
          apiBase={apiBase}
          clientId={clientId}
          owner="cliente"
          onTaskChanged={handleTaskChanged}
          onTaskAdded={handleTaskAdded}
        />
      </div>
    </div>
  );
}

export function ChecklistBoard({ mode = "single-client", fetchUrl, apiBase, clientId }: Props) {
  const [tasks, setTasks] = useState<ChecklistTask[] | null>(null);
  const [groups, setGroups] = useState<ClientGroup[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(fetchUrl);
      if (!res.ok) return;
      const data = await res.json();
      if (mode === "all-clients") setGroups(data.clients ?? []);
      else setTasks(data.tasks ?? []);
    } catch { /* mantém último estado conhecido em caso de falha de rede */ }
  }, [fetchUrl, mode]);

  useEffect(() => { load(); }, [load]);

  if (mode === "all-clients") {
    if (groups === null) return null;
    if (groups.length === 0) {
      return <p className="text-sm text-slate-400 italic">Nenhuma tarefa cadastrada em nenhum cliente ainda.</p>;
    }
    return (
      <div className="space-y-5">
        {groups.map((g) => (
          <ClientChecklistSection
            key={g.clientId}
            tasks={g.tasks}
            clientId={g.clientId}
            clientName={g.clientName}
            apiBase={apiBase}
            onChanged={(updated) => setGroups((prev) => prev!.map((x) => (x.clientId === g.clientId ? { ...x, tasks: updated } : x)))}
          />
        ))}
      </div>
    );
  }

  if (tasks === null) return null;
  return (
    <ClientChecklistSection
      tasks={tasks}
      clientId={clientId ?? ""}
      apiBase={apiBase}
      onChanged={setTasks}
    />
  );
}
