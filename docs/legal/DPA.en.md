# Data Processing Agreement (GDPR Article 28) — template

> **Read before any use.** This is a **template**, prepared from what the
> LifeOS software actually does (code, migrations, providers it calls). It has
> not been reviewed by a lawyer and **must not be signed as it stands**.
> Everything [in square brackets] is to be completed or confirmed: the parties'
> identities, hosting regions, each provider's transfer safeguards, time limits.
> Items marked "Option" are decisions to make. French version:
> [`DPA.fr.md`](DPA.fr.md) (same structure, same numbering).

---

**Between**

**[Customer's legal name]**, [legal form], registered office at [address],
registered under number [company number], represented by [name, title],
hereinafter "**the Customer**";

**and**

**[Legal name of the LifeOS publisher]**, [legal form], registered office at
[address], registered under number [number], represented by [name, title],
privacy contact: [email address], hereinafter "**the Provider**".

---

## 1. Subject matter and scope

1.1. This agreement (the "**Agreement**") governs the processing of personal data
that the Provider carries out on behalf of the Customer in providing the LifeOS
service (the "**Service**") under [main contract / terms of …] (the
"**Contract**"). It implements Article 28 of Regulation (EU) 2016/679 (the
"**GDPR**").

1.2. Where the Agreement and the Contract conflict on the protection of personal
data, the Agreement prevails.

1.3. "Personal data", "processing", "controller", "processor", "data subject"
and "personal data breach" have the meanings given in Article 4 GDPR.

## 2. Service-specific definitions

- **Authorised Users**: the people to whom the Customer gives access to the
  Service (by invitation, single sign-on or SCIM provisioning).
- **Team Space**: what is shared in the Customer's "company" team: shared notes,
  weekly check-ins, kudos, team pulse answers, roles and membership, verified
  domains, single sign-on configuration, provisioned directory.
- **Personal Space**: each Authorised User's "second brain" (notes, voice notes
  and their transcripts, reminders, contacts and deals, financial entries,
  weekly reviews). **The Service does not let the Customer or its
  administrators consult an Authorised User's Personal Space**: the separation is
  enforced by the database (no access policy crosses it), not only by the
  interface.
- **Customer Data**: the personal data the Provider processes on behalf of the
  Customer, described in Annex I.

## 3. Roles of the parties

3.1. The Customer acts as controller, and the Provider as processor, for the
Team Space and for the Authorised Users' accounts.

3.2. **Personal Space — [Option to decide].**
- *Option A*: the Customer is also the controller of the Personal Spaces created
  under its subscription; the Provider processes them on its behalf, without the
  Customer being able to access them through the Service. Requests by the
  Customer for access to that content can be met only where the law provides,
  [procedure].
- *Option B*: each Authorised User is bound to the Provider by [the terms of
  use] for their Personal Space, of which the Provider is then the controller;
  the Agreement covers only the Team Space and the accounts.

3.3. The Customer warrants that it has a legal basis for the processing it
entrusts to the Provider and that it informs the data subjects, including its
employees, in accordance with Articles 13 and 14 GDPR.

## 4. Documented instructions

4.1. The Provider processes Customer Data only on the Customer's documented
instructions, including with regard to transfers outside the European Economic
Area, unless required by law; in that case it informs the Customer before
processing, unless the law prohibits it.

4.2. Documented instructions are: the Contract and the Agreement; the
configuration of the Service by the Customer and its administrators (verified
domains, single sign-on, requiring single sign-on, SCIM provisioning, group-to-
role mapping, seats); the use of the Service by Authorised Users; any further
written instruction agreed by the parties.

4.3. The Provider immediately informs the Customer if, in its opinion, an
instruction infringes the GDPR or other Union or Member State data protection
provisions.

## 5. Confidentiality

The Provider ensures that persons authorised to process Customer Data have
committed themselves to confidentiality or are under an appropriate statutory
obligation of confidentiality, and access it only to the extent necessary to
provide the Service, support or security.

## 6. Security of processing

6.1. The Provider implements the technical and organisational measures described
in Annex II, in accordance with Article 32 GDPR.

6.2. The Provider may update these measures provided the overall level of
protection is not reduced. Significant changes are communicated to the Customer
[in writing / on a dedicated page].

## 7. Sub-processors

7.1. The Customer gives general written authorisation for the sub-processors
listed in Annex III.

7.2. The Provider informs the Customer of any intended addition or replacement
at least [30] days in advance. Within that period the Customer may object in
writing on reasonable data-protection grounds; failing agreement, the Customer
may terminate the affected part of the Service without penalty.

7.3. The Provider imposes on each sub-processor, by contract, data protection
obligations at least equivalent to those of the Agreement, and remains liable to
the Customer for their performance.

## 8. Transfers outside the European Economic Area

