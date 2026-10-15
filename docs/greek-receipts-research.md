# Legal receipts from a scan: research notes (Greece)

Saved 10 October 2026. No code was written for this.

The research below came from a separate session. It drew on the tax authority's own pages (ΑΑΔΕ), the text of the tax procedure law, and Greek tax and vendor sources. Only the section "What this project is missing" was checked against the code in this repository; the legal and tax content was not re-verified.

This is research, not legal or tax advice. Several details changed between 2024 and 2026, so confirm the final design with an accountant.

## Short answer

Yes, it is realistic for a scan to produce the legal receipt automatically. The practical route is a certified e-invoicing provider, not a cash register.

## How receipts legally work in Greece

- **Every retail sale needs a receipt** (απόδειξη λιανικής), issued through an approved channel. A receipt printed by ordinary software on its own is not valid.
- **Every receipt is reported to the tax authority** through its myDATA platform, which returns a unique registration number (ΜΑΡΚ). The receipt also carries a QR code.
- **Card payments must be tied to the receipt.** The card terminal (POS) has to be interconnected with whatever issues the receipt, so the payment and the receipt match.
- **The old "signing boxes" are gone.** The devices that used to sign receipts for commercial software (ΕΑΦΔΣΣ) were withdrawn for all businesses during 2024.

## The three legal ways to issue a retail receipt

| Route | What it is | Fit for this project |
|---|---|---|
| Certified e-invoicing provider (πάροχος, ΥΠΑΗΕΣ) | A licensed company signs each receipt and reports it to myDATA. Our software calls the provider over the internet. | Best fit. No special hardware, and built for software like ours. |
| Fiscal device (ΦΗΜ) | A cash register (ΦΤΜ), or a fiscal unit driven by external software (ΑΔΗΜΕ). | Possible, but ties each shop to one manufacturer's device and its connection method. |
| ΑΑΔΕ's free apps (timologio, myDATAapp) | Receipts typed in by hand. | Cannot be automated. Only a fallback. |

ΑΑΔΕ publishes the list of licensed providers: 40 products, including Epsilon Digital, SoftOne, Oxygen Pelatologio, Primer, Impact, Wrapp and Viva Fiscal. Several are marked "All in one Cash Register/POS".

## How scan-to-receipt would work with a provider

1. The seller scans the items and confirms the sale, as today.
2. Our system sends the sale to the provider: items, quantities, prices, VAT per line, and how it was paid.
3. The provider signs it, reports it to myDATA, and returns the registration number and QR code.
4. If the customer pays by card, our system sends the amount, with the provider's signature, to the card terminal. This is the flow set by decision Α.1155/2023. A cash sale skips this step.
5. The receipt is printed or sent to the customer.

Payment companies publish developer guides for step 4 (EveryPay and Stripe Terminal both document it). They expect the software vendor to pass test scenarios in a sandbox before going live.

## What this project is missing

This is a list of gaps, not a plan. Each one was checked against the code on 10 October 2026, and all six hold.

| Gap | What the code has today |
|---|---|
| **VAT rate per item.** Rates are 24%, 13% and 6%, with reduced rates on some Aegean islands. | Confirmed. `Item` has a price and a discount percentage and nothing about VAT ([Item.cs](../src/Services/Catalog/Catalog.Api/Data/Item.cs)). Nothing records whether prices include VAT. |
| **A basket.** A receipt normally covers several products in one sale. | Confirmed, with one correction: a sale is one product at a chosen quantity, not strictly one unit. `POST /scan/{barcode}/sell` takes a quantity ([ScanEndpoints.cs](../src/Services/ScanGateway/ScanGateway.Api/Endpoints/ScanEndpoints.cs)). There is no sale record at all. A sale exists only as a `StockMovement` row with reason `Sale`, and nothing groups rows into one transaction ([StockMovement.cs](../src/Services/Inventory/Inventory.Api/Data/StockMovement.cs)). |
| **Payment method** on each sale (cash, card and so on). | Confirmed. Nothing stores it. |
| **Returns and cancellations.** A legal receipt cannot be deleted; it is reversed with a credit document. | Confirmed. The movement reasons are Intake, Restock, Sale, ManualAdjust and PurchaseOrderReceipt. There is no return or refund. The ledger is already append-only, which suits the "reverse, never delete" rule. |
| **Receipt numbering, printing, and the business's tax details** (ΑΦΜ, address, activity). | Confirmed. The only shop-level setting is the time zone ([ShopTime.cs](../src/ServiceDefaults/ShopTime.cs)). There is no receipt number, no printing and no business profile. |
| **Behaviour when the internet or the provider is down.** | Confirmed. A sale is a live call from the browser through Scan Gateway to Inventory, with no offline queue or retry store. |

Two things the check turned up that the research did not list:

- **The price actually paid is already stored.** Each sale row keeps the unit price with the discount applied, so a receipt line would not have to guess the amount later. Sales recorded before that field existed have no price.
- **The system is built for one shop.** There is no concept of separate businesses in the data. This matters for the section on selling to other businesses below, because each shop's receipts go out under its own tax number.

