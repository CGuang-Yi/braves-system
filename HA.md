For Heat Acclimation (HA) there are 3 programmes.

1. Single HA
   1. 10 periods across 10 days, not inclusive of breaks. 
   2. Allowed up to 2 days of breaks
   3. Restarts if breaks exceeds 2 days
2. Expanded Single HA
   1. 14 periods across 14 days, not inclusive of breaks
   2. Allowed up to 5 days of breaks.
   3. Consecutive days of break should be no more than 3 days
   4. Restarts if 
      1. the break exceeds 5 days OR
      2. There were more than 3 consecutive days
of break
3. Double HA 
   1. Only for those who have
      1. [Compulsory] Have completed Single HA Programme
      2. [Either] Completed Vocational Fitness Training
      3. [Either] Completed Service Term or Foundation Term as part of Officer Cadet Course or Specialist Cadet Course respectively.
   2. 13 periods across 7 days, not inclusive of breaks
   3. Up to 2 days of break
   4. Restarts if breaks exceed 2 days
   5. Assume any personnel at or above the rank of 3SG and 2LT has completed Foundation Term and Service Term respectively

   Expanded is a more lenient alternative path to the same 'Single HA' status

# Elaboration on Period Counting
## For Single and Expanded Single HA Programme 
Periods are counted **per calendar day**, capped at 1 per day. A day with one or more HA activities = 1 period; 2 HA activities on the same day still count as only **1 period**. (This is the day-based model — a day either earns its single period or is a break day.)

## For Double HA Programme. 
Double counts **time periods**, not days. A "period" here is a roughly 1h block of time, and one HA activity can span multiple time periods. The number of 1h time periods an activity occupies is read from **cell B5 of the attendance CSV** (the `Periods` metadata row — see `Sanitised Attendance …` sample, where B5 = `2`). So:
1. 1x HA activity over 2 time periods → counts as 1 activity / **2 periods**.
2. 2x HA activity over 1 time period → counts as 2 activities / **2 periods**.
The Double target (13 periods) is the sum of these time-period counts; the 7-day window and ≤2 break-*day* allowance remain day-based.

# HA Currency
To maintain HA, one has to complete at least 2x HA activities within 7 days over a period of 14 days, starting immediately HA qualification. This period is a rolling time-period which reset on the completion of the second HA activity. 

The second HA activity must be conducted by the last day of HA (14th day).

## Scenarios:

### Example 1
First HA activity is completed on Day 8 of a HA reset day(Day 1 is the day after the completion of the HA activity that reset HA). The second HA activity is completed on day 15. Here, HA has lapsed. 

### Example 2
First HA activity is completed on Day 3. This resets it back to Day 1 as 2 HA activities have been completed within 7 days. Another HA activity is completed on Day 11 on this newly reset scale.The Day 11 HA activity is considered the First HA activity for HA currency. 

### Example 3
First HA activity is done on Day 6. This is resets it back to day 1 as 2 HA activities have been completed within 7 days of one another. Another HA activity occur on Day 4 of this reset scale. This resets it back to day 1. The initial Day 6 HA activity is taken as the 1st activity, the Day 4 activity is taken as the second HA activity. Thus, it resets the HA currency day count

---

# Clarifications (resolved 2026-06-20)

These resolve the ambiguities raised during implementation planning. They are authoritative
for the HA build (Section 12 of `BRAVES_ADAPTATION_SPEC.md`).

## Period counting — summary
- **Single / Expanded:** 1 period **per calendar day** (≥1 activity that day = 1 period; cap 1/day). Two activities same day = still 1 period. A day with no activity = a break day. The existing day-iterating state machine (spec §12.4) is correct for these two programmes.
- **Double:** periods = sum of **1h time-period counts** taken from the activity's `Periods` value (attendance CSV cell B5). One activity can contribute 2+ periods. Window (7 days) and break allowance (≤2 days) stay day-based; target is 13 periods.

## Currency model (the rolling 14-day window)
Currency begins the instant a person qualifies for HA (via **any** programme). State the rule as:

> **Each HA activity pairs with the most recent prior HA activity. If they are ≤ 7 days apart, that pair triggers a reset: the day count restarts with Day 1 = the day after the later activity, moving the 14-day deadline forward. If the window reaches Day 14 with no reset, HA lapses.**

- The **≤ 7-day gap is inclusive** and only governs whether a *reset* happens — it never directly causes a lapse.
- An activity **> 7 days** after the previous one does **not** pair; it becomes a new "first" activity available to pair with a later one, but it does **not** start a fresh window — the existing Day-14 deadline keeps running.
- **Lapse is solely the Day-14 deadline** with no reset in between.

Worked example (user-confirmed): a pair on 4–5 Jun → **6 Jun = Day 1** (deadline 19 Jun). Activity 8 Jun pairs with 5 Jun (3 days) → reset → **9 Jun = Day 1** (deadline 22 Jun).
- Next activity 17 Jun: 9 days > 7 → no pair; new "first" activity; the 22 Jun deadline still applies.
- Next activity 12 Jun: 4 days ≤ 7 → reset → **13 Jun = Day 1**.
This is consistent with Example 1 above: the would-be partner landed on Day 15, past the Day-14 deadline, so it lapsed.

## Lapse recovery
Once **Lapsed**, the person re-qualifies by completing **any** programme again — Single, Expanded Single, or Double (Double only if Vocational Fitness Training is complete). There is no shortcut path.

## One currency scheme for everyone
HA status is **not differentiated by how it was earned**. Whether qualified/re-qualified via Single, Expanded Single, or Double, the person is simply "HA-ed" and maintains/lapses currency under the single scheme above.

## Roles (auth)
`viewer` = read-only access (held in reserve for now). `commander` = full write access; `admin` = commander rights plus the admin-only actions in the addendum.