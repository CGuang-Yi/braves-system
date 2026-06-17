# Cougar Company Data System — Battalion HQ Pitch Deck

> Slide-by-slide draft. Each slide = on-screen content (keep it sparse) + speaker notes (what you say).
> Fill every `[bracket]` with your real numbers before presenting. Target: ~15–18 min + Q&A.

---

## Slide 1 — Title

**On screen:**
- **40 SAR Cougar — Company Data System**
- One source of truth for training, medical & fitness data
- [Your rank/name/appointment] · [date]

**Speaker notes:**
> Keep it to 10 seconds. "What I'm showing you is a system we built and have been running in Cougar Company to manage all our training data in one place. I want to walk through what it does, what it's done for us, and whether it's worth scaling."

---

## Slide 2 — The problem (the hook)

**On screen:**
- Attendance lives in WhatsApp. Medical status lives in someone's head.
- Polar data is screenshotted and forgotten.
- Every conduct generates data we throw away.
- At handover/POP, it's all lost.

**Speaker notes:**
> Don't talk features yet. Get the room nodding. "Every one of us has chased an attendance through three WhatsApp groups. Every conduct produces heart-rate data, IPPT results, injury status — and almost all of it evaporates. There's no memory of the company." Pause. "This system is that memory."

---

## Slide 3 — What it is (30-second framing)

**On screen:**
- A phone-first web app + Google Sheets backend
- Updated from the field in seconds (no laptop)
- [N] recruits · [N] modules · [N] conducts archived
- *Screenshot of the sidebar*

**Speaker notes:**
> "One sentence: it's a single source of truth for the company that any commander can update from their phone, on the ground, in seconds. No server to buy, no app to install. Runs on Google Sheets underneath." Show the sidebar screenshot so they see the breadth at a glance.

---

## Slide 4 — Core features (grouped, not a list)

**On screen — 4 buckets:**

| Bucket | Covers |
|---|---|
| 🪖 **Accountability** | Roster · Attendance · Leave/Out · Conducts |
| 🏥 **Training safety** | Medical · MSK trends · HA expiry · Report Sick |
| 🏃 **Performance** | IPPT · Route March · SOC · Polar HR analytics |
| 📲 **Field usability** | Telegram bot · AI photo capture · offline sync |

**Speaker notes:**
> "Rather than walk you through twelve tabs, here are the four things it does." Name each bucket in one line. "I'll show you the two that surprise people — the heart-rate analytics and the AI data capture." Move quickly; this is the map, not the demo.

---

## Slide 5 — DEMO 1: Performance analytics (showstopper)

**On screen:**
- Tap a recruit → growth graphs
- Avg HR · Max HR · Calories
- **Efficiency** = kcal / avg HR (output per heartbeat)
- **Intensity** = avg HR / max HR (how close to ceiling)
- **Recovery** = max-HR trend at same workload (fitness vs. fatigue)
- **Workload** = avg HR × duration (cardiac load for periodisation)

**Speaker notes:**
> Do this LIVE on your phone if at all possible. Search a recruit, open their profile, scroll the graphs. "This is a recruit's fitness over the cycle. We're not just storing heart rate — we're deriving training-science metrics. Recovery indicator flags overtraining before it becomes an injury. Workload lets us periodise instead of guess." This is the moment that sells the system. Let it breathe.

---

## Slide 6 — DEMO 2: AI data capture (showstopper)

**On screen:**
- Take a photo of the Polar Flow class summary
- Claude reads **every** recruit's row → HR, calories, duration
- Auto-matches to roster 4Ds, flags unclear rows for review
- Manual entry of a 22-man class → one photo

**Speaker notes:**
> "Here's the part commanders love. After a conduct, the Polar app shows a class summary. Instead of typing 22 rows by hand, you photograph the screen. The system uses AI to read every row, match each 4D to our roster, and flag anything it's unsure about for a human to confirm. It's built to never silently drop a recruit." Tie back to manpower: "That's [X] minutes of admin per conduct, gone."

---

## Slide 7 — How it helps Cougar (in command language)

**On screen:**
- ⏱ **Manpower** — attendance/data consolidation: [X] min → seconds per conduct
- 🛡 **Training safety** — HA expiry + MSK trends caught *early*
- 📊 **Decisions** — periodise training on real cardiac load, not gut feel
- 📁 **Accountability** — every conduct archived; nothing lost at handover

