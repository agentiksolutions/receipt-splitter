# How US bill-split apps move money, and which paths are free (2026-09-12)

Researched 2026-09-12. Every claim below is tied to a URL in the Sources list.

## Bottom line

No US consumer payment network offers a third-party peer-to-peer API. Not Venmo, not Cash App, not Zelle, not Apple Cash. Every split app that avoids fees does the same thing: it stores the payer's handle, builds a link, and hands the user to the payment app. Money never touches the split app. The apps that do move money in-app either became a licensed money transmitter or rented a bank. Splitwise rented one.

## 1. Venmo

The custom scheme venmo://paycharge is not Venmo's own. Venmo's iOS SDK builds a different URL. In venmo/venmo-ios-sdk, NSURL+VenmoSDK.m formats every app-switch as "venmosdk://venmo.com" plus a path, and its unit test asserts exactly that string. Venmo.m builds the path in URLPathWithType: as "/?" plus a query of client, app_name, app_id, device_id, txn, note, app_version, amount and recipients. The word "paycharge" appears nowhere in the repository. I scanned every .m, .h, .md and .swift file in it.

That SDK is dead. GitHub reports venmo/venmo-ios-sdk archived, last push 2019-08-23, and venmo/app-switch-android archived, last push 2019-01-15. The scheme also required an app_id and app_secret registered on a developer site that no longer exists.

developer.venmo.com returns 404 today. The Wayback CDX index shows the payment-links documentation returning 200 in April and May 2016 and 404 by 2022-01-24. The archived 2016 page states Venmo "discontinued accepting new beta users of the API as we are focusing efforts to open up the beta to pay with Venmo." Venmo payment links were documented once and the documentation was withdrawn. Today the pattern is tolerated, not documented.

On the web link I can be precise. https://venmo.com/.well-known/apple-app-site-association is the file iOS reads to decide which URLs open the app. The production app, appID 6DEPQ9SPDK.net.kortina.labs.Venmo, claims 121 paths. The bare root "/" is not among them. There is no "/*" wildcard and there are no exclusion entries. On iOS, https://venmo.com/?txn=pay&recipients=...&amount=...&note=... is therefore not handed to the Venmo app by the universal link mechanism. It loads a web page.

"/u/*" is claimed. https://venmo.com/u/<username> does open the app on iOS.

One limit, stated plainly. That file governs universal links only. It says nothing about the venmo:// custom scheme, which lives in the app's Info.plist and cannot be read from the web. I tested from Windows with curl and could not put this on a 2026 iPhone. "The root query URL is not a universal link" is verified. "The custom scheme no longer works" is not verified by me.

Where the paycharge syntax actually comes from: a 2017 blog post by Alex Beals, who extracted the strings from the app binary. He is explicit about the provenance. "I tried to deeplink into the Venmo app, but couldn't find a lot of public documentation on it. So I cracked the main app, and found all of the deeplinking strings." His example is venmo://paycharge?txn=pay&recipients=Alex-Beals&amount=10&note=Note, and he notes that changing txn to charge turns a payment into a request. That is the origin of every copy of this pattern on the internet, and it is reverse engineering from nine years ago, not a specification.

Field evidence says the undocumented path is decaying. Splitwise's help article carries this note: "As of 7/2/26, the Venmo integration is not compatible with our Android app due to a change on Venmo's end."