8.1. Some sub-processors process data outside the EEA, in particular in the
United States (Annex III). These transfers rely on [an adequacy decision,
including the EU–US Data Privacy Framework where the recipient is certified, or
otherwise the standard contractual clauses adopted by Commission Implementing
Decision (EU) 2021/914, supplemented by the necessary measures] — **to be
confirmed provider by provider**.

8.2. The Service can be configured so that language-model processing uses only a
provider established in the Union ("sovereign" mode: Mistral, with no fallback to
another provider). At the date of the Agreement, transcription of voice notes is
still performed by a provider established in the United States (Annex III);
[option: voice notes disabled for the Customer, or transcription in the Union
when available].

## 9. Data subjects' rights

9.1. Taking into account the nature of the processing, the Provider assists the
Customer by appropriate technical and organisational measures in responding to
requests to exercise the rights laid down in Articles 15 to 22 GDPR.

9.2. The Service offers Authorised Users self-service export of their data in
open formats and complete deletion; deletion also removes the person from all
their teams. SCIM provisioning lets the Customer remove a person's access to the
Team Space immediately.

9.3. The Provider forwards to the Customer without delay any request it receives
directly from a data subject concerning Customer Data, and does not answer it
without instructions, unless required by law. It provides its assistance within
[10] business days.

## 10. Personal data breaches

10.1. The Provider notifies the Customer of any personal data breach affecting
Customer Data without undue delay and at the latest [48] hours after becoming
aware of it, at [Customer's security contact].

10.2. The notification includes, to the extent known, the information listed in
Article 33(3) GDPR; information not yet available is provided as it becomes
available.

10.3. The Provider takes reasonable steps without delay to contain the breach and
mitigate its effects, and cooperates with the Customer on its own notifications
to the supervisory authority and to data subjects.

## 11. Impact assessment and prior consultation

The Provider provides the Customer with the information reasonably necessary for
a data protection impact assessment and, where applicable, prior consultation of
the supervisory authority (Articles 35 and 36 GDPR).

## 12. Return and deletion at the end of the Contract

12.1. Before the Contract ends, the Customer may export Customer Data; on request,
the Provider returns the Team Space data in an open, structured format ([JSON /
CSV]) within [30] days.

12.2. Within [30] days of the end of the Contract, the Provider deletes Customer
Data from its active systems, save where retention is required by law, and
certifies deletion in writing on request. Backup copies are erased at the end of
their rotation cycle, at the latest [period], and are not used in the meantime.

12.3. The Provider also removes the identity provider registered for the
Customer's single sign-on and revokes its provisioning tokens.

## 13. Information and audits

13.1. The Provider makes available to the Customer the information necessary to
demonstrate compliance with Article 28 GDPR, including this documentation, the
list of sub-processors and the description of security measures.

13.2. The Customer may have an audit carried out, by itself or by an independent
auditor bound by confidentiality, at most once a year save in case of a proven
breach, with [30] days' notice, during business hours and without compromising
the security or confidentiality of other customers' data. Audit costs are borne
by the Customer [unless a failure by the Provider is found].

## 14. Liability

Each party's liability under the Agreement is governed by [the liability
provisions of the Contract], without prejudice to Article 82 GDPR.

## 15. Term

The Agreement takes effect on signature and remains in force for as long as the
Provider processes Customer Data, including after the Contract ends until their
deletion.

## 16. Governing law and jurisdiction

The Agreement is governed by [Belgian / French / …] law. Any dispute falls
within the jurisdiction of the courts of [city], subject to mandatory rules.

---

Signed at [place], on [date], in two copies.

| For the Customer | For the Provider |
|---|---|
| [Name, title, signature] | [Name, title, signature] |

---

## Annex I — Description of the processing

**Data subjects**
- Authorised Users: the Customer's employees, staff, contractors.
- People mentioned in content: contacts and counterparts entered in the CRM,
  people named in notes or voice notes.

**Categories of data**
- **Account**: email address, display name in the team, job title (optional),
  technical identifier, language and time zone.
- **Authentication**: identity provider identifier, SAML attributes sent by the
  Customer's identity provider (email address, name where sent), session tokens.
- **Provisioned directory (SCIM)**: login identifier (userName), external
  identifier, given name, family name, display name, job title, email address,
  active status, group membership.
- **Team Space**: shared notes (copies chosen one by one by their author), weekly
  check-ins, kudos, team pulse answers (visible to their author only; the team
  sees averages only, from five answers), roles, verified domains, single sign-on
  configuration.
- **Personal Space** [depending on the option chosen in section 3.2]: notes,
  voice-note recordings and transcripts, reminders, contacts and deals, financial
  entries and balances, weekly reviews and decisions.
- **Technical data**: hosting providers' technical logs [retention period].

**Sensitive data.** The Service is not designed to process special categories of
data (Article 9 GDPR) or data relating to criminal convictions (Article 10).
Since free-text content may contain such data, the Customer informs its users
[and sets usage rules].