**Speaker notes:**
> Translate each to an HQ priority. "Manpower saved is the obvious one. But the one that matters most to command is safety — we can see whose heat-acclimatisation is about to lapse and which recruits are trending toward musculoskeletal injury, before an incident, not after." Risk reduction is the language that funds projects.

---

## Slide 8 — Feasibility for other companies

**On screen:**
- ✅ **Low cost** — Google Sheets + Apps Script, free, no procurement, no server
- ✅ **Low barrier** — runs on any phone, nothing to install
- 🔧 **To adopt:** swap roster → redeploy script → issue device invites
- ⚠️ **Honest:** Polar-watch dependency; needs one tech-comfortable maintainer

**Speaker notes:**
> This is what HQ actually weighs if they're thinking battalion-wide. "Standing up a new company is roughly [your estimate] — swap the roster, redeploy, send each commander an invite link. The real dependencies are honest ones: you need Polar watches for the fitness side, and you need one person per company comfortable maintaining it." Don't oversell — credibility here buys you the rollout.

---

## Slide 9 — Challenges in building & adapting it

**On screen:**
- Google Sheets as a database → had to engineer sync + conflict handling
- Auth without a real server → per-device token + invite system
- Messy source data → automatic inconsistency flagging ("remarks")
- Offline field use → local cache + dirty-tab tracking & retry

**Speaker notes:**
> Showing the hard parts builds trust — it proves this is battle-tested, not a prototype. "Using Sheets as the backend meant solving sync conflicts ourselves. Doing auth without a server meant building a per-device invite system. None of this was free — but it's solved now, and a new company inherits the solution."

---

## Slide 10 — Obstacles in actual use

**On screen:**
- **Adoption** — commander buy-in & data-entry discipline
- **Field signal** — handled via offline sync, still a factor
- **Data quality** — Polar watches not worn / not synced correctly
- **Maintenance** — one person currently owns it (key-man risk)

**Speaker notes:**
> "The technology was the easy part. The hard part is people — getting commanders to enter data consistently. The AI photo capture exists specifically to lower that friction. The honest risk to flag for HQ: right now it depends heavily on me to maintain. If we scale, we need to plan for that."

---

## Slide 11 — Data security (anticipate the question)

**On screen:**
- Per-device token authentication — no open access
- Invite-only onboarding; tokens revocable per device
- Data resides in a controlled Google account, not public
- **For official adoption:** [what you'd harden — formal data classification review]

**Speaker notes:**
> HQ *will* ask this, so raise it first. "Access is per-device and invite-only — I can revoke any device. There's no public link to the data." Then be honest: "If this becomes an official battalion system, it should go through a proper data-handling review. I'm flagging that proactively rather than waiting to be asked."

---

## Slide 12 — The ask / next steps

**On screen:**
- I'm requesting: **[pick one]**
  - Endorsement to pilot in [1 more company]
  - Time/manpower allocation to maintain & document it
  - Approval to standardise across the battalion
- I can stand up the next company in [timeframe]

**Speaker notes:**
> End with a decision, not "thank you." "I'm not asking you to commit the battalion today. I'm asking to pilot it in one more company so we have a second data point. I can have them running in [timeframe]." Make the yes small and easy.

---

## Slide 13 — Backup: architecture (only if asked)

**On screen:**
- Front end: vanilla JS web app (no framework, no build, works offline)
- Backend: Google Apps Script web app
- Data: Google Sheets (one tab per module, archived per conduct)
- Integrations: Telegram bot (field entry) · Claude AI (photo extraction)

**Speaker notes:**
> Keep this hidden unless someone technical asks "what's it built on." Then one minute, no jargon. The point of a backup slide is to look prepared without derailing the safety/manpower story.

---

## Slide 14 — Backup: by the numbers (only if asked)

**On screen:**
- [N] recruits tracked · [N] commanders onboarded
- [N] conducts archived since [date]
- [N] Polar sessions analysed
- [X] min/conduct admin saved (est.)

**Speaker notes:**
> Quantify wherever you can — one real number beats a paragraph of adjectives. Pull these from the live system before you present.

---

## Delivery checklist
- [ ] Replace every `[bracket]` with real figures
- [ ] Charge your phone — Slide 5 & 6 are live demos
- [ ] Pre-load the app + pick one recruit with good Polar data to show
- [ ] Have a fallback screenshot in case signal/login fails on the day
- [ ] Decide your single ask (Slide 12) before you walk in
- [ ] Lead with safety + manpower; keep architecture in the backup
