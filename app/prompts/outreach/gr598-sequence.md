# GR-598 Demo-First — 11 steps / 60 days

Generated 2026-08-16 from Instantly platform data + NEPQ (Miner) + a council review.
Machine-readable cadence, halts and guardrails: `node scripts/campaign-builder.mjs --voice --json`.

**Legitimacy condition, now SATISFIED.** Steps 10-11 promise the site comes down on a date. That was
fabricated urgency until `scripts/takedown-unclaimed.mjs` existed. Jeff, 2026-08-16: "if they haven't
said yes in some fashion by that last day delete there site and free up space." The deadline is real.
**If the takedown is ever disabled, cut to 7 steps ending at the day-38 price email** — steps 8-11
carry no new information without it.

**House style (non-negotiable):** no em/en dashes, contractions, 55-80 words, plain text, one link
max in email 1, minimal signature. `nepq-sales` lists the em dash as a pacing tool; `anti-ai-slop`
and CLAUDE.md ban it. **The ban wins.**

Tokens: `{{First}} {{Business}} {{City}} {{Trade}} {{PreviewUrl}} {{ReviewCount}} {{ReviewName}}
{{ReviewDetail}} {{Service}} {{Date}}`. Signature = existing Charlie Williams block.

| # | Day | Ch | Angle | NEPQ phase |
|---|-----|----|-------|-----------|
| 1 | 0 | email | The gift | Connection |
| 2 | 3 | email | Proof it is not a template | Connection / ABD |
| 3 | 7 | email | The after-hours call | Situation |
| 4 | 11 | **voice** | Did the link reach a human | Connection + Situation |
| 5 | 16 | email | The phone is the problem | Problem awareness |
| 6 | 23 | email | Their own math | **Consequence** |
| 7 | 30 | email | Future-pace the answered call | Solution awareness |
| 8 | 38 | email | Price, unprompted | ABD |
| 9 | 45 | **voice** | Keep it or take it down | Commitment |
| 10 | 52 | email | Deadline in writing | Consequence #2 |
| 11 | 60 | email | Takedown + breakup | Seed plant |

Cadence 3,4,4,5,7,7,8,7,7,8 — front-loaded while the build is newest, widening as it ages.

## Why 11, not 8 and not 14
The gift peaks on day 0 and decays, so the first four touches sit inside two weeks. But tradespeople
do not read email in week one, they are under a house. The two touches that actually convert are the
day-38 price and the day-52 deadline, and neither is credible without the earned context in front of
it. An 8-step version has to drop either the price reveal or the consequence work, and both are
load-bearing. Above 11 you run out of NEPQ phases and start writing "just checking in", which the
method bans and owners read as desperation. **The ceiling is available phases, not patience.**

## Why voice at day 11 and 45 ONLY
Day 11: the single most valuable unknown is whether a human ever saw the link. Three emails have gone
out; if they went to spam, everything downstream is spend on someone who never got the gift. Thirty
seconds answers it and nothing else does. Tradespeople answer phones during the workday and ignore
inboxes, so this is where voice is strong and email is weak.
Day 45: "keep it or take it down" is a binary that dies in text — written, it reads as a threat
dressed as housekeeping; spoken without push, it reads as a courtesy and gets a straight answer.
NOT day 0 (a call before any email is a cold call and destroys the gift frame). NOT day 23 or 30
(consequence questions need the prospect to sit with them; voice destroys the pause). NEVER the
breakup — a breakup call is needy by construction.

## Copy

### 1 / day 0 — the gift
Subject: `built you a website` | `{{Business}}, this one's yours if you want it`
```
{{First}},

I built {{Business}} a website. It's live right now:

{{PreviewUrl}}

Your number, your services, the {{ReviewCount}} reviews you already earned.
Took about a day. Nothing to install and nothing to schedule.

Is it close to how you'd want the shop represented?

If it isn't, tell me what's off and I'll change it.

Charlie
```

### 2 / day 3 — proof it is real
Subject: `so you know it's not a template`
```
{{First}},

Quick one so you know a person made this.

The services page pulls the {{Service}} work you actually list, and
{{ReviewName}}'s review about {{ReviewDetail}} is on the homepage. If I got
a service wrong, that's on me and it's a two minute fix.

{{PreviewUrl}}

Charlie
```

### 3 / day 7 — situation
Subject: `the 8pm call`
```
{{First}},

Not sure the link came through. It's still up:

{{PreviewUrl}}

One thing I kept wondering about while I built it. When somebody calls
{{Business}} at 8pm on a Saturday and you're on a job or asleep, where
does that call go right now?

Charlie
```

### 4 / day 11 — VOICE. Objective: did a human see the link. 25-40s.
```
"Hi, is this {{First}}? This is Charlie's assistant over at Gray Reserve and I'll be quick.
We built {{Business}} a website last week and emailed you the link. I'm calling to make sure
it actually got to you, because our emails end up in spam about half the time. Did you get a
chance to see it?"
```
- **Saw it** -> "Good, that's all I needed. What did you think of it?" Log verbatim, hand to a human. **Do not price on this call.**
- **Didn't get it** -> "That's what I figured. It's at {{PreviewUrl}}. I'll text it too."
- **Who are you** -> "We build sites for {{Trade}} shops and we built yours before asking, so you could see it instead of hearing a pitch. Nothing owed either way."
- **Not interested** -> "Understood. I'll leave you alone. The site's up if you ever want it." **STOP THE SEQUENCE.**
- **Gatekeeper** -> ask for a better time. **Do not pitch the gatekeeper.**

