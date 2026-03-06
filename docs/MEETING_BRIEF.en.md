# Product Manager Meeting Brief (English)

## 1. One-line Product Definition
Digital Life is a UID-driven digital companion system: users place an order on the website, move into Telegram/WhatsApp, upload starter assets, and get routed into a dedicated long-term conversation channel.

## 2. Value Proposition
- Emotional value: persistent digital companionship for users/families.
- UX value: no new app learning curve; interaction happens in familiar IM apps.
- Operational value: UID connects acquisition, onboarding, allocation, and retention into one measurable funnel.

## 3. System Architecture (PM View)
- Landing: acquisition + conversion + UID creation.
- Control Plane: UID/session state management + channel allocation.
- Bot Layer: onboarding, asset collection, messaging logic.
- Channel Pool: assignable Telegram/WhatsApp sessions.
- Storage/DB: media assets + orders + session records.

## 4. Operating Model
### 4.1 User Segments
- Trial users: 1 photo + 10s voice for fast first experience.
- Full users: longer lifecycle service with richer media and personalization.

### 4.2 Daily Operating Rhythm
- Acquisition: social/video/community campaigns drive traffic to landing.
- Activation: UID deep link to TG/WA and complete first asset collection.
- Retention: regular conversation prompts, seasonal and event-based interactions.
- Expansion: trial-to-paid conversion, family bundles, premium add-ons.

### 4.3 Core Metrics
- Landing -> Bot click-through rate
- UID binding success rate
- Asset completion rate (photo + voice)
- Day-7 / Day-30 retention
- Trial -> Paid conversion
- ARPU / LTV / CAC payback period

## 5. Customer Interaction Journey
- Entry: user submits landing form and receives UID.
- Verification: clicks deep link to Telegram/WhatsApp.
- Initial intake: uploads photo + voice samples.
- Session phase: enters dedicated channel for text/voice/media interaction.
- Ongoing service: proactive touchpoints around birthdays/anniversaries/events.

## 6. Monetization and Growth Model
### 6.1 Monetization
- Subscription plans: monthly/quarterly/annual companion service.
- Tiered bundles: text-only, multimedia, premium customization.
- B2B/B2B2C: white-label deployments for partner organizations.

### 6.2 Growth Levers
- Funnel optimization: reduce drop-off from UID issuance to asset completion.
- Channel expansion: from Telegram to WhatsApp and additional ecosystems.
- Use-case expansion: memorial, education companion, family archive, branded persona.

## 7. Cost Drivers
- Inference/generation: LLM + image/video API calls.
- Infrastructure: compute, database, object storage, monitoring.
- Messaging: WhatsApp BSP conversation/template fees.
- Human ops: content ops, support, moderation/risk handling.
- Security/compliance: audit logs, backups, key management.

## 8. Risks and Mitigations
- Generation quality variance -> media inventory + fallback strategy.
- Session reliability -> control-plane state machine + retry queue.
- Privacy/compliance -> minimal data collection, encrypted storage, access audit.

## 9. Meeting Talk Strategy
- Start with user value, then show technical execution.
- Use funnel metrics + unit economics to answer business feasibility.
- Position current stage as MVP with fast learning cycles before scale.
