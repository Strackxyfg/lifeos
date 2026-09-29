# Accord de traitement des données (article 28 du RGPD) — modèle

> **À lire avant tout usage.** Ce document est un **modèle** préparé à partir de
> ce que fait réellement le logiciel LifeOS (code, migrations, fournisseurs
> appelés). Il n'a pas été relu par un juriste et **ne doit pas être signé en
> l'état**. Tout ce qui figure [entre crochets] est à compléter ou à confirmer :
> identité des parties, régions d'hébergement, garanties de transfert de chaque
> fournisseur, délais. Les choix marqués « Option » sont des décisions à prendre.
> Version anglaise : [`DPA.en.md`](DPA.en.md) (même structure, même numérotation).

---

**Entre**

**[Dénomination du Client]**, [forme sociale], dont le siège est situé [adresse],
immatriculée sous le numéro [numéro d'entreprise / RCS / BCE], représentée par
[nom, fonction], ci-après « **le Client** » ;

**et**

**[Dénomination légale de l'éditeur de LifeOS]**, [forme sociale], dont le siège
est situé [adresse], immatriculée sous le numéro [numéro], représentée par [nom,
fonction], contact vie privée : [adresse e-mail], ci-après « **le Prestataire** ».

---

## 1. Objet et champ d'application

1.1. Le présent accord (« **l'Accord** ») encadre les traitements de données à
caractère personnel que le Prestataire effectue pour le compte du Client dans le
cadre du service LifeOS (« **le Service** »), fourni en vertu de [contrat
principal / conditions générales du …] (« **le Contrat** »). Il met en œuvre
l'article 28 du règlement (UE) 2016/679 (« **RGPD** »).

1.2. En cas de contradiction entre l'Accord et le Contrat sur la protection des
données personnelles, l'Accord prévaut.

1.3. Les termes « données à caractère personnel », « traitement », « responsable
du traitement », « sous-traitant », « personne concernée » et « violation de
données à caractère personnel » ont le sens que leur donne l'article 4 du RGPD.

## 2. Définitions propres au Service

- **Utilisateurs autorisés** : les personnes auxquelles le Client donne accès au
  Service (par invitation, par connexion unique ou par provisionnement SCIM).
- **Espace d'équipe** : ce qui est partagé dans l'équipe « entreprise » du Client :
  notes partagées, points hebdomadaires, remerciements, réponses à la météo
  d'équipe, rôles et appartenance, domaines vérifiés, configuration de connexion
  unique, annuaire provisionné.
- **Espace personnel** : le « second cerveau » de chaque Utilisateur autorisé
  (notes, mémos vocaux et leurs transcriptions, rappels, contacts et affaires,
  écritures financières, revues hebdomadaires). **Le Service ne permet ni au
  Client ni à ses administrateurs de consulter l'Espace personnel d'un
  Utilisateur autorisé** : cette séparation est appliquée par la base de données
  (aucune politique d'accès ne la franchit), pas seulement par l'interface.
- **Données du Client** : les données à caractère personnel traitées par le
  Prestataire pour le compte du Client, décrites à l'annexe I.

## 3. Rôles des parties

3.1. Le Client agit en qualité de responsable du traitement, et le Prestataire
en qualité de sous-traitant, pour l'Espace d'équipe et pour les comptes des
Utilisateurs autorisés.

3.2. **Espace personnel — [Option à arrêter].**
- *Option A* : le Client est également responsable du traitement des Espaces
  personnels créés dans le cadre de son abonnement ; le Prestataire les traite
  pour son compte, sans que le Client puisse y accéder par le Service. Les
  demandes d'accès du Client à ces contenus ne peuvent être satisfaites que dans
  les cas prévus par la loi, [procédure].
- *Option B* : chaque Utilisateur autorisé est lié au Prestataire par [les
  conditions d'utilisation] pour son Espace personnel, dont le Prestataire est
  alors responsable du traitement ; l'Accord ne couvre que l'Espace d'équipe et
  les comptes.

3.3. Le Client garantit disposer d'une base légale pour les traitements qu'il
confie au Prestataire et informer les personnes concernées, notamment ses
salariés, conformément aux articles 13 et 14 du RGPD.

## 4. Instructions documentées

4.1. Le Prestataire ne traite les Données du Client que sur instruction documentée
du Client, y compris pour les transferts hors de l'Espace économique européen,
sauf obligation légale ; il en informe alors le Client avant le traitement, sauf
interdiction légale.

4.2. Constituent des instructions documentées : le Contrat et l'Accord ; la
configuration du Service par le Client et ses administrateurs (domaines
vérifiés, connexion unique, exigence de connexion unique, provisionnement SCIM,
correspondance des groupes et des rôles, sièges) ; l'usage du Service par les
Utilisateurs autorisés ; toute instruction écrite complémentaire acceptée par
les parties.

4.3. Le Prestataire informe immédiatement le Client si, selon lui, une
instruction constitue une violation du RGPD ou d'une autre disposition du droit
de l'Union ou des États membres.

## 5. Confidentialité

Le Prestataire veille à ce que les personnes autorisées à traiter les Données du
Client s'engagent à la confidentialité ou soient soumises à une obligation légale
appropriée de confidentialité, et n'y accèdent que dans la mesure nécessaire à
l'exécution du Service, du support ou de la sécurité.

## 6. Sécurité du traitement

6.1. Le Prestataire met en œuvre les mesures techniques et organisationnelles
décrites à l'annexe II, conformément à l'article 32 du RGPD.

6.2. Le Prestataire peut faire évoluer ces mesures, à condition de ne pas réduire
le niveau global de protection. Les changements significatifs sont communiqués
au Client [par écrit / sur une page dédiée].

## 7. Sous-traitants ultérieurs

7.1. Le Client donne une autorisation écrite générale au recours aux
sous-traitants ultérieurs listés à l'annexe III.

7.2. Le Prestataire informe le Client de tout ajout ou remplacement envisagé au
moins [30] jours à l'avance. Le Client peut s'y opposer par écrit, pour un motif
raisonnable tenant à la protection des données, dans ce délai ; à défaut
d'accord, le Client peut résilier la partie concernée du Service sans pénalité.

7.3. Le Prestataire impose à chaque sous-traitant ultérieur, par contrat, des
obligations de protection des données au moins équivalentes à celles de
l'Accord, et demeure responsable envers le Client de leur exécution.

## 8. Transferts hors de l'Espace économique européen

8.1. Certains sous-traitants ultérieurs traitent des données hors de l'EEE,
notamment aux États-Unis (annexe III). Ces transferts reposent sur [une décision
d'adéquation, dont le cadre UE–États-Unis de protection des données lorsque le
destinataire y est certifié, ou à défaut les clauses contractuelles types
adoptées par la décision d'exécution (UE) 2021/914 de la Commission, complétées
des mesures nécessaires] — **à confirmer fournisseur par fournisseur**.

8.2. Le Service peut être configuré pour que les traitements par modèle de
langage ne fassent appel qu'à un fournisseur établi dans l'Union (mode
« souverain » : Mistral, sans repli vers un autre fournisseur). À la date de
l'Accord, la transcription des mémos vocaux reste réalisée par un fournisseur
établi aux États-Unis (annexe III) ; [option : désactivation des mémos vocaux
pour le Client, ou transcription dans l'Union lorsque disponible].

## 9. Droits des personnes concernées

9.1. Compte tenu de la nature du traitement, le Prestataire aide le Client, par
des mesures techniques et organisationnelles appropriées, à répondre aux demandes
d'exercice des droits prévus aux articles 15 à 22 du RGPD.

9.2. Le Service met à disposition des Utilisateurs autorisés l'export de leurs
données dans des formats ouverts et leur suppression complète, en libre-service ;
la suppression retire aussi la personne de toutes ses équipes. Le provisionnement
SCIM permet au Client de retirer immédiatement l'accès d'une personne à l'Espace
d'équipe.

9.3. Le Prestataire transmet sans délai au Client toute demande qu'il reçoit
directement d'une personne concernée au sujet des Données du Client, et n'y répond
pas lui-même sans instruction, sauf obligation légale. Il apporte son assistance
dans un délai de [10] jours ouvrés.

## 10. Violations de données à caractère personnel

10.1. Le Prestataire notifie au Client toute violation de données à caractère
personnel concernant les Données du Client dans les meilleurs délais et au plus
tard [48] heures après en avoir pris connaissance, à l'adresse [contact sécurité
du Client].

10.2. La notification comprend, dans la mesure où elles sont connues, les
informations prévues à l'article 33, paragraphe 3, du RGPD ; les informations non
disponibles sont communiquées au fur et à mesure.

10.3. Le Prestataire prend sans délai les mesures raisonnables pour contenir la
violation et en atténuer les effets, et coopère avec le Client pour ses propres
notifications à l'autorité de contrôle et aux personnes concernées.

## 11. Analyse d'impact et consultation préalable

Le Prestataire fournit au Client les informations raisonnablement nécessaires à
une analyse d'impact relative à la protection des données et, le cas échéant, à
la consultation préalable de l'autorité de contrôle (articles 35 et 36 du RGPD).

## 12. Sort des données à la fin du Contrat

12.1. Avant la fin du Contrat, le Client peut exporter les Données du Client ; à
sa demande, le Prestataire lui restitue les données de l'Espace d'équipe dans un
format ouvert et structuré ([JSON / CSV]) dans un délai de [30] jours.

12.2. Dans les [30] jours suivant la fin du Contrat, le Prestataire supprime les
Données du Client de ses systèmes actifs, sauf obligation légale de conservation,
et en atteste par écrit sur demande. Les copies de sauvegarde sont effacées au
terme de leur cycle de rotation, soit au plus tard [durée], et ne sont pas
utilisées dans l'intervalle.

12.3. Le Prestataire supprime également le fournisseur d'identité enregistré pour
la connexion unique du Client et révoque ses jetons de provisionnement.

## 13. Information et audits

13.1. Le Prestataire met à la disposition du Client les informations nécessaires
pour démontrer le respect de l'article 28 du RGPD, notamment la présente
documentation, la liste des sous-traitants ultérieurs et la description des
mesures de sécurité.

13.2. Le Client peut faire réaliser un audit, par lui-même ou par un auditeur
indépendant tenu au secret, au plus une fois par an sauf violation avérée,
moyennant un préavis de [30] jours, pendant les heures ouvrées et sans atteinte
à la sécurité ou à la confidentialité des données des autres clients. Les frais
de l'audit sont à la charge du Client [sauf manquement constaté du Prestataire].

## 14. Responsabilité

La responsabilité de chaque partie au titre de l'Accord est régie par [les
stipulations du Contrat relatives à la responsabilité], sans préjudice de
l'article 82 du RGPD.

## 15. Durée

L'Accord prend effet à sa signature et produit ses effets aussi longtemps que le
Prestataire traite des Données du Client, y compris après la fin du Contrat
jusqu'à leur suppression.

## 16. Droit applicable et juridiction

L'Accord est régi par le droit [belge / français / …]. Tout litige relève de la
compétence des tribunaux de [ville], sous réserve des règles impératives.

---

Fait à [lieu], le [date], en deux exemplaires.

| Pour le Client | Pour le Prestataire |
|---|---|
| [Nom, fonction, signature] | [Nom, fonction, signature] |

---

## Annexe I — Description des traitements

**Personnes concernées**
- Utilisateurs autorisés : salariés, collaborateurs, prestataires du Client.
- Personnes mentionnées dans les contenus : contacts et interlocuteurs saisis
  dans le CRM, personnes citées dans des notes ou des mémos vocaux.

**Catégories de données**
- **Compte** : adresse e-mail, nom affiché dans l'équipe, fonction (facultative),
  identifiant technique, langue et fuseau horaire.
- **Authentification** : identifiant du fournisseur d'identité, attributs SAML
  transmis par le fournisseur d'identité du Client (adresse e-mail, nom le cas
  échéant), jetons de session.
- **Annuaire provisionné (SCIM)** : identifiant de connexion (userName),
  identifiant externe, prénom, nom, nom affiché, fonction, adresse e-mail, statut
  actif, appartenance aux groupes.
- **Espace d'équipe** : notes partagées (copies choisies une à une par leur
  auteur), points hebdomadaires, remerciements, réponses à la météo d'équipe
  (visibles de leur seul auteur ; l'équipe n'en voit que des moyennes, à partir
  de cinq réponses), rôles, domaines vérifiés, configuration de connexion unique.
- **Espace personnel** [selon l'option retenue à l'article 3.2] : notes,
  enregistrements et transcriptions de mémos vocaux, rappels, contacts et
  affaires, écritures et soldes financiers, revues hebdomadaires et décisions.
- **Données techniques** : journaux techniques des hébergeurs [durée de
  conservation à indiquer].

**Données sensibles.** Le Service n'est pas conçu pour traiter des catégories
particulières de données (article 9 du RGPD) ni des données relatives aux
condamnations (article 10). Les contenus libres pouvant en contenir, le Client en
informe ses utilisateurs [et définit des règles d'usage].

**Nature des traitements.** Hébergement, stockage, organisation et consultation
par les utilisateurs ; traitements automatisés par des modèles de langage
(classement, mise en relation des notes, réponses aux questions, transcription des
mémos vocaux), effectués au moment où l'utilisateur utilise la fonction ;
authentification, dont connexion unique ; synchronisation de l'annuaire du Client.

**Finalité.** Fournir le Service au Client et aux Utilisateurs autorisés.

**Durée.** Pendant la durée du Contrat, puis selon l'article 12. Un Utilisateur
autorisé peut supprimer à tout moment l'ensemble de ses données.

**Traitements par modèle de langage.** Seuls les textes nécessaires à la
fonction utilisée (la question posée, les notes pertinentes, le mémo vocal à
transcrire) sont transmis au fournisseur de modèle, au moment de la demande. Le
Prestataire n'utilise pas les Données du Client pour entraîner des modèles.
[Confirmer, pour chaque fournisseur de l'annexe III, ses conditions d'utilisation
des données transmises par API (absence d'entraînement, durée de conservation).]

## Annexe II — Mesures techniques et organisationnelles

Ne figurent ici que des mesures en place dans le logiciel à la date du document ;
les points [entre crochets] relèvent de l'exploitation et sont à compléter.

1. **Contrôle d'accès.** Authentification par Supabase Auth, y compris connexion
   unique SAML ; la session est revérifiée auprès de Supabase à chaque accès à
   une page protégée. Isolation de chaque utilisateur appliquée par la base de
   données (sécurité au niveau des lignes) sur chaque table de données.
2. **Frontière d'équipe appliquée en base.** Les changements d'appartenance et de
   rôle passent par des fonctions qui appliquent les règles (un seul
   propriétaire ; un membre ne peut pas s'attribuer de rôle) ; des privilèges par
   colonne limitent ce qu'une écriture directe peut modifier. Aucune politique ne
   donne à une équipe accès à l'Espace personnel de ses membres. Les membres sont
   désignés dans les pages par des identifiants opaques, jamais par leur compte.
3. **Connexion unique exigée.** Lorsque le Client l'exige, un membre qui ne s'est
   pas connecté par le fournisseur d'identité du Client n'est plus membre de
   l'équipe pour la base de données (le propriétaire fait exception afin que
   l'équipe ne soit jamais verrouillée). Le fournisseur d'identité de confiance
   et la vérification des domaines ne peuvent être écrits que par le serveur,
   après contrôle (enregistrement auprès de Supabase Auth ; lecture de
   l'enregistrement DNS).
4. **Arrivées et départs.** Provisionnement SCIM 2.0 : une personne désactivée
   ou supprimée dans l'annuaire du Client est retirée de l'équipe immédiatement ;
   les rôles d'administrateur accordés par un groupe de l'annuaire sont retirés
   avec lui.
5. **Secrets.** Liens d'invitation et jetons de provisionnement conservés sous
   forme d'empreinte SHA-256, affichés une seule fois, révocables ; au plus cinq
   jetons actifs par équipe. Les mots de passe sont gérés par Supabase Auth ;
   LifeOS n'en stocke aucun. La clé de service de la base n'est utilisée que
   côté serveur.
6. **Minimisation.** Pour la connexion unique, seul le domaine de l'adresse est
   transmis afin de trouver le fournisseur d'identité. La météo d'équipe n'est
   montrée qu'en moyenne, à partir de cinq réponses. Partager une note est un
   acte explicite, note par note.
7. **Chiffrement.** En transit : HTTPS [confirmer la configuration de
   l'hébergeur]. Au repos : assuré par l'hébergeur de la base [confirmer selon la
   documentation de sécurité de Supabase et le plan souscrit].
8. **Droits des personnes.** Export complet en formats ouverts (les exports JSON
   et ZIP comprennent le profil, le second cerveau, les projets, les affaires, les
   finances, les rappels, les revues et ce que la personne a écrit dans ses
   équipes) et suppression complète en libre-service ; la suppression retire la
   personne de toutes ses équipes.
9. **Développement.** Suite de tests automatisés (690 tests à la date du
   document), dont un test qui fait échouer la construction si une route d'API
   n'authentifie pas son appelant ; migrations de base de données validées sur
   Postgres avec leurs politiques d'accès ; mises à jour de sécurité des
   dépendances.
10. **Journalisation et surveillance** : [à compléter — le Service ne dispose pas
    à ce jour d'un journal d'audit applicatif des actions d'administration].
11. **Sauvegardes et continuité** : [fréquence, rétention et région des
    sauvegardes, selon le plan Supabase ; procédure de restauration].
12. **Organisation** : [personnes habilitées et engagements de confidentialité ;
    procédure de gestion des incidents ; contact sécurité ; revue périodique des
    accès].

## Annexe III — Sous-traitants ultérieurs

Liste établie d'après les services effectivement appelés par le logiciel. Les
raisons sociales, régions et garanties sont **à confirmer** avant signature.

| Sous-traitant | Finalité | Données concernées | Localisation | Garanties de transfert |
|---|---|---|---|---|
| Supabase [raison sociale] | Base de données, authentification (dont SAML), stockage des enregistrements audio | Toutes les Données du Client | [Région du projet] | [DPA du fournisseur ; clauses types si hors EEE] |
| Vercel [raison sociale] | Hébergement et exécution de l'application | Données en transit, journaux techniques | [Régions] | [À confirmer] |
| Groq [raison sociale] | Modèles de langage ; transcription des mémos vocaux | Textes et enregistrements transmis à la demande | États-Unis | [Cadre UE–États-Unis ou clauses types — à confirmer] |
| Cerebras [raison sociale] | Modèle de langage de repli [configuré ; peut être retiré] | Textes transmis à la demande | États-Unis | [À confirmer] |
| Mistral AI [raison sociale] | Modèles de langage (mode « souverain ») | Textes transmis à la demande | Union européenne [à confirmer] | Traitement dans l'UE |
| Resend [raison sociale] | Envoi d'e-mails par l'agent | Adresse du destinataire, contenu du message | [À confirmer] | [À confirmer] |
| [Fournisseur du serveur de l'agent] | Exécution de l'agent autonome, hors du poste de l'utilisateur | Contexte transmis à l'agent | [À confirmer] | [À confirmer] |
| Telegram — *seulement si l'utilisateur relie son compte* | Canal de conversation avec l'agent, mémos vocaux, rappels | Messages échangés avec le bot | [À confirmer] | Activation par l'utilisateur |
| Notion — *seulement si l'utilisateur connecte Notion* | Export facultatif | Contenus exportés | États-Unis | Activation par l'utilisateur |
| Stripe — *lorsque la facturation sera activée* | Paiement | Données de facturation | [À confirmer] | [À confirmer] |
