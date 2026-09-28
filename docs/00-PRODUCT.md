# LifeOS — description produit

> État au 28 septembre 2026, **établi depuis le code**. Le produit a pivoté :
> ce n'est plus un générateur d'espaces Notion, c'est un second cerveau
> souverain avec un agent IA. Notion devient un export facultatif. Depuis, le
> cerveau se relie lui-même (section 2), se laisse vider à la voix (section 1),
> montre comment il pense (section 5), se souvient (section 3), se parle
> (section 6). L'application s'ouvre désormais sur une île en 3D sous votre
> propre ciel (section 7), le tableau de bord devient votre journée avec ses
> rappels (section 8), et LifeOS se partage en équipe ou en cercle — sans que
> personne ne lise jamais votre cerveau (section 9).

**Légende** — ✅ fonctionnel · 🟡 partiel · ⛔ pas construit

---

## En une phrase

Un second cerveau qui vous appartient : vous capturez vos pensées, LifeOS les
range, les relie et en tire votre focus du jour ; un agent IA travaille à partir
de ce que vous avez écrit, dans l'application et sur Telegram, dans les limites
que vous fixez.

## Pour qui

Fondateurs, freelances et managers qui pensent vite et oublient autant. Ils
veulent un endroit unique pour leurs idées, leurs objectifs et leurs prochaines
actions, et un assistant qui les connaît vraiment. Et, depuis la section 9 :
les **entreprises** qui équipent chaque salarié d'un second cerveau et d'un
espace d'équipe, et les **cercles de fondateurs** qui avancent entre pairs.

---

## 1. Le second cerveau ✅

- **Capture** au clavier ou à la voix, depuis la page du cerveau ou depuis
  n'importe quelle page (bouton « Capturer »). Chaque pensée est rangée dans
  une des **six régions** : objectifs, prochaines actions, idées, pensées,
  connaissances, insights. Classement par IA, repli sur des règles si l'IA est
  absente. Déplaçable en un clic.
- **Vider ma tête** : parler quelques minutes (mémo vocal, tous navigateurs,
  5 min max) ou coller une page de notes. LifeOS transcrit (Whisper), découpe
  en **une idée par note**, range chacune et garde les liens que *vous* avez
  faits en parlant. Tout s'affiche avant d'être enregistré : on corrige, on
  reclasse, on décoche. Garde-fous vérifiés sur de vrais mémos : langue du
  texte imposée, incertitude conservée (« je pourrais » reste une idée), aucune
  relation gardée sans citation du texte qui la dit — une relation seulement
  déduite part au tissage, « à valider ». Les crédits que Whisper invente sur
  les silences (« Sous-titrage Société Radio-Canada ») sont retirés. Sans IA :
  découpage ligne par ligne, sans rien perdre. Coller un long texte dans la
  capture ouvre ce mode.
