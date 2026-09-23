/**
 * What Whisper says that nobody said.
 *
 * Trained on subtitled video, Whisper fills silence — the second before the
 * person stops recording — with the credits it saw most: "Sous-titrage
 * Société Radio-Canada", "Thanks for watching!". Seen on this product's own
 * French test memo. In a second brain that would become a note the person
 * never had.
 *
 * Only whole sentences, only at the start or the end of the transcript, only
 * from a closed list: a person who says "merci d'avoir regardé" in the middle
 * of a thought keeps it. The segment scores that could flag silence
 * (`no_speech_prob`) are not reliable on the provider used — they come back
 * identical for every segment — so the list is the dependable guard.
 */

const PHRASES: RegExp[] = [
  /^sous[- ]titrage (?:de la )?societe radio[- ]canada$/,
  /^sous[- ]titrage st'? ?\d+$/,
  /^sous[- ]titres? (?:realises? )?par (?:la communaute d'?)?amara\.org$/,
  /^sous[- ]titres? (?:fait|faits|realises?) par .{1,40}$/,
  /^merci d'avoir regarde(?: cette video)?$/,
  /^abonnez[- ]vous(?: a la chaine)?$/,
  /^subtitles? by (?:the )?amara\.org community$/,
  /^thanks? (?:you )?for watching$/,
  /^(?:please )?(?:like and )?subscribe(?: to (?:my|the|our) channel)?$/,
  /^transcription by castingwords$/,
  /^transcribed by https?:\/\/otter\.ai$/,
];

const bare = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2019`]/g, "'")
    .replace(/[.!?\u2026\s]+$/g, "")
    .replace(/^[\s.!?\u2026-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

const invented = (sentence: string) => {
  const b = bare(sentence);
  return b.length > 0 && PHRASES.some((p) => p.test(b));
};

export function stripHallucinations(text: string): string {
  // Sentences end at punctuation followed by a space — not at "Amara.org".
  const parts = text.trim().split(/(?<=[.!?\u2026])\s+/).filter(Boolean);
  let start = 0;
  let end = parts.length;
  while (start < end && invented(parts[start])) start++;
  while (end > start && invented(parts[end - 1])) end--;
  if (start === 0 && end === parts.length) return text.trim();
  return parts.slice(start, end).join(" ");
}