One more Venmo surface worth knowing about. The same association file claims /code, /qrcode/*, /qrcodes/* and /profile/qrcode. Venmo QR codes are therefore real deep links, but I could not determine what they encode, so a web app cannot generate one.

Pay with Venmo is the merchant rail and it is not free. PayPal's fee schedule lists "Pay with Venmo, 3.49% + fixed fee", and the US dollar fixed fee is 0.49. The Accept Venmo page states it directly: "There are no monthly or setup fees to accept Venmo at online checkout. You pay 3.49% + $0.49 per transaction for standard domestic payments." Braintree's Venmo guide adds hard constraints: US-based business entities only, Venmo "does not work when loaded within an iframe element", and no WebView.

No P2P API exists for third parties. Your assumption is correct and now sourced three ways: the developer site is gone, both official SDKs are archived, and Venmo said in 2016 it was closing the API beta in favor of the merchant product.

Venmo's own split feature is in-app only. The current App Store listing, version 26.19.0 updated 2026-09-08, describes "SPLIT A REQUEST AMONG MULTIPLE VENMO FRIENDS. You can now send a payment request to multiple Venmo friends at once and customize the amount each person owes." There is no third-party entry point into it.

## 2. Cash App

The cashtag link is a genuinely claimed deep link. https://cash.app/.well-known/apple-app-site-association lists, for 3Q5FAW8734.com.squareup.cash, the paths "/$*", "/pay/*", "/request/*", and an exclusion "NOT /$*/confirmation/*". So https://cash.app/$cashtag and https://cash.app/$cashtag/25 open Cash App on iOS. Unlike Venmo's root URL, this one is claimed by the app itself, which is the strongest evidence available without a phone.

Cash App's Terms of Service define the $Cashtag as "a unique alpha-numeric name to identify yourself on the Service" but do not document the URL format anywhere I could find. The link is supported by the app's own link registration and unofficial in prose.

I could not resolve a live cashtag page from this machine. Every cashtag I tried returned 404 to curl, so I could not confirm server-side that the /25 segment prefills the amount. The path claim is verified. The prefill is not.

Cash App Pay is merchants only. Section XVII of the Terms says "Only Company-approved merchants ("Merchants") may accept" it, and the described flows are checkout on a merchant site, a QR at checkout, or a point-of-sale device. Through Stripe it costs 2.9% + 30 cents, requires a US business location, is B2C only with B2B explicitly unsupported, and settles T+2. I checked Stripe only. Adyen and Square pricing for Cash App Pay is unverified here, though both are merchant acquiring and neither changes the conclusion that this rail requires being a merchant.

Block, Inc. runs this as a licensed money transmitter. Its license page lists NMLS 942933 and a separate state license number for each jurisdiction.

## 3. PayPal

PayPal.Me is real and current. https://www.paypal.me/ 301-redirects to https://www.paypal.com/paypalme/, and https://www.paypal.me/<user>/<amount> redirects to https://www.paypal.com/paypalme/<user>/<amount> and returns 200 rather than 404.

PayPal's own description of the flow puts the amount on the payer, not the link: "Friends, family, or customers can follow the link, enter any amount and that's it."

I could not verify the amount prefill. The PayPal.Me profile page is a client-rendered shell. I fetched it with and without an amount segment and found no amount, currency code or prefill token in either version of the HTML. Mark this unverified.

On prefilling a request rather than a payment, I found no PayPal documentation either way. PayPal's Request Money feature lives inside PayPal and I saw no third-party entry point to it, but absence of a document is not a prohibition. The one piece of indirect evidence is Splitwise, which as an integrator says "You cannot request a payment through Venmo or PayPal on Splitwise. Payments must be initiated by the sender." That tells you what Splitwise built, not what PayPal forbids.

Fees matter more here than for the others, because PayPal has two rails and the payer picks. A domestic personal transaction funded by PayPal balance or a bank account is "No fee". Funded by a card it is 2.90% plus a fixed fee. If the payment is flagged as goods and services it becomes a commercial transaction at 2.99%, or 3.49% + 0.49 at checkout. A PayPal.Me link that a friend routes through the wrong tab costs someone money, and Halfsies cannot control which tab they pick.

## 4. Zelle

There is no third-party API and no link format. Zelle is run by Early Warning Services, LLC and reaches consumers only inside a bank's own app. Its site says Zelle is "available in over 2,400 banking and credit union apps". The only integration path it publishes is for banks: "Join the Zelle Network Today ... Select your reseller below. If you do not work with one of the resellers, complete the form and an Early Warning representative will contact you." Nothing there is open to an app developer.

Recipients are identified by enrolled email, US mobile number, or Zelle Tag. Zelle publishes no URL scheme, no universal link and no amount parameter.

On the QR code I have to report a gap rather than a finding. I checked Zelle's how-it-works, FAQ, personal and help-center pages plus the Bank of America and Wells Fargo Zelle pages, and none of them documents a QR code. There is no published spec for what a Zelle QR encodes. A web app cannot generate one, because there is nothing to encode against. If a bank app displays a QR for its own customer, that is that bank's proprietary format. Treat "what it encodes" and "which bank apps scan it" as unverified.

Zelle is free to consumers: "Typically, there are no fees for consumers to send or receive money with Zelle", and a Q1 2026 survey put 99.40% of linked accounts at no fee to send, receive or request.

## 5. Apple Cash

No third-party API exists. Apple's Apple Pay developer page and the PassKit documentation contain zero occurrences of "Apple Cash". There is no framework, no entitlement and no documented URL scheme.

Every path runs inside Apple's own UI. To send: "Open the Messages app ... Tap the plus icon, then tap Apple Cash. Enter the amount you want to send, and tap Send." To request: "Tap the plus icon, tap Apple Cash, enter the amount, then tap Request."

On the premise that Messages detects a dollar amount and offers Apple Cash, Apple's current support article does not describe that. It documents the plus-icon app drawer and says nothing about parsing typed text. Either the behavior was removed or Apple never documented it. Unverified. See the Addendum for the full check.

## 6. How the actual apps do it

Splitwise, free tier. Money does not move through Splitwise. Its help article describes the flow: tap Settle up, tap the balance, "Tap Third party options", then "Send via PayPal" or "Send via Venmo", and "you will be redirected to PayPal or Venmo to complete the payment." Two constraints are stated: US only, USD only, and for Venmo "you must owe a balance in USD and have the Venmo app installed and logged in on your device." The recipient field is prefilled with the primary email address on the friend's Splitwise account. The amount is not described as prefilled. The App Store listing confirms the scope: "Pay back using our integrated payments: Venmo and PayPal (US only), Paytm (India only)." Cost to the user is whatever PayPal or Venmo charges. Splitwise needs no license for this because it never holds funds. Note the Android breakage dated 7/2/26 quoted in section 1.

Splitwise Pay, US. This is the licensed path, and Splitwise rented the license rather than buying it. Its page says plainly: "Splitwise is a financial technology company, not a bank. Banking services provided by Coastal Community Bank, Members FDIC." The KYC burden is visible to the user: "To comply with Federal law, Splitwise Pay requires a verified phone number, legal name, home address, date of birth, and Social Security number." US residents 18 or older, connect a US checking account, approval by both Splitwise and Coastal. Cost: "Splitwise Pay does not charge transaction fees for standard electronic funds transfers and there is no monthly fee or cost to sign up." Free to the user, expensive to build. The Splitwise Card is a Mastercard debit drawing on the same wallet.

Splitwise's public API at dev.splitwise.com covers users, groups, friends and expenses. It exposes no payment endpoints.

Tricount, by Tricount SA, owned by bunq. Its App Store listing offers to "Send and receive payment requests instantly through the app" and is "Free and unlimited, no subscription, no hidden fees." Requests, not transfers, and the settlement rails behind bunq are European. This is not a US money-movement path.

Settle Up, by Step Up Labs, Inc. A ledger and a settlement optimizer. Its pitch is minimizing transfers: "Our unique algorithm calculates the fewest possible transfers to settle all debts." Free with a premium tier for ads, recurring expenses and similar extras. No money moves.

Splid, by Nicolas Jersch. Free, no sign-up required, works offline, 150+ currencies. A ledger with no payment rail and no processor.

Tab, the simple bill splitter, by bring10, LLC, App Store id 595068606. Receipt photo, tap your items, tax and tip calculated. Its App Store description contains no payment language at all. No money moves. I pinned the identity through the App Store because "Tab" collides with several other split apps.

Plates by Splitwise. Free check-splitting calculator, "Split with up to 10 people", and its own page pushes you to Splitwise if you want to track IOUs. Last updated 2020-12-07. No money moves.

Venmo's own split. Covered in section 1. In-app, no third-party entry.

The pattern across all seven: exactly one moves money in-app in the US, and that one has a bank partner and collects Social Security numbers.

## 7. The regulatory line

Under 31 CFR 1010.100(ff)(5) a money transmitter is "A person that provides money transmission services", and money transmission services means "the acceptance of currency, funds, or other value that substitutes for currency from one person and the transmission of currency, funds, or other value that substitutes for currency to another location or person by any means." A money transmitter is a money services business, and FinCEN requires that "each money services business (MSB) must register with the Department of the Treasury" on Form 107 within 180 days, renewing every two years. Federal registration is only half the cost, because money transmission is licensed state by state, which is why Block, Inc. publishes NMLS 942933 alongside a separate license number for each jurisdiction it operates in. Deep links avoid all of this because of the exclusion in the same regulation: the term does not include a person that only "Provides the delivery, communication, or network access services used by a money transmitter to support money transmission services." An app that composes a URL and hands the user to Venmo, where the user authenticates and authorizes their own payment, never accepts or transmits funds. Splitwise leans on the matching idea for its ledger, telling users that "Bills, IOUs, debts and payments recorded on Splitwise are informal records, and not legally binding contracts of some kind."

## 8. Conclusion

Free, no-processor paths available to a US web app today.

```
Path                                  Prefilled                 Friend still taps
------------------------------------  ------------------------  ----------------------------
cash.app/$<cashtag>/<amount>          recipient, amount*        open, confirm, pay
venmo.com/u/<username>                recipient only            Pay or Request, type amount,
                                                                type note, confirm
venmo://paycharge?txn=charge          recipient, amount, note   confirm, if it fires**
  &recipients=&amount=&note=          per a 2017 binary dump**
paypal.com/paypalme/<user>/<amount>   recipient, amount*        pick Friends and Family,
                                                                confirm amount, send
Zelle                                 nothing available         everything, by hand in their
                                                                bank app
Apple Cash                            nothing available         everything, by hand in Messages
Copy to clipboard, or an SMS body     amount and note as text   paste into any app
```

\* Amount prefill unverified from a server-side fetch. The URL path is accepted in both cases. Test both on a real iPhone and a real Android device before shipping.

\*\* These parameter names come from Alex Beals cracking the Venmo binary in 2017, not from any Venmo document, and they appear nowhere in Venmo's own SDK. I could not test whether the scheme still fires on a 2026 device. Treat this whole row as a hypothesis to test on hardware, not as a documented capability.

Also present but unusable: Venmo registers /code, /qrcode/*, /qrcodes/* and /profile/qrcode as deep links, and Zelle QR codes exist inside bank apps. Neither publishes what its QR encodes, so a web app cannot generate either one.

## Recommendation for Halfsies

Store handles, never money. Give each person a settle-up row that renders their saved Venmo username, cashtag and PayPal.Me handle as links, and record "marked as paid" as a ledger entry the way Splitwise does. That keeps Halfsies inside the network-access-services exclusion in section 7, needs no license, no bank partner and no Social Security numbers, and costs nothing per transaction.

Lead with Cash App. Its cashtag path is the only amount-carrying consumer link I could verify against a first-party artifact, because Cash App registers "/$*" as a universal link in its own association file. Treat Venmo as the one users will ask for and the one most likely to break: ship venmo.com/u/<username>, which is registered as "/u/*" and will keep working, and put a copy-the-amount button beside it so the extra typing is one paste. Offer the undocumented paycharge link only as a progressive enhancement behind device detection, and expect to maintain it. Splitwise, a far bigger partner than Halfsies will ever be, lost that path on Android on 7/2/26 to a change on Venmo's end. Drop Zelle and Apple Cash from the design. Neither exposes anything to link to.

Do not reach for Pay with Venmo, Braintree or Cash App Pay to close the gap. Beyond the 3.49% + 0.49 and the 2.9% + 30 cents, those rails make Halfsies the merchant of record for money that is not its revenue. That is the same posture section 7 describes, and it is the reason "no Stripe" should also rule out Braintree. If Halfsies ever does need money to move in-app, the honest version of that project is the Splitwise Pay shape: a sponsor bank, a KYC flow that asks users for a Social Security number, and state licensing behind the partner. That is a company, not a feature.

## Sources

All read on 2026-09-12 unless noted. First-party unless marked.

Venmo

- https://venmo.com/.well-known/apple-app-site-association (121 claimed paths, no "/", "/u/*" present, /code and /qrcode/* present; appID 6DEPQ9SPDK.net.kortina.labs.Venmo)
- https://account.venmo.com/.well-known/apple-app-site-association (2 paths only)
- https://venmo.com/.well-known/assetlinks.json (Android, com.venmo)
- https://raw.githubusercontent.com/venmo/venmo-ios-sdk/master/venmo-sdk/Categories/NSURL+VenmoSDK.m
- https://raw.githubusercontent.com/venmo/venmo-ios-sdk/master/venmo-sdk/Venmo.m
- https://raw.githubusercontent.com/venmo/venmo-ios-sdk/master/venmo-sdk-specs/NSURL+VenmoSDKSpec.m
- https://raw.githubusercontent.com/venmo/venmo-ios-sdk/master/README.md
- https://api.github.com/repos/venmo/venmo-ios-sdk (archived true, pushed 2019-08-23)
- https://api.github.com/repos/venmo/app-switch-android (archived true, pushed 2019-01-15)
- https://developer.venmo.com/ (404)
- http://web.archive.org/cdx/search/cdx?url=developer.venmo.com/paymentlinks (200 in 2016-04 and 2016-05, 404 by 2022-01-24)
- https://web.archive.org/web/20160505194356id_/https://developer.venmo.com/paymentlinks
- https://blog.alexbeals.com/posts/venmo-deeplinking (COMMUNITY, 2017-05-24, binary dump)
- https://itunes.apple.com/lookup?id=351727428 (Venmo app v26.19.0, updated 2026-09-08)
- https://help.venmo.com/cs/articles/check-or-edit-your-username-vhel208

Pay with Venmo and Braintree

- https://www.paypal.com/us/webapps/mpp/merchant-fees (Pay with Venmo 3.49% + fixed; US dollar fixed fee 0.49)
- https://www.paypal.com/us/business/accept-payments/accept-venmo (3.49% + $0.49, no monthly or setup fees)
- https://developer.paypal.com/braintree/docs/guides/venmo/overview (US entities only, no iframe, no WebView)

Cash App

- https://cash.app/.well-known/apple-app-site-association ("/$*", "/pay/*", "/request/*", "NOT /$*/confirmation/*")
- https://cash.app/legal/us/en-us/tos (Cash App ToS, last updated 2026-09-11; $Cashtag definition; Section XVII Cash App Pay, approved merchants only)
- https://docs.stripe.com/payments/cash-app-pay.md (US only, B2C, T+2)
- https://stripe.com/pricing/local-payment-methods (Cash App Pay 2.9% + 30 cents)
- https://block.xyz/legal/licenses (NMLS 942933 plus per-state license numbers)

PayPal

- https://www.paypal.me/ and https://www.paypal.me/<user>/<amount> (301 to paypal.com/paypalme/..., HTTP 200)
- https://www.paypal.com/paypalme/ ("follow the link, enter any amount")
- https://www.paypal.com/us/webapps/mpp/paypal-fees (domestic personal transaction from balance or bank: No fee; card: 2.90% + fixed fee)

Zelle

- https://www.zelle.com/how-it-works
- https://www.zelle.com/faq (typically no consumer fees; 99.40% of accounts, Q1 2026)
- https://www.zelle.com/financial-institutions (bank and reseller onboarding only)
- https://www.zelle.com/personal (email, US mobile number, or Zelle Tag)
- https://www.bankofamerica.com/online-banking/mobile-and-online-banking-features/zelle/
- https://www.wellsfargo.com/online-banking/zelle/
- No QR documentation on any of the six.

Apple Cash

- https://support.apple.com/en-us/105013 (send and request in Messages)
- https://support.apple.com/en-us/HT207886 (set up Apple Cash)
- https://developer.apple.com/apple-pay/ and https://developer.apple.com/documentation/passkit (zero occurrences of "Apple Cash")

Splitwise

- https://kb.splitwise.com/payment-integrations/how-do-i-send-money-via-paypal-or-venmo (Third party options; redirect; recipient prefilled with email; Android note 7/2/26)
- https://kb.splitwise.com/payment-integrations/can-i-request-a-payment-via-venmo-or-paypal
- https://kb.splitwise.com/payment-integrations/how-do-i-send-money-to-someone-on-splitwise
- https://www.splitwise.com/pay (Coastal Community Bank; SSN and KYC; no transaction fees)
- https://www.splitwise.com/card
- https://www.splitwise.com/terms ("informal records, and not legally binding contracts")
- https://dev.splitwise.com/ (users, groups, friends, expenses; no payment endpoints)
- https://itunes.apple.com/lookup?id=458023433 ("Venmo and PayPal (US only), Paytm (India only)")

Other split apps, identity pinned via the Apple App Store lookup API

- Tricount SA, id 349866256, free, v14.1.0 updated 2026-07-13; https://www.tricount.com/en/ (site links to bunq)
- Settle Up, Step Up Labs, Inc., id 737534985, v3.17.0 updated 2026-06-30; https://settleup.io/
- Splid, Nicolas Jersch, id 991473495, v1.9.1 updated 2026-05-04; https://splid.app/english
- Tab - The simple bill splitter, bring10, LLC, id 595068606, v3.128.0 updated 2026-06-10
- Plates by Splitwise, Splitwise, Inc., id 669801762, v1.4 updated 2020-12-07; https://plates.splitwise.com/

Regulatory

- https://www.law.cornell.edu/cfr/text/31/1010.100 (money transmitter definition at (ff)(5)(i)(A); exclusions at (ff)(5)(ii), including (A) delivery, communication or network access services)
- https://www.ecfr.gov/api/versioner/v1/full/2026-09-10/title-31.xml?chapter=X&part=1010&section=1010.100 (authoritative eCFR text, same definition)
- https://www.fincen.gov/money-services-business-definition (MSB registration, Form 107, 180 days, renew every two years)

## What I could not verify

1. Whether venmo:// custom scheme URLs still open the app on a 2026 iPhone. The association file governs universal links only and says nothing about custom schemes, which live in the app's Info.plist and cannot be read from the web.
2. Whether cash.app/$cashtag/<amount> prefills the amount. Every cashtag I requested returned 404 to curl from this machine.
3. Whether paypal.com/paypalme/<user>/<amount> prefills the amount. The page is client-rendered and neither version of the HTML contained an amount or currency token.
4. What a Zelle QR code encodes, and which bank apps scan it. No published spec on zelle.com or the two bank pages I checked.
5. Whether Messages detects a typed dollar amount and offers Apple Cash. Apple's current article documents only the plus-icon app drawer.
6. Adyen and Square pricing for Cash App Pay. I checked Stripe only.

Items 1 through 3 are all answerable in about ten minutes with one iPhone and one Android phone, and all three change what Halfsies should build. They are the first thing to test.

## Method note

WebSearch and WebFetch were not available, so this research used curl and Python over HTTP. That turned out to help. The strongest evidence in the report is machine-readable first-party artifacts rather than marketing copy: the Apple app-site-association files that Venmo and Cash App publish, which are the authoritative record of which URLs open their apps.

## Addendum

### Section 5 addendum (a): tappable dollar amounts in Messages

Apple does not document this behavior anywhere I could find. Surfaces checked, all of them: support.apple.com/en-us/105013 "Send and receive money with Apple Cash", support.apple.com/en-us/HT207886 "Set up Apple Cash", the iPhone User Guide page send-and-receive-money-iph1c8ba6e69, developer.apple.com/apple-pay/, developer.apple.com/documentation/passkit, and the Apple support search. Every one of them describes only the plus-icon app drawer.

That is a documentation gap, not a refutation. Apple documents very little of what the Messages data detectors do, so if you have seen a Send or Request suggestion appear under an amount, I am not contradicting you. What I can say is that the trigger formats ("$24.18" against "24.18 dollars") and whether it fires on the sender's own outgoing message or only on a received one are unverified, and there is no Apple document to build against. Treat it as undocumented platform behavior that can change in any iOS point release.

What Apple does document, verbatim. To send: "Tap the plus icon, then tap Apple Cash. Enter the amount you want to send, and tap Send." To request: "Tap the plus icon, tap Apple Cash, enter the amount, then tap Request." Both make the user type the amount inside Apple's own interface.

The strategic point holds either way. Even if the detector works exactly as described, it acts on text already sitting in a conversation. A web app cannot put text into someone else's Messages thread. The only way Halfsies could ever reach that behavior is by handing the user a prefilled SMS body and hoping the detector fires on the other end, which makes it a question about the sms: scheme in part (b), not an Apple Cash integration.

### Section 5 addendum (a2): can the Apple Cash iMessage app be launched by URL

Your belief is correct as far as Apple's documentation goes. The Messages framework describes iMessage apps as app extensions that "Present a custom user interface inside the Messages app". The whole lifecycle is driven by Messages: willBecomeActive(with: MSConversation), didBecomeActive(with: MSConversation), and an activeConversation property described as "The conversation currently displayed in the transcript." Every entry point takes an MSConversation, and an MSConversation only exists inside a Messages conversation. Apple documents no URL scheme and no external launch API for iMessage apps. Safari has nothing to link to.

### Section 5 addendum (b): the sms: URL syntax

The standard is "?body=", and the ampersand joins additional fields rather than introducing the first one. RFC 5724, Standards Track, January 2010, gives the grammar directly:

```
sms-uri        = scheme ":" sms-hier-part [ "?" sms-fields ]
sms-fields     = sms-field *( "&" sms-field )
sms-field-name = "body" / sms-field-ext
```

Its own worked example is sms:+15105550101?body=hello%20there, and multiple recipients are comma separated as sms:+15105550101,+15105550102. So the sms:+1555&body=... form that circulates online is not the standard, and never was.

Apple's official position is that there is no body parameter at all. The Apple URL Scheme Reference, SMS Links page, says the format is "sms:<phone>" and then states flatly: "The URL string must not include any message text or other information." Two things about that source matter. It is Apple's own documentation, and it is archived and last updated 2017-09-19. Apple has never documented a body parameter for sms:, and has not touched the page in nine years. Whatever iOS 26 Safari actually does with a body is undocumented behavior on both counts.

Android documents the body as an Intent extra, which is the trap. The Android intents-common guide says the schemes sms:, smsto:, mms: and mmsto: "are all handled the same way", and that the message text goes in an extra keyed "sms_body". An Intent extra is something a native app sets in code. A web page cannot set one. A link in a browser emits a URL and nothing else. So sms:...?body=... working from a web page on Android depends on the browser and the default messaging app honoring a convention that Android does not document, and it is not the sms_body mechanism Google publishes.

Practical guidance for Halfsies: use "?body=" with the text percent-encoded, since that is the only form any standards body blesses, and verify it on a real iPhone and a real Android handset before you rely on it. This goes on the unverified list as item 7.

### Section 6b: connectors

1. Venmo. No connector exists. Venmo did have one. The archived developer site's own navigation reads "Use OAuth 2.0 to authenticate users of your app with Venmo" and "Create, read and update users and payments using endpoints", so OAuth plus a payments endpoint was real. Venmo closed it: "We have, however, discontinued accepting new beta users of the API as we are focusing efforts to open up the beta to pay with Venmo." Current state: developer.venmo.com returns 404, and both official SDKs are archived on GitHub, last pushed 2019. There is nothing left to connect to.

2. Cash App, consumer. No connector. Cash App's own documentation index lists its entire published product surface, and it is two items: Afterpay, tagged "For Merchants", and the Cash App Pay Partner API, tagged "For Payment Service Providers (PSP) Partners". There is no peer-to-peer product and no consumer OAuth. This is an enumerable negative taken from Cash App's own index rather than a search that came up empty.

3. Zelle. No connector. The only integration path Zelle publishes is for banks and their resellers, covered in section 4.

4. Apple Cash. No connector. No framework, no entitlement, no URL scheme, covered in section 5.

5. PayPal Payouts and Payouts to Venmo. This one is real, and it is the one worth understanding properly, because the price is not what disqualifies it. Payouts is a business product for paying "vendors, contractors, employees, or customers", and recipients can claim through PayPal or Venmo with just an email or phone number. US pricing is 2% of the transaction capped at 1.00 USD, or a flat 0.25 USD per payout when you use the Payouts API. Cheap. It still cannot work for Halfsies, for a structural reason rather than a fee. To pay Bob through Payouts, Alice's share has to be sitting in Halfsies' own PayPal balance first. Accepting funds from one person and transmitting them to another is the exact definition in 31 CFR 1010.100(ff)(5) quoted in section 7. Payouts does not route around the licensing problem, it makes Halfsies the money transmitter and then charges 25 cents for the privilege.

6. Plaid. Linking an account gives you reading, not moving. Auth returns verified account and routing numbers and is explicitly built to "Use with any ACH processor, including Adyen and Nuvei", which tells you Plaid Auth is the identity step and somebody else is the money step. Identity matches the account holder against bank-held data. Neither moves a dollar. Plaid Transfer does move money, over ACH, RTP, RfP and FedNow, and Plaid publishes no per-transaction rate: its pricing page describes one-time, subscription and per-request models and directs you to sales for the numbers. Transfer has the same shape as Payouts. You originate the ACH, so you are in the flow, so you need the license or a partner who has one.

7. Any consumer aggregator that moves money between two individuals for free. I found none. Here is the scope of that negative, because it matters. Across the seven providers examined in this report, every path that actually moves money is either gated behind being a merchant or sits behind a money transmitter license. I did not survey the aggregator market as a separate question, so read this as "none among the seven I checked" rather than "none exists anywhere in the US."

The one sentence for Phil: no connector exists that lets an app move money between two friends for free, because the moment the app sits in the middle of the money it needs the same license a bank or Venmo has.

### Additions to the unverified list

7. What iOS Safari and Android browsers actually do with sms:...?body=... The standard says "?body=", Apple's own reference says include no message text at all, and Android's documented mechanism is an Intent extra a web page cannot set. Three sources, three different answers, none of them a device test. Same tier as items 1 through 3: one iPhone, one Android phone, five minutes.
8. Whether Messages makes a typed dollar amount tappable and offers Apple Cash, which formats trigger it, and whether it fires for the sender's own message. Undocumented by Apple across six surfaces. Not refuted, just unbuildable.

### New sources

Apple Cash and Messages

- https://support.apple.com/en-us/105013 (send and request, plus-icon flow only)
- https://support.apple.com/en-us/HT207886
- https://support.apple.com/guide/iphone/send-and-receive-money-iph1c8ba6e69/ios
- https://developer.apple.com/documentation/messages.md (iMessage apps present UI "inside the Messages app"; no external launch path documented)
- https://developer.apple.com/documentation/messages/msmessagesappviewcontroller.md (activeConversation, willBecomeActive(with: MSConversation))

SMS URL syntax

- https://www.rfc-editor.org/rfc/rfc5724.txt (Standards Track, Jan 2010; ABNF at section 2.2; example sms:+15105550101?body=hello%20there at line 545)
- https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/SMSLinks/SMSLinks.html (ARCHIVED, updated 2017-09-19; "The URL string must not include any message text or other information.")
- https://developer.android.com/guide/components/intents-common (Compose an SMS/MMS message; sms:, smsto:, mms:, mmsto: "handled the same way"; body via the "sms_body" Intent extra)

Connectors

- https://web.archive.org/web/20160406024417id_/https://developer.venmo.com/docs/authentication (OAuth 2.0 and users/payments endpoints in the archived nav)
- https://developers.cash.app/llms.txt (complete published product index: Afterpay for merchants, Cash App Pay Partner API for PSPs, nothing consumer)
- https://developer.paypal.com/docs/payouts/ (business product; claim via PayPal or Venmo)
- https://www.paypal.com/us/webapps/mpp/merchant-fees (Sending PayPal Payouts: US 2% capped at 1.00 USD; US via Payouts API flat 0.25 USD)
- https://plaid.com/products/auth/ (account and routing numbers; "Use with any ACH processor, including Adyen and Nuvei")
- https://plaid.com/products/identity/ (ownership verification)
- https://plaid.com/products/transfer/ (ACH, RTP, FedNow, RfP)
- https://plaid.com/pricing/ (one-time, subscription and per-request models; contact sales for rates)
