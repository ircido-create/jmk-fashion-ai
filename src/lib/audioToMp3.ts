// Converte gravações do navegador (webm/ogg/mp4) para MP3 mono 128kbps.
// Meta WhatsApp aceita audio/mpeg em todos os números — formato mais confiável.
import { Mp3Encoder } from "@breezystack/lamejs";

export async function convertToMp3(blob: Blob): Promise<Blob> {
  // @ts-expect-error - webkit prefix em Safari
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  // Mixa para mono (média dos canais)
  const channels = decoded.numberOfChannels;
  const len = decoded.length;
  const mono = new Float32Array(len);
  for (let ch = 0; ch < channels; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += data[i] / channels;
  }
  // Float32 -> Int16
  const i16 = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const enc = new Mp3Encoder(1, decoded.sampleRate, 128);
  const out: Uint8Array[] = [];
  const SAMPLE_BLOCK = 1152;
  for (let i = 0; i < i16.length; i += SAMPLE_BLOCK) {
    const chunk = enc.encodeBuffer(i16.subarray(i, i + SAMPLE_BLOCK));
    if (chunk.length) out.push(new Uint8Array(chunk));
  }
  const tail = enc.flush();
  if (tail.length) out.push(new Uint8Array(tail));
  await ctx.close();
  return new Blob(out, { type: "audio/mpeg" });
}
