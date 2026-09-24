/**
 * The rules every store applies to recording files, so a path read from a
 * row — or forged in a request — can never reach outside its owner's folder.
 */

/** "<uuid>.<ext>", nothing else: no slashes, no dots but the extension's. */
export const AUDIO_FILE = /^[a-f0-9-]{8,64}\.(webm|ogg|mp4|mp3|wav|m4a)$/;

export function assertAudioFile(file: string): void {
  if (!AUDIO_FILE.test(file)) throw new Error("Invalid recording file name.");
}

/** The file name, if `path` is "<folder>/<file>" in exactly this folder. */
export function fileInFolder(folder: string, path: string): string | null {
  const [head, file, ...rest] = path.split("/");
  if (rest.length > 0 || head !== folder || !file || !AUDIO_FILE.test(file)) return null;
  return file;
}

/** The media type without its parameters: "audio/webm;codecs=opus" is stored as "audio/webm". */
export const baseMime = (mime: string) => mime.split(";")[0].trim().toLowerCase();

/** The extension the transcription service and the browser read a format from. */
export function extensionForMime(mime: string): string {
  const base = baseMime(mime);
  if (base.endsWith("webm")) return "webm";
  if (base.endsWith("ogg")) return "ogg";
  if (base.endsWith("mp4")) return "mp4";
  if (base.endsWith("m4a")) return "m4a";
  if (base.endsWith("mpeg")) return "mp3";
  if (base.includes("wav")) return "wav";
  return "webm";
}
