import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const run=promisify(execFile);
/** Browsers record WebM; WhatsApp's official API accepts Ogg/Opus instead. */
export async function normalizeRecordedAudio(bytes:Buffer):Promise<Buffer>{
 const directory=await mkdtemp(path.join(tmpdir(),"nexo-audio-"));
 try{const input=path.join(directory,"recording.webm"),output=path.join(directory,"recording.ogg");await writeFile(input,bytes,{mode:0o600});await run("ffmpeg",["-nostdin","-v","error","-i",input,"-vn","-c:a","libopus","-ac","1","-b:a","32k","-fs","26214400",output],{timeout:30000,maxBuffer:16384});const result=await readFile(output);if(result.length>25*1024*1024||result.subarray(0,4).toString()!=="OggS")throw Error("Áudio inválido.");return result;}finally{await rm(directory,{recursive:true,force:true});}
}