## Law and decisions that apply

| Law or decision | What it covers |
|---|---|
| ν. 4308/2014 (Ελληνικά Λογιστικά Πρότυπα), άρθρο 12 | The duty to issue a retail document per sale, and to do it through a fiscal device. |
| ν. 5104/2024 (Κώδικας Φορολογικής Διαδικασίας) | Books, electronic transmission, and the penalties below. |
| Κώδικας ΦΠΑ (ν. 2859/2000) | VAT rates and rules. |
| Α.1138/2020 | myDATA: what is transmitted, document types, timing. |
| Α.1098/2022 | Interconnection of cash registers with card terminals. |
| Α.1155/2023 (amended by Α.1074/2024, Α.1102/2024, Α.1160/2025) | Interconnection of card terminals with software and providers. |
| Α.1155/2024 | Withdrawal of the old signing devices (ΕΑΦΔΣΣ). |
| Α.1112/2025 | The declaration that a business has started issuing through a provider. The provider files it. |
| Α.1128/2025, Α.1044/2026 | Mandatory e-invoicing between businesses: from 2 March 2026 for revenue over €1 million, from 1 October 2026 for everyone else. This does not change how retail receipts are issued. |
| άρθρο 13Α ν. 2523/1997 (applied by Α.1169/2021, Α.1093/2024) | Temporary closure of a shop for receipt violations. |

## Penalties

From άρθρο 57 of ν. 5104/2024, as published on Taxheaven:

- **Not issuing a receipt, or issuing a wrong one (VAT sale):** 50% of the VAT, with a minimum of €250 for simple books or €500 for double-entry. A repeat is 100% (minimum €500 or €1,000), and each further repeat is 200%.
- **Issuing receipts without a valid device, provider or approved software:** a heavy fine based on revenue, or €5,000 / €10,000 per audit if the sales were already declared.
- **Tampering with a device or provider:** €100,000 for whoever develops, resells or supports it. This is the clause a software maker must take seriously.
- **Card terminal not interconnected:** €10,000 or €20,000, per ΑΑΔΕ's own announcement.
- **Shop closure:** 48 hours for receipt violations found in an audit. One source gives 96 hours for a repeat. The exact thresholds need checking in the current text.

## What it means for selling this to other businesses

- **Each shop needs its own contract with a provider.** The receipts are issued in that shop's name and tax number.
- **Providers must vet the software connected to them.** The law fines a provider €15,000 for failing "due diligence" on connected systems, so expect a review of our software.
- **Becoming a provider yourself needs a licence from ΑΑΔΕ.** That only makes sense at much larger scale.
- **Cost is not pinned down.** A comparison site showed monthly plans from about €10 to €50 for small volumes, but there was no reliable price for retail receipts through an API. Ask two or three providers for quotes.

## What the research could not confirm

- **The exact step order in Α.1155/2023.** The decision's full text was not read. The flow above comes from payment companies' developer guides.
- **Whether retail receipts may be sent to myDATA straight from our software, with no provider.** The sources found are from 2021 to 2023 and do not settle it for today. ΑΑΔΕ's current penalty text treats device, provider or "approved software" as the valid channels.
- **Which listed providers offer a retail-receipt API to outside software, and at what price.**
- **The current closure thresholds and the island VAT rates for 2026.**

## Suggested next steps

1. Ask an accountant to confirm the provider route for a retail shop on simple books.
2. Contact two or three providers from ΑΑΔΕ's list and ask three things: retail receipts by API, a test environment, and card-terminal interconnection under Α.1155/2023.
3. Decide the scope: receipts for cash only at first, or cash and card together.
4. Once a provider is chosen, turn this into a build plan.

## Sources

The original research listed these by title. The links were not carried over, so they are titles only.

- ΑΑΔΕ: licensed e-invoicing provider software
- ΑΑΔΕ: POS and cash-system interconnection
- ΑΑΔΕ: decision Α.1155/2023 (PDF)
- ΑΑΔΕ: decision Α.1155/2024 on withdrawing ΕΑΦΔΣΣ (PDF)
- ΑΑΔΕ: myDATA API documentation for providers, v2.0.2 (PDF)
- ΑΑΔΕ: text of ν. 5104/2024 (PDF)
- Taxheaven: ν. 5104/2024, άρθρο 57
- Taxheaven: ν. 5104/2024, άρθρο 54
- Taxheaven: POS interconnection fines
- Taxheaven: ΠΟΛ 1102/2017 on suspension of operation
- Forin: Α.1093/2024 on suspension of operation
- CNN Greece: deadlines for cash registers, devices and software interconnection
- Νομικά Επίλεκτα: e-invoicing and myDATA in 2026
- Wrapp: declaration of start of electronic issuance (Α.1112/2025)
- Lido: comparison of e-invoicing providers
- EveryPay: Greek compliance integration guide (A.1155)
- Stripe Terminal: AADE data model
- Forin: VAT rates in Greece