**Nature of the processing.** Hosting, storage, organisation and consultation by
users; automated processing by language models (classification, linking notes,
answering questions, transcribing voice notes), performed when the user uses the
feature; authentication, including single sign-on; synchronisation with the
Customer's directory.

**Purpose.** Providing the Service to the Customer and its Authorised Users.

**Duration.** For the term of the Contract, then as set out in section 12. An
Authorised User may delete all of their data at any time.

**Language-model processing.** Only the text needed by the feature in use (the
question asked, the relevant notes, the voice note to transcribe) is sent to the
model provider, at the time of the request. The Provider does not use Customer
Data to train models. [Confirm, for each provider in Annex III, its terms on data
sent through its API (no training, retention period).]

## Annex II — Technical and organisational measures

Listed here are only measures in place in the software at the date of this
document; items [in brackets] concern operations and are to be completed.

1. **Access control.** Authentication by Supabase Auth, including SAML single
   sign-on; the session is re-verified with Supabase on every access to a
   protected page. Per-user isolation enforced by the database (row-level
   security) on every data table.
2. **Team boundary enforced in the database.** Membership and role changes go
   through functions that apply the rules (exactly one owner; a member cannot
   grant themselves a role); column privileges limit what a direct write may
   change. No policy gives a team access to its members' Personal Spaces. Members
   are named in pages by opaque identifiers, never by their account.
3. **Required single sign-on.** When the Customer requires it, a member not signed
   in through the Customer's identity provider is no longer a member of the team
   as far as the database is concerned (the owner excepted, so the team can never
   be locked out). The trusted identity provider and domain verification can only
   be written by the server, after checking (registration with Supabase Auth;
   reading the DNS record).
4. **Joiners and leavers.** SCIM 2.0 provisioning: a person deactivated or deleted
   in the Customer's directory is removed from the team immediately; administrator
   roles granted by a directory group are withdrawn with it.
5. **Secrets.** Invitation links and provisioning tokens stored as SHA-256
   fingerprints, shown once, revocable; at most five live tokens per team.
   Passwords are handled by Supabase Auth; LifeOS stores none. The database
   service key is used server-side only.
6. **Minimisation.** For single sign-on, only the address's domain is sent to find
   the identity provider. The team pulse is shown only as averages, from five
   answers. Sharing a note is an explicit act, note by note.
7. **Encryption.** In transit: HTTPS [confirm the hosting configuration]. At rest:
   provided by the database host [confirm against Supabase's security
   documentation and the plan subscribed].
8. **Data subjects' rights.** Complete self-service export in open formats (the
   JSON and ZIP exports include the profile, the brain, projects, deals,
   finances, reminders, reviews and what the person wrote in teams) and complete
   deletion; deletion removes the person from all their teams.
9. **Development.** Automated test suite (690 tests at the date of this
   document), including a test that fails the build if an API route does not
   authenticate its caller; database migrations validated on Postgres with their
   access policies; security updates of dependencies.
10. **Logging and monitoring**: [to complete — the Service does not currently
    have an application audit log of administrative actions].
11. **Backups and continuity**: [frequency, retention and region of backups,
    depending on the Supabase plan; restore procedure].
12. **Organisation**: [authorised personnel and confidentiality undertakings;
    incident management procedure; security contact; periodic access review].

## Annex III — Sub-processors

List drawn from the services the software actually calls. Legal names, regions
and safeguards are **to be confirmed** before signature.

| Sub-processor | Purpose | Data concerned | Location | Transfer safeguards |
|---|---|---|---|---|
| Supabase [legal name] | Database, authentication (including SAML), storage of audio recordings | All Customer Data | [Project region] | [Provider's DPA; SCCs if outside the EEA] |
| Vercel [legal name] | Hosting and running the application | Data in transit, technical logs | [Regions] | [To confirm] |
| Groq [legal name] | Language models; voice-note transcription | Text and recordings sent on request | United States | [EU–US DPF or SCCs — to confirm] |
| Cerebras [legal name] | Fallback language model [configured; may be removed] | Text sent on request | United States | [To confirm] |
| Mistral AI [legal name] | Language models ("sovereign" mode) | Text sent on request | European Union [to confirm] | Processing in the EU |
| Resend [legal name] | Sending the agent's emails | Recipient address, message content | [To confirm] | [To confirm] |
| [Agent server provider] | Running the autonomous agent, away from the user's own machine | Context sent to the agent | [To confirm] | [To confirm] |
| Telegram — *only if the user links their account* | Conversation channel with the agent, voice notes, reminders | Messages exchanged with the bot | [To confirm] | Enabled by the user |
| Notion — *only if the user connects Notion* | Optional export | Exported content | United States | Enabled by the user |
| Stripe — *once billing is enabled* | Payment | Billing data | [To confirm] | [To confirm] |
