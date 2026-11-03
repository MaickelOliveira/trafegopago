export function matchesUploadType(extension: string, data: Buffer): boolean {
  const starts = (hex: string) => data.subarray(0, hex.length / 2).equals(Buffer.from(hex, "hex"));
  if ([".jpg", ".jpeg"].includes(extension)) return starts("ffd8ff");
  if (extension === ".png") return starts("89504e470d0a1a0a");
  if (extension === ".gif") return ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString());
  if (extension === ".webp") return data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP";
  if(extension===".webm")return starts("1a45dfa3");
  if(extension===".ogg")return data.subarray(0,4).toString()==="OggS";
  if(extension===".mp3")return data.subarray(0,3).toString()==="ID3"||(data[0]===255&&(data[1]&224)===224);
  if (extension === ".mp4" || extension === ".m4a") return data.subarray(4, 8).toString() === "ftyp";
  if (extension === ".pdf") return data.subarray(0, 5).toString() === "%PDF-";
  if (extension === ".doc") return starts("d0cf11e0a1b11ae1");
  if ([".docx", ".xlsx"].includes(extension)) return starts("504b0304");
  return false;
}
