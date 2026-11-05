"use client";

import React, { useState } from "react";
import { chatFileDownload, chatFileName, chatFileSize } from "@/lib/chat-attachments";
import type { ChatMessage } from "@/lib/conversations";

type Message = Pick<ChatMessage, "content" | "role" | "type" | "mediaUrl" | "fileName" | "mimeType" | "fileSize">;

export function chatMediaSource(value?: string): string | null {
  if (!value || !value.trim() || value.startsWith("//") || !/^(?:\/|https?:\/\/)/i.test(value)) return null;
  try {
    const url = new URL(value, "https://nexo.invalid");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    // Older messages can point to a previous application hostname. Local media
    // stays behind the same authenticated media routes after a domain change.
    if (/^\/api\/(?:media|uploads)\/[^/]+$/.test(url.pathname)) return url.pathname + url.search;
    return value.startsWith("/") ? url.pathname + url.search : url.toString();
  } catch { return null; }
}

export function ChatMessageContent({ message, onReady }: { message: Message; onReady?: () => void }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const legacyDocument = /^\[(?:Documento|Arquivo)(?::\s*([^\]]+))?\]$/i.exec(message.content.trim());
  const isDocument = message.type === "document" || (!message.type && !!legacyDocument);
  const isMedia = message.type === "image" || message.type === "audio" || isDocument;
  const source = chatMediaSource(message.mediaUrl || (isMedia ? message.content : undefined));
  const caption = message.content && !/^\[[^\]]*\]$/.test(message.content.trim()) && message.content !== message.mediaUrl && !(isMedia && source && chatMediaSource(message.content) === source) ? message.content : "";
  if (isDocument) {
    const fileName = chatFileName(message.fileName || legacyDocument?.[1]);
    const pdf = message.mimeType === "application/pdf" || /\.pdf(?:\?|$)/i.test(source || "") || /\.pdf$/i.test(fileName);
    const size = chatFileSize(message.fileSize);
    return <div className="nexo-message-content">
      <div className="nexo-message-file">
        <span className="nexo-message-file-icon" aria-hidden="true">{pdf ? "PDF" : "ARQ"}</span>
        <div className="nexo-message-file-details"><strong>{fileName}</strong><span>{[pdf ? "Documento PDF" : "Arquivo", size].filter(Boolean).join(" · ")}</span></div>
        {source ? <div className="nexo-message-file-actions">
          {pdf && <a href={source} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Abrir PDF ${fileName}`}>Abrir PDF ↗</a>}
          <a href={chatFileDownload(source, fileName)} download={fileName} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Baixar ${fileName}`}>Baixar ↓</a>
        </div> : <p className="nexo-message-file-missing" role="status">O arquivo não foi salvo neste histórico ou ultrapassou o limite de 25 MB.</p>}
      </div>
      {caption && <p className="whitespace-pre-wrap break-words leading-relaxed">{caption}</p>}
    </div>;
  }
  if (!isMedia) return <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>;
  const label = message.type === "image" ? "Imagem" : "Áudio";
  return <div className="nexo-message-content">
    {source && !failed ? message.type === "image" ? (
      <a href={source} target="_blank" rel="noopener noreferrer" className="nexo-message-image-link" aria-label="Abrir imagem em tamanho original">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={`${source}:${attempt}`} src={source} alt={`Imagem ${message.role === "assistant" ? "enviada" : "recebida"}`} loading="lazy" referrerPolicy="no-referrer" onLoad={onReady} onError={() => setFailed(true)} className="nexo-message-image" />
      </a>
    ) : <audio key={`${source}:${attempt}`} controls preload="none" src={source} aria-label={`Áudio ${message.role === "assistant" ? "enviado" : "recebido"}`} onLoadedMetadata={onReady} onError={() => setFailed(true)} className="nexo-message-audio" /> : (
      <div className="nexo-message-unavailable" role="status">
        <p>{label} indisponível{source ? ". O arquivo pode ter expirado." : ": o arquivo não foi salvo no histórico."}</p>
        {source && <button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Tentar carregar</button>}
      </div>
    )}
    {caption && <p className="whitespace-pre-wrap break-words leading-relaxed">{caption}</p>}
  </div>;
}
