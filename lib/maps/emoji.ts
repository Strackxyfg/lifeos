/**
 * The emojis offered on an idea: the ones mind maps use — markers,
 * priorities, moods, work, life — each with words to find it by, in English
 * and French. Any other emoji can still be typed or pasted.
 */

export interface EmojiGroup {
  id: "markers" | "priority" | "faces" | "work" | "life" | "arrows";
  name: { en: string; fr: string };
  items: [emoji: string, words: string][];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: "markers",
    name: { en: "Markers", fr: "Repères" },
    items: [
      ["💡", "idea idée lampe"],
      ["⭐", "star important étoile"],
      ["✅", "done check fait validé ok"],
      ["❌", "no cross non refusé"],
      ["❓", "question doute"],
      ["❗", "important exclamation attention"],
      ["⚠️", "warning risk risque attention"],
      ["🔥", "hot urgent feu chaud"],
      ["🎯", "goal target objectif cible"],
      ["📌", "pin pinned épinglé"],
      ["🚀", "launch start lancer fusée"],
      ["🏁", "finish end arrivée fin"],
      ["🔒", "locked private privé verrou"],
      ["🔑", "key clé solution"],
      ["💎", "value valeur précieux"],
      ["🧩", "piece puzzle pièce"],
      ["🏷️", "tag label étiquette"],
      ["⏳", "waiting en attente sablier"],
      ["🚩", "flag drapeau signal"],
      ["🔖", "bookmark marque-page"],
    ],
  },
  {
    id: "priority",
    name: { en: "Priority", fr: "Priorité" },
    items: [
      ["1️⃣", "one 1 un premier"],
      ["2️⃣", "two 2 deux"],
      ["3️⃣", "three 3 trois"],
      ["4️⃣", "four 4 quatre"],
      ["5️⃣", "five 5 cinq"],
      ["🔴", "red rouge haute high"],
      ["🟠", "orange moyenne"],
      ["🟡", "yellow jaune"],
      ["🟢", "green vert basse low"],
      ["🔵", "blue bleu"],
      ["🟣", "purple violet"],
      ["⚪", "white blanc"],
      ["⚫", "black noir"],
      ["⬜", "todo à faire case"],
      ["🕐", "time heure temps"],
    ],
  },
  {
    id: "faces",
    name: { en: "Moods", fr: "Humeurs" },
    items: [
      ["😀", "happy content heureux"],
      ["🙂", "fine ok bien"],
      ["😍", "love adore"],
      ["🤔", "thinking réfléchir hmm"],
      ["😮", "surprised surpris"],
      ["😐", "neutral neutre"],
      ["😟", "worried inquiet"],
      ["😢", "sad triste"],
      ["😡", "angry fâché colère"],
      ["🥳", "party fête célébrer"],
      ["😴", "tired fatigué sommeil"],
      ["🤯", "mind blown époustouflé"],
      ["👍", "yes like pour oui"],
      ["👎", "no dislike contre non"],
      ["🙌", "bravo yay"],
      ["💪", "strength force motivé"],
    ],
  },
  {
    id: "work",
    name: { en: "Work", fr: "Travail" },
    items: [
      ["💼", "work job travail mallette"],
      ["📈", "growth up croissance hausse"],
      ["📉", "down baisse chute"],
      ["💰", "money argent budget"],
      ["🗓️", "calendar date agenda"],
      ["⏰", "deadline alarm échéance réveil"],
      ["📝", "note write écrire"],
      ["📚", "books learn livres apprendre"],
      ["💻", "computer code ordinateur"],
      ["📞", "call phone appel téléphone"],
      ["✉️", "mail email courrier"],
      ["🤝", "deal partner accord partenaire"],
      ["🏆", "win trophy victoire"],
      ["🛠️", "tools build outils construire"],
      ["⚙️", "settings process réglages"],
      ["🔍", "search find chercher"],
      ["📊", "data chart données graphique"],
      ["🧪", "test experiment expérience"],
      ["👥", "team people équipe"],
      ["🎓", "school learn école formation"],
    ],
  },
  {
    id: "life",
    name: { en: "Life", fr: "Vie" },
    items: [
      ["🧠", "brain mind cerveau esprit"],
      ["❤️", "love heart amour cœur"],
      ["🌱", "grow start pousser début"],
      ["🌳", "tree arbre"],
      ["🌍", "world monde planète"],
      ["☀️", "sun soleil"],
      ["🌙", "moon night lune nuit"],
      ["⚡", "energy énergie éclair"],
      ["💧", "water eau"],
      ["🍎", "food health santé pomme"],
      ["☕", "coffee café pause"],
      ["🏠", "home maison"],
      ["✈️", "travel voyage avion"],
      ["🎵", "music musique"],
      ["🎨", "art design créatif"],
      ["🏃", "sport run courir"],
      ["🧘", "calm meditate calme méditer"],
      ["🎁", "gift cadeau"],
    ],
  },
  {
    id: "arrows",
    name: { en: "Arrows & signs", fr: "Flèches et signes" },
    items: [
      ["➡️", "right next droite suivant"],
      ["⬅️", "left back gauche retour"],
      ["⬆️", "up haut"],
      ["⬇️", "down bas"],
      ["🔁", "repeat loop répéter boucle"],
      ["➕", "plus add ajouter"],
      ["➖", "minus moins"],
      ["✔️", "check coche"],
      ["✖️", "cross croix"],
      ["♾️", "infinite infini"],
      ["💬", "talk comment discuter"],
      ["🔗", "link lien"],
    ],
  },
];

/** Emojis whose words hold the query (accents and case ignored). */
export function findEmoji(query: string): string[] {
  const q = query.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (!q) return [];
  const out: string[] = [];
  for (const g of EMOJI_GROUPS)
    for (const [e, words] of g.items) {
      const hay = words.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      if (hay.split(" ").some((w) => w.startsWith(q)) && !out.includes(e)) out.push(e);
    }
  return out;
}
