import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chatMediaSource, ChatMessageContent } from "../../components/shared/ChatMessageContent";

describe("media displayed in conversations", () => {
  it("keeps app media on authenticated routes after a hostname change", () => {
    expect(chatMediaSource("https://previous.example/api/media/voice.ogg?expires=123&signature=abc")).toBe("/api/media/voice.ogg?expires=123&signature=abc");
    expect(chatMediaSource("/api/uploads/image.png")).toBe("/api/uploads/image.png");
  });
  it("allows HTTPS provider media and rejects executable or credential URLs", () => {
    expect(chatMediaSource("https://media.example/image.png")).toBe("https://media.example/image.png");
    for (const url of ["javascript:alert(1)","data:text/html,test","//untrusted.example/image.png","https://user:password@example.com/a","[áudio]","Transcrição do áudio"]) expect(chatMediaSource(url)).toBeNull();
  });
  it("renders an audio player and preserves its transcript", () => {
    const html = renderToStaticMarkup(createElement(ChatMessageContent, {message:{role:"user",type:"audio",mediaUrl:"/api/media/voice.ogg",content:"Quero as duas opções."}}));
    expect(html).toContain("<audio"); expect(html).toContain('src="/api/media/voice.ogg"'); expect(html).toContain("Quero as duas opções.");
  });
  it("renders an image with a caption and an honest unavailable state", () => {
    const html = renderToStaticMarkup(createElement(ChatMessageContent, {message:{role:"user",type:"image",mediaUrl:"/api/media/photo.png",content:"Foto da medida"}}));
    expect(html).toContain("<img"); expect(html).toContain("Foto da medida");
    const missing = renderToStaticMarkup(createElement(ChatMessageContent, {message:{role:"user",type:"audio",content:"Transcrição preservada"}}));
    expect(missing).toContain("o arquivo não foi salvo"); expect(missing).toContain("Transcrição preservada");
  });
  it("shows a PDF with its name, size and authenticated open/download links", () => {
    const html = renderToStaticMarkup(createElement(ChatMessageContent, {message:{role:"user",type:"document",fileName:"Orçamento.pdf",mimeType:"application/pdf",fileSize:2048,mediaUrl:"/api/media/fixture.pdf?expires=123&signature=abc",content:"Confira as medidas"}}));
    expect(html).toContain("Orçamento.pdf"); expect(html).toContain("2 KB"); expect(html).toContain("Abrir PDF"); expect(html).toContain("download=1"); expect(html).toContain("signature=abc"); expect(html).toContain("Confira as medidas");
  });
  it("downloads other files without executing or embedding their contents", () => {
    const html = renderToStaticMarkup(createElement(ChatMessageContent, {message:{role:"assistant",type:"document",fileName:"Planilha.xlsx",mediaUrl:"/api/media/fixture.bin",content:"[Documento]"}}));
    expect(html).toContain("Planilha.xlsx"); expect(html).toContain("Baixar"); expect(html).not.toContain("<iframe"); expect(html).not.toContain("<object"); expect(html).not.toContain("Abrir PDF");
  });
  it("explains missing historical documents and refuses executable links", () => {
    const html = renderToStaticMarkup(createElement(ChatMessageContent, {message:{role:"user",type:"document",fileName:"Pedido.pdf",mediaUrl:"javascript:alert(1)",content:"[Documento]"}}));
    expect(html).toContain("O arquivo não foi salvo"); expect(html).not.toContain("href=");
    const old = renderToStaticMarkup(createElement(ChatMessageContent, {message:{role:"user",content:"[Documento: Pedido.pdf]"}}));
    expect(old).toContain("Pedido.pdf"); expect(old).toContain("O arquivo não foi salvo");
  });
});