### 5 / day 16 — problem awareness
Subject: `the work isn't the problem`
```
{{First}},

Every shop I build one of these for tells me the same thing. The work is
fine. The phone is the problem. It rings while they're under a house, and
by the time they call back the customer already booked whoever picked up.

What does that look like in a normal week for you?

Site's still live: {{PreviewUrl}}

Charlie
```
> Line 2 originally read "Every {{Trade}} owner I've talked to in {{City}}". **Only use that if Charlie
> actually has.** Otherwise it is fabricated proof and the skill bans it. The version above is safe.

### 6 / day 23 — CONSEQUENCE (the pivot of the whole sequence)
Subject: `rough math`
```
{{First}},

Honest question and you'd know better than me.

Take what one job is worth to {{Business}}. Multiply it by the calls a
month that never get called back, because you were under a house or up
on a roof and the day got away.

That's what the current setup costs you in a year.

Is that number small enough to ignore?

{{PreviewUrl}}

Charlie
```

### 7 / day 30 — solution awareness
Subject: `forget the site for a second`
```
{{First}},

Different angle. Forget the website.

If every call that came into {{Business}} after hours got answered, a
name and a number taken down, and the message sitting on your phone
before you had coffee, what would that change about how you run a week?

That's the part owners end up caring about. The site is just where it
lives.

{{PreviewUrl}}

Charlie
```

### 8 / day 38 — price, unprompted
Subject: `what it costs`
```
{{First}},

You've probably been wondering what the catch is, so here it is with
nothing attached.

$598 once to launch it. $98 a month after that. That covers hosting,
the assistant answering your calls, the SEO, and a new article every
week.

You own it. You can edit it yourself.

Worth fifteen minutes to make it yours, or is it not for you?

{{PreviewUrl}}

Charlie
```
> ⚠️ DocuSeal template `3758350` has never been verified as repriced off $185. A contract that
> contradicts this email loses the deal at signature. Jeff has parked this, not resolved it.

### 9 / day 45 — VOICE. Binary. 25-35s.
```
"Hi {{First}}, Charlie's assistant at Gray Reserve. Quick heads up and it's not a pitch.
That website we built for {{Business}} is set to come down on the {{Date}}. We recycle the
ones nobody claims. Before it goes, do you want me to keep it up or take it down?"
```
- **Keep it** -> "Done, I'll flag it. Charlie will email you today." **Route to a human within the hour.**
- **Take it down** -> "No problem. Appreciate you telling me straight." **Stop sequence, skip 10-11, ACTUALLY take it down.**
- **How much** -> "$598 to launch, $98 a month. Want me to have Charlie email the details?"

### 10 / day 52 — the deadline in writing
Subject: `taking the site down on the {{Date}}`
```
{{First}},

Housekeeping. The build for {{Business}} comes down on the {{Date}}. We
recycle the subdomain when a site sits unclaimed for sixty days, and
yours hits that next week.

It isn't a sales deadline. It's what we do with builds nobody wants.

If you want it, reply with the word "yours" and I'll hold it.

If you don't, no hard feelings. It was a good one to build.

{{PreviewUrl}}

Charlie
```

### 11 / day 60 — takedown and breakup
Subject: `took it down`
```
{{First}},

Took the site down this morning. The build is archived, so if you ever
want it back it's one email.

I figure the timing just wasn't it. Where should we go from here?

Charlie
```
> Miner's breakup question verbatim — the highest-replying line in the method. It works because the
> takedown already happened, so it is a real event rather than a guilt trip.

## The escalation arc
Craftsman (0-7) -> curious neighbour (11-16) -> quiet doctor (23-30) -> plain dealer (38-45) ->
detached (52-60). **The tone never hardens.** What changes is where the pressure comes from: by the
end it is the calendar, not Charlie. Consequence lands twice, forty days apart and different in kind
— day 23 is abstract (money leaking), day 52 is concrete (a thing that exists stops existing).
Charlie offers an exit in six of eleven steps ("tell me what's off", "that's on me", "no call back
needed", "or is it not for you", "no hard feelings", "the timing just wasn't it"). **That autonomy
cadence is what lets 60 days run without the pursuit smell.**

## Halts
Full list in `campaign-builder.mjs`. The two easy to get wrong:
1. **Check STAGE as well as opportunity STATUS.** A rep dragging a card to Contract Signed does not
   necessarily flip status to won. Emailing a signed client is the worst failure this system has.
2. **Domain-level halt.** Instantly stops the sequence for every contact at a company when anyone
   replies. GHL has no equivalent, and trade shops routinely have info@, the owner and a manager on
   one domain — three people get the same sequence unless this is built.

Also: never send step N with a dead preview URL. Check liveness before EVERY step, not just step 1.

## The objection worth keeping
> "Long sequences are what you build when you cannot build more sites."

At ~1 conversation per 157 contacts, volume dominates persistence at this price. Council confidence
was 65% — genuinely split. **Run 11-step and 7-step arms on split cohorts of the same vertical and
let reply rates decide** rather than settling it by argument.