- **Capturer depuis le téléphone** : LifeOS s'installe comme une app et
  apparaît dans le menu « Partager » d'Android. Une page, un passage, un lien
  partagé depuis n'importe quelle app arrive pré-rempli ; **rien n'est
  enregistré sans votre clic** (la page est joignable par un lien que
  n'importe qui peut fabriquer). Une page hors ligne, aucune donnée en cache.
- **Connexions** entre notes : tracées par LifeOS, expliquées, validées par
  vous (section 2).
- **Focus** déterministe : d'abord les actions qui font avancer un objectif,
  puis les objectifs sans prochaine action, puis ce qui attend, puis les idées
  récentes non reliées.
- **Révision du jour** (section 3) — ou, avant la migration 009, une note
  d'il y a une semaine ou plus qui revient chaque jour.
- **Recherche** instantanée, insensible aux accents.
- **Carte 3D** interactive : régions, notes et connexions, colorées par
  région ou par constellation. **Replay** : revoir son cerveau se construire,
  note après note, chaque connexion quand elle a été tracée (≈ 10 s, curseur,
  pause).
- **Carte mentale** : les notes se regroupent en **constellations** (Louvain
  sur les connexions et les sujets, nommées par leurs concepts), avec les
  **idées maîtresses** (PageRank) et les **ponts** entre constellations.
- **Export complet** en Markdown (liens Obsidian) et en JSON.

## 2. Les connexions — ce qui fait la différence ✅

Un second cerveau ne vaut que par ce qu'il relie. Le nôtre comprend ses notes
et les relie lui-même.

**Comprendre.** Chaque note est lue une fois par le modèle, qui en extrait 2 à
5 **concepts** : une clé canonique en anglais (ce qui sert à comparer) et un
libellé dans la langue de la note (ce qui s'affiche). Une note française sur
le « parrainage » rencontre ainsi une note anglaise sur le « referral
program ». Une empreinte du texte évite de réanalyser une note inchangée, et
les clés déjà utilisées sont proposées au modèle pour qu'un même sujet garde
une même clé.

**Relier.** Les paires candidates — mots partagés, concepts partagés, et
toujours les objectifs ouverts, là où une action se cache sans partager un
mot — sont soumises au modèle, qui dit s'il existe une vraie relation :

| Type | Sens |
| --- | --- |
| **fait avancer** | une action, une idée ou un plan qui fait progresser un objectif |
| **étaye** | un fait, un chiffre ou une raison qui appuie une autre note |
| **développe** | une note qui prolonge ou affine une autre |
| **en tension avec** | deux notes qui se contredisent ou se disputent le même temps |
| **lié à** | même sujet précis, rien de plus fin |

Chaque connexion porte son **sens**, sa **direction**, une **confiance** et une
**raison en une phrase**, dans votre langue. Seules les plus sûres sont
tracées, et elles arrivent **« à valider »** : vous gardez ou vous retirez, et
un retrait est mémorisé — cette paire ne sera plus jamais proposée.

**Quand.** Après chaque capture (cerveau, barre du haut, accueil), et à la
demande avec « Organiser mon cerveau ». Les budgets sont calibrés sur le quota
par minute d'un fournisseur gratuit ; ce qui ne tient pas dans une passe est
repris à la suivante, sans rien perdre.

**Ce que ça donne, en vrai** (session de test) : le programme de parrainage
*fait avancer* l'objectif « Signer 10 clients » ; une statistique en anglais
*étaye* ce même objectif ; et « je n'ai plus le temps de m'entraîner le soir »
est détecté *en tension avec* « courir un semi-marathon ».

**Autour :**
- **Thèmes** : les sujets qui reviennent, calculés depuis les concepts.
- **Tensions** : une section à part, parce qu'une contradiction demande une décision.
- **Développer** : transformer un objectif ou une idée en prochaines actions
  concrètes, déjà reliées — et qui tiennent compte des tensions détectées.
- **Sans IA** : les suggestions par mots partagés restent, expliquées. Rien ne
  dépend d'une clé pour fonctionner.

## 3. La mémoire — révision espacée et décisions ✅

Un cerveau qui stocke sans rendre est une archive. Deux boucles le ferment.

**Révision espacée.** Chaque note qui mérite d'être retenue (idées, pensées,
connaissances, insights) revient : 3 jours après son écriture, puis 7, 18, 45,
113 et jusqu'à 180 jours, tant que vous répondez « toujours valable ».
« À retravailler » l'ouvre et la ramène dans 2 jours ; « Archiver » la classe.
Cinq par jour au plus, les révisions promises avant l'arriéré ; chaque bouton
dit ce qu'il fera (« revient dans 18 jours »). Le résumé du jour le rappelle.

**D'une tension à une décision.** Deux notes en tension se décident : face à
face, avec des options que le modèle tire **de vos seules notes** et de ce qui
les entoure (jamais un fait que vous n'avez pas écrit), puis votre décision,
dans vos mots — enregistrée comme une note, reliée aux deux, en mettant
éventuellement un côté de côté. La tension reste, marquée « décidée » ; elle
sort de la liste à arbitrer et des résumés. Supprimer la décision la rouvre.

## 4. L'accueil — natif, sans Notion ✅

Sept questions construisent le cerveau sur-le-champ :

| Question | Où va la réponse |
| --- | --- |
| Prénom, métier | profil |
| Objectif principal, second objectif | notes « objectif » |
| Prochaine action | note « prochaine action », **reliée à l'objectif** |
| Ce que vous avez en tête | une note par ligne, rangée par région |
| Domaines de vie | profil (l'assistant et l'agent en tiennent compte) |

Relancer l'accueil ne duplique rien : une note dont le titre existe déjà est
réutilisée. Le brouillon survit à un rechargement et à une reconnexion.

## 5. L'assistant et la trace de pensée ✅

Il répond **à partir du second cerveau** : qui vous êtes (profil), vos
objectifs, votre focus, les notes liées à la question **et ce à quoi ces notes
sont reliées** — le fait derrière une décision, l'action derrière un objectif,
la note qu'elle contredit. Il **cite ses sources** : les notes utilisées
s'affichent sous la réponse et s'ouvrent d'un clic. Sans clé IA, il le dit et
montre ce que le cerveau contient sur la question au lieu d'inventer.

La question est d'abord projetée sur **les sujets de votre cerveau** (un choix
parmi ses clés, jamais une clé inventée) : « comment développer mon chiffre
d'affaires ? » trouve les notes sur l'acquisition clients, sans mot commun.

**Trace de pensée.** Depuis la page du cerveau (Entrée dans la recherche), la
réponse s'écrit pendant que la 3D montre comment elle a été lue : un influx
part du centre vers chaque note trouvée, qui s'allume, puis parcourt les
connexions suivies, dans leur couleur ; objectifs et focus luisent, toujours
lus. Ce qui est dessiné est **exactement** ce que le modèle a reçu — pas une
reconstitution. Chaque note lue est listée avec la raison (mots ou sujets
partagés, connexion suivie) ; les titres cités dans la réponse s'ouvrent.

## 6. La voix ✅

**Notes vocales.** Le micro de la barre de capture enregistre une note :
Whisper la transcrit mot à mot, **l'enregistrement est gardé** dans l'espace
de la personne, et la note se réécoute avec chaque mot éclairé au moment où il
est dit — un clic sur un mot y amène, vitesse ×1 à ×2. Un mémo passé dans
« Vider ma tête » peut garder son enregistrement : **chaque note découpée
rejoue le passage exact d'où elle vient** (alignement de la citation du modèle
sur les mots datés ; mesuré sur un vrai mémo de 28 s : 7 notes, 7 passages
exacts). Transcription et passage voyagent dans l'export ZIP.

