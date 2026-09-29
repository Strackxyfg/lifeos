# Legal documents

| File | What | State |
|---|---|---|
| [`DPA.fr.md`](DPA.fr.md) | Data processing agreement (GDPR art. 28), French | **Template** — to complete and have reviewed |
| [`DPA.en.md`](DPA.en.md) | The same, English | **Template** — to complete and have reviewed |

## Before a DPA goes to a customer

1. **Fill every `[bracket]`**: the publisher's legal identity and privacy
   contact, the customer, time limits, governing law.
2. **Decide section 3.2** (who is controller of each user's personal space): an
   employer-paid seat with a brain the employer cannot read is unusual, and the
   answer changes Annex I.
3. **Confirm Annex III provider by provider**: legal name, processing region,
   transfer mechanism (EU–US Data Privacy Framework certification, or SCCs), and
   their terms on API data (training, retention). Nothing there was assumed: the
   brackets are what is not known from the code.
4. **Complete Annex II's operational items**: backups (Supabase plan, region),
   incident procedure, who has access.
5. **Have a lawyer review it.** It was written from the software's actual
   behaviour, not by counsel.

## Keeping it true

Annex III lists the services the code calls. When a provider is added (a new
`*_API_KEY`, a new `https://` endpoint in `lib/`), or one is removed, update
Annex III in both languages — and notify customers 30 days ahead (section 7.2).
Annex II lists only measures that exist; do not add one before it ships.

## Still missing for a commercial launch

The public pages French law requires of a commercial site — **mentions
légales**, **conditions générales**, **politique de confidentialité** — do not
exist yet (see `docs/00-PRODUCT.md`, "Avant de lancer").
