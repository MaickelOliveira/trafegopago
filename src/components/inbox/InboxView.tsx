"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  ts: number;
  type?: "text" | "audio" | "image";
  mediaUrl?: string;
};

type Conversation = {
  phone: string;
  contactName: string | null;
  connId: string | null;
  lastMessage: ChatMessage | null;
  lastActivity: number;
  unread: boolean;
};

type Connection = {
  id: string;
  phone: string;
  type: string;
};

interface Props {
  clientId: string;
  initialConversations?: Conversation[];
  initialConnections?: Connection[];
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDate.getTime() === today.getTime()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  const diff = Math.floor((today.getTime() - msgDate.getTime()) / 86400000);
  if (diff === 1) return "Ontem";
  if (diff < 7) return d.toLocaleDateString("pt-BR", { weekday: "short" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatFullTime(ts: number) {
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  });
}

function displayPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  return phone;
}

export default function InboxView({ clientId, initialConversations = [], initialConnections = [] }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [connections, setConnections] = useState<Connection[]>(initialConnections);
  const [selectedConn, setSelectedConn] = useState<string | null>(
    initialConnections.length > 0 ? initialConnections[0].id : null
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [search, setSearch] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedConv = conversations.find((c) => c.phone === selected);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/inbox/conversations?clientId=${encodeURIComponent(clientId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations ?? []);
      if (data.connections && data.connections.length > 0) {
        setConnections(data.connections);
        // Se ainda não tem nenhum selecionado, seleciona o primeiro
        setSelectedConn((prev) => prev ?? data.connections[0].id);
      }
    } catch {}
  }, [clientId]);

  useEffect(() => {
    fetchConversations();
    pollRef.current = setInterval(fetchConversations, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchConversations]);

  const fetchMessages = useCallback(async (phone: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/whatsapp/inbox/messages?phone=${encodeURIComponent(phone)}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
      setConversations((prev) => prev.map((c) => c.phone === phone ? { ...c, unread: false } : c));
    } catch {} finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    fetchMessages(selected);
    msgPollRef.current = setInterval(() => fetchMessages(selected), 3000);
    return () => { if (msgPollRef.current) clearInterval(msgPollRef.current); };
  }, [selected, fetchMessages]);

  // Quando muda de conexão, deseleciona conversa atual se ela não pertence à nova conexão
  useEffect(() => {
    if (selected) {
      const conv = conversations.find((c) => c.phone === selected);
      if (conv && conv.connId && conv.connId !== selectedConn) {
        setSelected(null);
        setMessages([]);
      }
    }
  }, [selectedConn, selected, conversations]);

  const handleSelect = (phone: string) => {
    setSelected(phone);
    setText("");
  };

  const handleSend = async () => {
    if (!text.trim() || !selected || sending) return;
    setSending(true);
    const t = text.trim();
    setText("");

    const optimistic: ChatMessage = { role: "assistant", content: t, ts: Date.now(), type: "text" };
    setMessages((prev) => [...prev, optimistic]);

    try {
      await fetch("/api/whatsapp/inbox/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: selected,
          content: t,
          type: "text",
          clientId,
          connId: selectedConv?.connId ?? selectedConn ?? undefined,
        }),
      });
    } catch {} finally {
      setSending(false);
      fetchMessages(selected);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm;codecs=opus" });
        await sendAudio(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      alert("Não foi possível acessar o microfone");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const sendAudio = async (blob: Blob) => {
    if (!selected) return;
    setSending(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const optimistic: ChatMessage = { role: "assistant", content: "[áudio]", ts: Date.now(), type: "audio" };
      setMessages((prev) => [...prev, optimistic]);

      await fetch("/api/whatsapp/inbox/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: selected,
          content: `data:audio/ogg;base64,${base64}`,
          type: "audio",
          clientId,
          connId: selectedConv?.connId ?? selectedConn ?? undefined,
        }),
      });
    } catch {} finally {
      setSending(false);
      if (selected) fetchMessages(selected);
    }
  };

  // Filtra por conexão selecionada e busca — filtragem estrita pelo connId
  const connConversations = conversations.filter((c) => {
    // Só mostra conversas que pertencem exatamente à conexão selecionada
    if (c.connId !== selectedConn) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (c.contactName ?? c.phone).toLowerCase().includes(s) || c.phone.includes(s);
  });

  const unreadForConn = (connId: string) =>
    conversations.filter((c) => c.unread && c.connId === connId).length;

  const totalUnread = conversations.filter((c) => c.unread).length;

  const activeConn = connections.find((c) => c.id === selectedConn);

  return (
    <div className="flex h-full bg-[#111b21] text-white overflow-hidden">
      {/* ── Sidebar esquerda ── */}
      <div className="w-[340px] min-w-[260px] flex flex-col border-r border-[#2a3942] bg-[#111b21]">
        {/* Header sidebar */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#202c33]">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-base">Mensagens</span>
            {totalUnread > 0 && (
              <span className="bg-[#00a884] text-black text-xs font-bold px-2 py-0.5 rounded-full">
                {totalUnread}
              </span>
            )}
          </div>
        </div>

        {/* ── Seletor de número (tabs) ── */}
        {connections.length > 0 && (
          <div className="bg-[#111b21] border-b border-[#2a3942] overflow-x-auto">
            <div className="flex gap-0 min-w-max">
              {connections.map((conn) => {
                const isActive = conn.id === selectedConn;
                const unread = unreadForConn(conn.id);
                const label = conn.phone ? displayPhone(conn.phone) : conn.id;
                return (
                  <button
                    key={conn.id}
                    onClick={() => { setSelectedConn(conn.id); setSelected(null); setMessages([]); }}
                    className={`flex flex-col items-center px-3 py-2 text-xs border-b-2 transition-colors whitespace-nowrap gap-0.5 ${
                      isActive
                        ? "border-[#00a884] text-[#00a884] bg-[#1a2a30]"
                        : "border-transparent text-[#8696a0] hover:text-[#d1d7db] hover:bg-[#1a2530]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px]">{conn.type === "meta" ? "🔵" : "🟢"}</span>
                      <span className="font-medium">{label}</span>
                      {unread > 0 && (
                        <span className="w-4 h-4 bg-[#00a884] rounded-full text-[9px] text-black font-bold flex items-center justify-center">
                          {unread > 9 ? "9+" : unread}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Busca */}
        <div className="px-3 py-2 bg-[#111b21]">
          <div className="flex items-center bg-[#202c33] rounded-lg px-3 py-1.5 gap-2">
            <svg className="text-[#8696a0] w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Pesquisar conversa"
              className="bg-transparent text-sm outline-none w-full text-[#d1d7db] placeholder:text-[#8696a0]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Lista de conversas */}
        <div className="flex-1 overflow-y-auto">
          {connConversations.length === 0 && (
            <div className="text-[#8696a0] text-sm text-center mt-10 px-4">
              Nenhuma conversa encontrada.
              <br /><span className="text-xs">As mensagens aparecerão aqui quando seus contatos enviarem mensagens via WhatsApp.</span>
            </div>
          )}
          {connConversations.map((conv) => {
            const isActive = conv.phone === selected;
            const name = conv.contactName || displayPhone(conv.phone);
            const preview = conv.lastMessage
              ? conv.lastMessage.type === "audio"
                ? "🎵 Áudio"
                : conv.lastMessage.type === "image"
                  ? "📷 Imagem"
                  : conv.lastMessage.content.slice(0, 60)
              : "";
            return (
              <button
                key={conv.phone}
                onClick={() => handleSelect(conv.phone)}
                className={`w-full text-left flex items-center px-3 py-3 border-b border-[#2a3942] hover:bg-[#2a3942] transition-colors ${isActive ? "bg-[#2a3942]" : ""}`}
              >
                <div className="w-10 h-10 rounded-full bg-[#6b7280] flex items-center justify-center text-white font-semibold text-sm shrink-0 mr-3">
                  {name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-medium text-sm text-[#e9edef] truncate">{name}</span>
                    <span className="text-xs text-[#8696a0] ml-2 shrink-0">
                      {conv.lastMessage ? formatTime(conv.lastMessage.ts) : formatTime(conv.lastActivity)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#8696a0] truncate flex-1 mr-2">
                      {conv.lastMessage?.role === "assistant" && <span className="text-[#53bdeb] mr-1">✓✓</span>}
                      {preview || <span className="italic">Sem mensagens</span>}
                    </span>
                    {conv.unread && (
                      <span className="w-5 h-5 bg-[#00a884] rounded-full shrink-0 flex items-center justify-center text-[10px] text-black font-bold">
                        ●
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Área direita (chat) ── */}
      {!selected ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-[#222e35] gap-4">
          <div className="w-20 h-20 rounded-full bg-[#374248] flex items-center justify-center">
            <svg className="w-10 h-10 text-[#8696a0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-[#d1d7db] font-light text-xl">Selecione uma conversa</p>
            {activeConn && (
              <p className="text-[#8696a0] text-sm mt-1">
                Número: <span className="text-[#00a884]">{displayPhone(activeConn.phone || activeConn.id)}</span>
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col bg-[#0b141a] relative">
          {/* Header do chat */}
          <div className="flex items-center gap-3 px-4 py-3 bg-[#202c33] border-b border-[#2a3942]">
            <div className="w-10 h-10 rounded-full bg-[#6b7280] flex items-center justify-center text-white font-semibold text-sm">
              {(selectedConv?.contactName || displayPhone(selected)).charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-medium text-sm text-[#e9edef]">
                {selectedConv?.contactName || displayPhone(selected)}
              </p>
              <p className="text-xs text-[#8696a0]">{displayPhone(selected)}</p>
            </div>
            {activeConn && (
              <div className="ml-auto flex items-center gap-1.5 text-xs text-[#8696a0] bg-[#2a3942] rounded-full px-3 py-1">
                <span>{activeConn.type === "meta" ? "🔵" : "🟢"}</span>
                <span>{displayPhone(activeConn.phone || activeConn.id)}</span>
              </div>
            )}
          </div>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-1">
            {loadingMessages && (
              <div className="text-center text-[#8696a0] text-sm py-4">Carregando...</div>
            )}
            {!loadingMessages && messages.length === 0 && (
              <div className="text-center text-[#8696a0] text-sm py-4">Nenhuma mensagem ainda.</div>
            )}
            {messages.map((msg, i) => {
              const isMe = msg.role === "assistant";
              return (
                <div key={i} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[70%] px-3 py-2 rounded-lg text-sm shadow relative ${isMe ? "bg-[#005c4b] text-[#e9edef] rounded-br-none" : "bg-[#202c33] text-[#e9edef] rounded-bl-none"}`}
                  >
                    {msg.type === "audio" ? (
                      <div className="flex items-center gap-2 text-[#8696a0]">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
                        </svg>
                        <span className="italic text-xs">Áudio</span>
                      </div>
                    ) : msg.type === "image" ? (
                      <span className="italic text-xs text-[#8696a0]">📷 Imagem</span>
                    ) : (
                      <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                    )}
                    <div className={`text-[10px] mt-1 text-right ${isMe ? "text-[#8fcbbf]" : "text-[#8696a0]"}`}>
                      {formatFullTime(msg.ts)}
                      {isMe && <span className="ml-1 text-[#53bdeb]">✓✓</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div className="flex items-end gap-2 px-3 py-3 bg-[#202c33]">
            <div className="flex-1 bg-[#2a3942] rounded-lg px-4 py-2 flex items-end">
              <textarea
                className="flex-1 bg-transparent resize-none outline-none text-sm text-[#d1d7db] placeholder:text-[#8696a0] max-h-32 min-h-[36px]"
                placeholder="Digite uma mensagem"
                value={text}
                onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }}
                onKeyDown={handleKeyDown}
                rows={1}
              />
            </div>

            {text.trim() ? (
              <button
                onClick={handleSend}
                disabled={sending}
                className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center hover:bg-[#06cf9c] transition-colors disabled:opacity-50 shrink-0"
              >
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            ) : (
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shrink-0 ${recording ? "bg-red-500 animate-pulse" : "bg-[#00a884] hover:bg-[#06cf9c]"}`}
                title={recording ? "Solte para enviar" : "Segure para gravar áudio"}
              >
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