**Réponses parlées.** Chaque réponse du cerveau, de l'assistant, le briefing
et chaque note ont un bouton « Écouter » ; les réponses peuvent aussi être lues
au fil de leur écriture (Réglages → Voix). Voix de l'appareil, **locales par
défaut** : les voix « en ligne » (Google dans Chrome, Microsoft dans Edge)
reçoivent le texte lu, elles sont désactivées tant qu'on ne les choisit pas.

**Conversation.** Le micro à côté de la recherche ouvre une conversation mains
libres : le cerveau entend la fin de la question (détection de parole qui
apprend le bruit de la pièce), la transcrit, répond brièvement à voix haute
pendant que la trace 3D s'allume au rythme de la voix, puis réécoute — relances
comprises (« et pour le semi ? »), jusqu'à ce qu'on arrête ou qu'on se taise.
Il n'écoute jamais pendant qu'il parle. Mesuré : 0,4 s de transcription,
premiers mots 0,8 s plus tard.

**Telegram.** Un mémo vocal envoyé au bot est transcrit, confirmé (« 🎤 … »),
puis suit exactement le chemin d'un message tapé : file d'attente, politique,
journal d'audit.

## 7. L'île — le hub ✅

LifeOS s'ouvre sur une île en 3D, comme le hub d'un jeu : chaque bâtiment est
une partie du produit — la rotonde du **second cerveau** (sous sa coupole, un
cœur de lumière en forme de cerveau), le beffroi du **tableau de bord** (son
horloge donne l'heure), le café de l'**assistant**, l'atelier et l'antenne de
l'**agent**, le studio et sa grue des **projets**, la tour des **finances**, les
pavillons reliés des **relations**, le club de l'**équipe**, le phare des
**paramètres**. Au-dessus de chacun, un repère — une vraie icône cliquable,
accessible au clavier — avec le nombre de choses qui attendent (notes à revoir
et tensions, rappels du jour, projets bloqués, point hebdo à écrire).

Un clic (ou ←/→) : la caméra vole jusqu'au bâtiment, en arc, et sa fiche
s'ouvre avec les vrais chiffres de la personne. « Entrer » pousse la caméra
jusqu'à la porte et ouvre la page ; au retour, l'île repart devant le bâtiment
quitté puis s'éloigne. En bas, trois cartes : aujourd'hui, votre cerveau, là
où vous étiez.

**Le ciel est le vôtre.** Le soleil et la lune sont à leur vraie position pour
la ville de votre fuseau horaire (calcul NOAA avec réfraction, série lunaire
de l'Almanach, phase de la lune comprise) — sans géolocalisation, rien ne
quitte l'appareil. L'île passe par l'aube, midi, l'heure dorée, le coucher et
une nuit éclairée (fenêtres, lampadaires, fontaine, enseignes, faisceau du
phare) quand ils arrivent vraiment chez vous ; au-dessus de l'horizon courbé
comme celui d'une petite planète, une bande de vrai ciel, avec nuages et
étoiles. Un aperçu permet de voir l'île à une autre heure (`/hub?at=21:30`).

Tenu à l'exigence d'un produit : le cadrage est **calculé** (l'île entière
tient sur tout écran, du 21:9 au téléphone ; chaque bâtiment tient dans la
partie de l'écran que sa fiche laisse libre, vu depuis un point qu'aucun autre
bâtiment n'obstrue) ; les ombres ne sont recalculées que quand la lumière
bouge ; la qualité baisse d'elle-même sur un appareil lent ; « réduire les
animations » transforme chaque vol en coupe ; sans WebGL, les mêmes lieux
deviennent une liste.

## 8. Le tableau de bord et les rappels ✅

Le tableau de bord n'est plus l'accueil : c'est la journée. D'abord les
**rappels**, puis ce que le cerveau juge prioritaire (le focus et ses raisons,
les notes à revoir, les tensions à trancher, les connexions à vérifier), puis
les chiffres (notes, connexions, tâches, projets, montant en cours, solde) et
quatorze jours de captures.

**Des rappels écrits comme on les dit**, en français ou en anglais :
« appeler Marc demain à 9h », « réunion tous les lundis à 10h30 », « payer le
loyer le 5 de chaque mois », « call Anna tomorrow at 3pm ». Des règles, pas un
modèle : les mêmes mots donnent toujours le même rappel, hors ligne, et ce qui
a été compris s'affiche pendant la frappe — une erreur se voit avant d'être
enregistrée. Les répétitions gardent l'heure du fuseau où elles ont été créées
(9 h reste 9 h au changement d'heure ; le 31 de chaque mois est le 30 en avril
et redevient le 31 en mai). Fait, annuler, reporter, supprimer.

**Ils arrivent à l'heure.** Sur n'importe quelle page, une alerte (« fait »,
« dans 10 min »), une notification système si l'onglet est en arrière-plan et
que vous l'avez autorisée, et le titre de l'onglet qui compte ce qui attend.
Chaque échéance est marquée « annoncée » : aucun autre onglet ne la répète.
Application fermée : avec l'agent relié à Telegram, un envoi planifié
(`/api/reminders/dispatch`, protégé par `CRON_SECRET`) les y transmet — chaque
échéance réservée avant l'envoi, deux passages ne l'envoient jamais deux fois.

## 9. Équipes et cercles ✅

LifeOS à plusieurs : une **entreprise** qui achète un siège par salarié, ou un
**cercle** de fondateurs qui avancent entre pairs. Mêmes mécanismes, deux
usages.

**La règle sur laquelle tout repose : une équipe ne lit jamais le cerveau d'un
membre.** Elle voit ce qu'il partage, note par note — et la page n'envoie que
l'identifiant de la note : son texte est relu côté serveur dans le cerveau de
la personne, rien ne peut être partagé en son nom qu'elle n'ait écrit. La
phrase est affichée sur chaque écran d'équipe : même les administrateurs ne
peuvent pas lire le reste.

- **Un cerveau commun, et ses synapses entre les personnes** : les
  *rencontres* (deux membres qui pensent à la même chose sans le savoir, avec
  les termes en commun) et *pour vous* (ce que les collègues ont partagé qui
  rejoint l'une de vos notes privées — calculé pour vous seul, jamais
  stocké). « Garder dans mon cerveau » copie une note partagée chez soi, avec
  son auteur.
- **Le point hebdo** (fait / focus / blocage), avec un brouillon tiré de votre
  propre cerveau (votre focus, votre tension ouverte — « fait » reste vide :
  le cerveau ne peut pas le savoir honnêtement), « j'aimerais de l'aide » et
  « je peux aider ».
- **Des bravos**, et un fil d'activité.
- **La météo**, anonyme : chaque réponse n'est lisible que par son auteur ;
  l'équipe voit des moyennes à partir de cinq réponses — en dessous, aucune.
- **Membres et rôles** (un propriétaire, des admins, des membres), sièges,
  liens d'invitation (affichés une fois ; seule leur empreinte SHA-256 est
  gardée), transmission, départ, suppression.

La frontière de sécurité est la base elle-même (migration 012) : politiques
ligne par ligne, **privilèges par colonne** (un membre peut se renommer,
jamais se promouvoir), fonctions pour tout ce qui touche à l'appartenance
(sièges attribués un par un sous verrou, un seul propriétaire, un membre
n'apprend rien en essayant de changer un rôle). Validée sur Postgres avec les
rôles de Supabase : ~75 vérifications, dont chaque tentative d'élévation.

## 10. L'agent autonome ✅

Un agent IA qui travaille sur vos données, **sur un serveur séparé — jamais
sur votre ordinateur** — et qui ne peut rien faire de dangereux sans vous.

- **Calibration** : test de 33 questions (Mini-IPIP + items opérationnels),
  avec contrôles anti-triche.
- **Autonomie au choix** : observer, assister, agir, étendre.
- **Garde-fous** : cinq niveaux de risque ; le haut risque exige toujours votre
  accord ; certaines actions sont impossibles à tout niveau (argent, signature,
  secrets, suppression définitive, sécurité) ; arrêt d'urgence ; journal
  d'audit non modifiable. Il rédige, vous envoyez.
- **Où lui parler** : dans l'app et sur Telegram. En mode relais
  (`AGENT_BACKEND=hermes`), c'est le même agent Hermes, avec la même mémoire.
- **Ce qu'il lit** : le second cerveau (avec votre profil) et le résumé de
  l'activité, via MCP.

| | Aujourd'hui |
| --- | --- |
| ✅ | lire et chercher dans le second cerveau · voir à quoi une note est reliée et pourquoi · relier deux notes avec un sens et une raison (marqué « agent, à valider ») · lancer le moteur de connexions · créer des notes (reliées automatiquement) · créer tâches, projets, opportunités · rédiger e-mails, campagnes, propositions · envoyer un e-mail validé *(si un fournisseur d'envoi est configuré)* |
| ⛔ | agenda · recherche web · Slack · publicité · services externes · exécution de code — ces actions répondent « non implémenté » au lieu de prétendre avoir réussi |

## 11. Le reste de l'activité ✅

Projets, clients (CRM) et finances, avec de vraies données persistées. Le **résumé du jour** et le **bilan de la semaine** partent
désormais du second cerveau — le focus dans l'ordre, les objectifs sans
prochaine action, les tensions à arbitrer, ce qui a été capturé et relié cette
semaine, les notes à revoir — puis situent les projets et les finances. Sans
IA, le même texte est calculé depuis les mêmes faits.

## 12. Notion — export facultatif ✅

Depuis les Paramètres, une fois Notion connecté : LifeOS montre les bases qu'il
va créer (un socle, plus un module par domaine de vie choisi), attend votre
clic, puis les crée dans la page partagée avec une page d'accueil. L'écran de
progression n'affiche que les étapes réellement exécutées. Sans connexion, il
refuse au lieu de simuler.

## 13. Vos données ✅

- Export Markdown / JSON à tout moment, ou **ZIP complet** : les deux, plus
  chaque enregistrement et sa transcription mot à mot (le Markdown relie chaque
  note vocale à son audio et à son passage).
- **Suppression complète** depuis les Paramètres (mot à taper, vérifié côté
  serveur) : notes, connexions, projets, opportunités, transactions, tâches,
  enregistrements, rappels, profil — et la présence dans chaque équipe, avec
  ce qui y a été partagé (une équipe dont on est propriétaire passe à
  l'admin le plus ancien, ou disparaît si l'on y était seul). Le compte et le
  contenu Notion restent.

## 14. Tarifs — accès anticipé

Gratuit, sans carte. Prix affichés pour après l'accès anticipé :
**Essentiel 19 $**, **Pro 49 $**, **Souverain 99 $** par mois. Chaque promesse
de la grille correspond à une fonction qui existe. Rien n'est facturé : le
paiement n'est pas branché. Les équipes gèrent des **sièges**, prêts à
devenir une facturation par siège — le tarif entreprise reste à décider
(voir « Avant de lancer »).

## 15. Technique

Next.js 15 · React 19 · TypeScript strict · Supabase (authentification,
Postgres, sécurité ligne par ligne) · API Notion · agent sur VPS · PWA
(installable, cible de partage) · three.js / React Three Fiber · interface
intégralement bilingue · 568 tests
automatisés, dont des gardes contre les fausses allégations, les routes non
protégées et les caractères de contrôle dans le code.

**IA — un routeur, pas un fournisseur.** Chaque tâche (classer, relier,
découper, décider, répondre…) a un ordre de modèles mesuré (Groq : Qwen3 27B,
GPT-OSS 120B/20B ; Mistral en option pour l'UE). Bascule automatique vers le
modèle suivant, **disjoncteurs** par modèle (quota, erreur, délai — avec le
temps de repos que le fournisseur indique), réponses inutilisables rejetées et
rejouées ailleurs, streaming qui bascule avant le premier mot. Mode souverain :
`AI_PROVIDER=mistral` + `AI_FALLBACK=0`. Transcription : Whisper
large-v3-turbo, repli large-v3. Quotas par personne sur les appels coûteux.

**Voix.** Whisper (Groq) avec mots datés ; alignement citation → audio par
alignement local ; enregistrements servis par plages d'octets, jamais mis en
cache, chargés une fois en mémoire pour des passages qui démarrent en ~0,1 s ;
export ZIP écrit en flux. Synthèse : voix de l'appareil, lues phrase par phrase
avec une file maison (les défauts de Chrome contournés : coupure à 15 s,
événement de fin perdu).

**L'île.** Scène procédurale (aucun fichier 3D téléchargé : géométries,
textures d'enseignes et de fenêtres dessinées au chargement), mer et ciel en
shaders, carte de distance de la côte pour les hauts-fonds et l'écume, ombres
statiques recalculées au mouvement du soleil, reflets générés sur place,
instanciation des arbres, lampadaires et passants, qualité adaptative.
Éphémérides testées contre les horaires publiés (Paris, Sydney, New York,
nuit polaire, soleil de minuit, phases de la lune sur les éclipses de 2026).

**Rappels.** Heure murale par fuseau sans bibliothèque (IANA via `Intl`),
heures sautées ou doublées au changement d'heure traitées, séries comptées
depuis une ancre ; analyseur FR/EN déterministe (44 cas testés).

**Équipes.** Deux implémentations d'un même contrat — Supabase (la base
applique les règles) et fichier local (les mêmes règles en TypeScript) —
testées sur le même scénario ; membres désignés par un identifiant opaque,
jamais par leur compte.

**Échelle.** Similarité par index inversé (tous les couples d'un cerveau de
4 000 notes en ~1,3 s au lieu de 107 s), carte mentale de 3 000 notes en moins
de 5 s, testées.

---

## 16. Avant de lancer

1. **Appliquer les migrations 007 à 012, dans l'ordre**, dans Supabase
   (idempotentes, validées sur Postgres, politiques comprises). Sans 007 : pas
   de connexions, profil limité au navigateur. Sans 008 : les connexions
   restent simples et le moteur de connexions reste éteint. Sans 009 : la
   révision retombe sur une note du jour, et une tension décidée reste listée.
   Sans 010 : les notes vocales sont enregistrées en texte, sans leur audio.
   Sans 011 : pas de rappels. Sans 012 : pas d'équipes. L'app le dit, elle ne
   fait pas semblant.
2. **Paiement** : Stripe n'est pas branché. Aucun revenu possible.
3. **Pages légales** : mentions légales, CGU et politique de confidentialité
   sont obligatoires pour un site commercial en France (LCEN, RGPD). Elles
   n'existent pas.
4. **Cohérence « souverain »** : les prix sont en dollars ; la région Supabase
   n'est pas vérifiée ; les questions et notes pertinentes partent chez Groq ou
   Cerebras (États-Unis), et les mémos vocaux chez Groq pour la transcription
   (l'écran le dit avant l'enregistrement). Le site ne revendique donc aucun
   hébergement européen. Pour que la promesse tienne : prix en euros, Supabase
   en région UE, et Mistral comme fournisseur (déjà branché : `MISTRAL_API_KEY`,
   `AI_PROVIDER=mistral`, `AI_FALLBACK=0`) — la transcription resterait chez
   Groq, à remplacer par un Whisper européen ou auto-hébergé.
5. **Clés** : `CEREBRAS_MODEL=llama-3.3-70b` n'existe plus chez Cerebras et
   la clé Cerebras répond « paiement requis » (402) — le routeur l'écarte, mais
   autant la retirer. La clé `OPENAI_API_KEY` est refusée (401) et l'URL Upstash
   est vide : ni l'une ni l'autre n'est utilisée. La voix anglaise d'Orpheus
   (Groq) demande que l'administrateur accepte ses conditions dans la console
   Groq — non utilisée, les voix de l'appareil suffisent.
6. **Telegram** : les mémos vocaux au bot et l'envoi des rappels sont codés et
   testés, pas éprouvés sur l'API réelle (aucun jeton de bot configuré ici).
7. **Rappels application fermée** : définir `CRON_SECRET` (16 caractères au
   moins) et faire appeler `/api/reminders/dispatch` chaque minute avec
   `Authorization: Bearer <CRON_SECRET>` — cron Vercel (offre Pro : l'offre
   gratuite n'autorise qu'un passage par jour), un service de cron externe, ou
   le VPS de l'agent. Sans cela, les rappels n'arrivent que dans l'app ouverte.
8. **Tarif entreprise** : les sièges existent, leur prix non. À décider, puis
   à brancher sur Stripe (quantité = sièges).

## Ce qui a été retiré parce que c'était faux

Témoignages inventés (y compris sur la page de connexion) · « 2 400+ personnes
en attente » · une liste d'attente qui n'enregistrait rien et promettait un
e-mail jamais envoyé · « Généré en 47 s » · garantie de remboursement sur un
produit qui ne facture rien · « All systems operational » · « LifeOS AI, Inc. »
· intégrations Google Agenda, Gmail, Slack, GitHub, Stripe affichées
« Connecté » · e-mails de bilan jamais envoyés · fuseau horaire codé en dur ·
bouton de suppression sans effet · étapes de génération Notion jamais
exécutées · série d'habitudes de 23 jours transmise à l'IA · « MRR » qui était
le total des revenus.

## Ce qui rend le produit défendable

- **Un cerveau qui vous appartient** : formats ouverts, export et suppression
  à tout moment, rien d'inventé à l'écran.
- **Un focus qui découle de vos objectifs**, pas d'une liste de tâches de plus.
- **Des connexions qui ont un sens** — et qui se valident : le cerveau
  propose, vous tranchez, il se souvient de vos refus.
- **Un cerveau qui montre comment il pense** : chaque réponse dessine les
  notes qu'elle a lues ; chaque lien tiré d'un mémo cite la phrase qui le dit.
- **Un cerveau qui se souvient** : ce qui compte revient au bon moment, et les
  contradictions se tranchent au lieu de s'accumuler.
- **Un cerveau qui garde votre voix** : chaque note issue d'un mémo rejoue la
  phrase exacte où vous l'avez dite ; et on peut lui parler, il répond.
- **Un lieu, pas un menu** : une île sous votre ciel réel, où chaque bâtiment
  dit ce qui vous y attend.
- **Une équipe où partager est un choix** : un cerveau commun qui relie les
  idées de plusieurs personnes, sans jamais lire le cerveau de personne — et
  la base de données, pas l'interface, qui le garantit.
- **Un agent qu'on peut réellement laisser travailler** : rédiger librement,
  envoyer sous contrôle, garde-fous non contournables, exécution hors de la
  machine de l'utilisateur, le même agent dans l'app et sur Telegram.
