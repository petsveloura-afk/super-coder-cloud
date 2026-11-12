# Changelog

## Round 10 — posts & pictures, a stronger digital team, accessibility

- **Post editor → "Edit text"** (`components/social/post-edit-tools.tsx`, `lib/social/post-edits-core.ts`, action `social/edit-actions.ts`, all new): smart edits that keep every fact — longer, warmer, more professional, a stronger call to action, fix spelling only, more / fewer emojis, fit the network (Instagram / Facebook rules) and translate (Hebrew / English / Arabic). Same permissions, rate limit and credit metering as the existing rewrite (`copy-actions.ts`, unchanged). Free one-click clean-ups (no emojis / hashtags / links), live stats (characters left per network, what shows before "see more", words, reading time) and a version history of the session — any earlier text can be restored.
- **Post editor → "Edit picture"** (`components/social/image-editor.tsx`, `lib/social/image-edit-core.ts`, new): frame the picture for the network (1:1, Instagram 4:5, Facebook landscape, story 9:16) at the recommended size, zoom and focus point, seven ready looks (natural, vivid, warm, cool, black & white, cinematic, soft) and fine adjustments (brightness, contrast, saturation, warmth, blur, vignette), and a headline band in any color with automatic readable text and right-to-left support. Saved as a NEW picture through the existing upload (`x-upsert: false`) — the original is never overwritten.
- Both open from the post editor's power tools (`post-power.tsx`: two buttons added; every existing tool stays).
- **Digital team — upgrade 10 tools** (`lib/team/tools-plus10-core.ts`, `tools-plus10.ts`, new; wired in `tools-core.ts`, `tools.ts`, `runner.ts` → `withRoleExtras10`): `crm.recent_leads`, `inbox.thread` (read the real conversation before writing to a customer), `deals.pipeline`, `appointments.upcoming`, `tasks.complete`, `crm.set_status` (only lead / qualified / customer / inactive), `social.update_draft` (drafts only, same post hygiene). All internal — nothing reaches a customer or costs money; every query is scoped to the business. Role extras only add tools. Two delivery rules added (read the thread / check the calendar / improve a draft in place; close finished tasks). Labels in he / en / ar.
- **Accessibility:** a "skip to content" link in the app shell (visible on keyboard focus) and a focusable main region; sliders and color pickers follow the brand accent with a visible focus ring.
- No migration, no new environment variable. Tests: `round10-posts-agents.test.ts`.

## Railway hardening — an always-on server, after the move

- **Checked first (what changed by moving from Vercel's short-lived functions to one long-running server):** unhandled promise failures (Next.js already logs them and never crashes — confirmed in its source), shutdown (Next.js handles SIGTERM; the clock's timers never hold the process), module-level caches (per-business with a time limit — bounded by the number of businesses), the client IP behind Railway's edge (Railway overwrites `X-Forwarded-For` / `X-Real-IP`, so the rate limits stay sound), every one of the 81 API routes for a login / cron secret / signature / rate limit (all have one; the OAuth starts use the session, the Twilio and voice webhooks verify Twilio's signature, the public chat and the error reporter are rate-limited).
- **Phone numbers follow the new address** (`lib/voice/twilio-heal.ts`, `twilio-heal-core.ts`, new; run from the follow-ups clock at most once every 6 hours): platform numbers and the businesses' own auto-wired Twilio numbers whose Voice URL is OUR path on the old address are re-pointed with the same call used when a number is connected. A number pointed elsewhere on purpose is never touched.
- **The Meta app webhook follows the new address:** a callback that is our own path (`/api/channels/meta/pages`) on another host is now repaired like a missing subscription (`ownPathOnOldAddress`); any other address is still only reported.
- **A customer's attachment link can no longer reach the private network** (`lib/ai/inbound-media.ts` → `fetchPublicHttps`: public https hosts only, every redirect re-checked). On Railway the private network (`*.railway.internal`, the WhatsApp bridge) is reachable from the server — this closes the gap reported in Wave A3.
- **"typing…" frees its slot when it runs out by itself** (`lib/ai/typing.ts`) — on a long-running server a stale entry would have kept that chat from showing "typing…" until the next restart.
- **Unhandled promise failures are also recorded in Mission Control** (`lib/ops/process-guard.ts`, installed from `instrumentation.ts`; ≤ 20 per minute, Next.js' own prefetch noise skipped). Server behaviour unchanged.
- No migration, no new environment variable. Tests: `railway-hardening.test.ts`.

## Railway round — the app moved from Vercel to Railway: everything that depended on Vercel now works there too

- **A built-in clock replaces the Vercel cron** (`lib/ops/self-clock-core.ts`, `lib/ops/self-clock.ts`, started from `instrumentation.ts`): on Railway the app itself calls its 11 background routes (dispatch, team, meta-sync, social, email-poll, followups, growth, social-brain, agents, billing-sweep, keepalive) over loopback with `CRON_SECRET`. Every route keeps its own `job_runs` lock, so the GitHub "Automation jobs" and pg_cron stay as a harmless backup. Once per boot it re-points the database clock (pg_cron) to the current address. Off on Vercel, during build, or with `SELF_CLOCK=off`; `SELF_CLOCK_DB=off` skips the re-point. `/api/health` now shows `clock {on, reason, last}`.
- **Team tasks are dispatched over loopback on Railway** (`lib/team/runner.ts`), with a `RAILWAY_PUBLIC_DOMAIN` fallback for the address.
- **Telegram bots re-point their webhook by themselves** when the app address changed (`healTelegramWebhooks`, stores `webhook_base`).
- **Railway hosts are known to the proxy and logs** (`proxy.ts`, `lib/ops/log.ts`, `lib/admin/speed.ts`): `RAILWAY_PUBLIC_DOMAIN` / private domain count as the app's own host; `.up.railway.app` / `.railway.internal` are not treated as customer domains.
- **Customer domains on Railway** (`lib/site/domains-railway.ts`, new): when there is no Vercel project, connecting a domain the business already owns goes through Railway's public API (one token: `RAILWAY_API_TOKEN` or `RAILWAY_PROJECT_TOKEN`; Railway injects the project / environment / service ids). The customer gets exactly Railway's records — the CNAME and the `_railway-verify` TXT, whose value always starts with `railway-verify=`. Buying a new domain is a Vercel-registrar feature: without Vercel the panel shows only "connect" and the server answers `websites.domain.err.purchaseOff` (he / en / ar).
- **No more vercel.app addresses in the code**: OpenRouter referer, image-provider user-agent, the "made with" link on published sites, and the defaults of `jobs.yml` / `keepalive.yml` now use `NEXT_PUBLIC_APP_URL` / `https://app.supercoder.agency`. `sync-production.yml` is skipped when `APP_URL` is not a vercel.app address.
- **Posts hygiene, round 3:** plans, recommendations, findings and report titles that the AI wrote instead of a post are refused (`not_a_post`); when the text holds a labelled ready version ("נוסח הפוסט המלא (מוכן לפרסום):"), only that version is kept.
- Root `package.json`: a `start` script (`pnpm --filter @scc/web start`) so Railway can start from the repository root.
- No migration. New optional env: `SELF_CLOCK`, `SELF_CLOCK_DB`, `RAILWAY_API_TOKEN`, `RAILWAY_PROJECT_TOKEN`. Tests: `railway-self-clock.test.ts`, `railway-domains.test.ts`, `social-post-hygiene.test.ts` (round 3).

## Wave A3 — AI brains: what the guard holds is now visible, honest and no longer a false "broken connection"

- **Checked and NOT changed (nothing to fix):** Telegram posting goes only through `publishDuePosts` (`lib/social/publish.ts → publishTelegram`), so it passes the same customer-ready guard as Facebook / Instagram — there is no second path. Read in full: `router.ts` (candidate order, per-provider call limit, rests, paid safety net, last-resort probe, lane lease released on every exit), `provider-health.ts`, `lane-gate.ts`, `guardrails.ts` and `run-system.ts`; and the SQL `finalize_ai_usage_system` (a failed AI call costs 0 credits). No defect found. Not read line by line: `resilience-core.ts`, `provider-health-core.ts`, `busy-wait-core.ts` (covered by their existing tests).
- **Reported only:** the price guard (`guardrails.price_guard`) is opt-in (default off); turning it on by default would change behaviour for every business, so it was left as is. A small inconsistency in the router: the "tiny model" last-resort answer is not recorded in the provider health window (harmless).
- **A post the guard held now shows on the board (`lib/social/held-post-core.ts`, pure):** the publisher already put such a post back to a draft, but the board did not know. Now the card shows "Held: not ready for customers — edit before publishing", the "approve" and "publish now" buttons are hidden (card and drawer), "approve all drafts" skips it, and the server refuses to approve / schedule / publish it with a clear message (he / en / ar). The check is the same one the publisher uses, so once the owner fixes the words the post is free again. Only while `OUTBOUND_GUARD=enforce` (default).
- **"Publish now" no longer says "publishing" when the post was held again** — it now says it was held.
- **A held follow-up is no longer counted as sent** (`runFollowups`) and no longer cancels the planned follow-up with the reason "followup_sent".
- **No more false "your connection is broken" alerts:** AI messages the guard held (status failed, error `held_by_outbound_guard`) were counted as failed sends of the channel, so two of them in a day turned a healthy WhatsApp into "send failures" and alerted the owners to reconnect. They are now left out of the channel health numbers and of the alert cron; every other failed send still counts.
- **The owners are told when an AI message is held outside the autopilot's own hand-over** (in-app notification `inbox.heldNotification`, at most once per conversation per 6 hours) so a customer is not left waiting unnoticed.
- Reported only, not changed: `fetchMediaUrl` (`lib/ai/inbound-media.ts`) downloads an attachment link without a public-address check.
- No migration, no new environment variable. Tests: `wave-a3-held-and-health.test.ts`.

## Wave B2 — performance: indexes for foreign keys that had none

- **Why it matters:** when a parent row is deleted (a campaign, a team task, a calendar connection, an AI agent, a contact, a deal …) the database checks every table that points to it. With no index on the pointing column that check reads the whole child table — once per deleted row. `messages`, `conversations` and `jobs` are among the biggest tables.
- **Migration** `20261108000001_fk_index_coverage.sql` — only `create index if not exists`, 25 indexes, no table / column / policy / data touched (so no new RLS needed). Partial indexes (`where col is not null`) keep them small.
  - The five candidates from the previous review, all confirmed: `jobs.campaign_recipient_id`, `team_tasks.parent_id`, `team_tasks.merged_into`, `team_approvals.task_id` (also serves the runner's "pending approvals of this task" count), `calendar_busy.connection_id` (its rows are deleted and re-inserted on every calendar sync).
  - Found while verifying: the contact / deal / automation / webhook / AI-agent delete paths (`conversations`, `messages.ai_agent_id`, `jobs`, `automation_runs`, `activities`, `notes`, `tasks`, `deals`, `appointments`, `ai_usage`, `documents`, `tickets`, `files`).
- **Checked and NOT changed (nothing to fix):** `appointments.host_id` (the booking-overlap index already serves the live queries; it is only a user-delete path), the 6 `select("*")` (all single-row lookups by id), N+1 in dashboard pages (none found; loops in background jobs are bounded by small limits and already reuse the organization), caching (`getOrgContext` is already request-cached, a TTL cache already exists).
- Tests: `wave-b2-fk-index-migration.test.ts` (additive-only, newer than the last migration, unique names) and, on a real Postgres, `packages/database/tests/fk-index-coverage.test.ts` (indexes exist, migration re-runs cleanly, the foreign-key check really uses them).

## Wave A1 — customer-ready guard for everything the AI sends or posts

- **New pure module** `lib/ai/outbound-guard-core.ts` (unit-tested in Hebrew, English, Arabic): removes the model's own thinking (`<think>`, `<thinking>`, `<reasoning>`…, also an unclosed or lone closing tag) and labelled internal notes; holds text that is not ready for a customer (unfilled placeholder, raw JSON, draft introduction, leaked instructions). A discount line such as "הנחה: 10%" or a customer note such as "Note: …" is never touched.
- **Wired in three places, AI-authored text only:** `sendToConversation` (every AI message on every channel), the autopilot (a held reply uses the existing "let me check with the team" hand-over, reason `guardrail_unready`, never silence), and social publishing (a not-ready agent post goes back to draft with the reason).
- `cleanPostBody` now also removes the model's thinking from an agent post.
- The inbox shows a translated explanation (he/en/ar) for a held message instead of a raw code.
- **SSRF through redirects closed** (`lib/net/safe-fetch.ts → fetchPublicHttps`): reading a business website for the agent setup (`lib/ai/site-import.ts`) used to follow redirects after checking only the first URL, so a site could bounce the server to an internal address. Every hop now passes the same public-https check (max 4 hops, loop-safe). Outgoing webhooks already used `redirect: "error"` and are unchanged.
- Optional `OUTBOUND_GUARD=off|clean|enforce` (default `enforce`). No migration.

## Clean team log in Hebrew, automatic senders out of the inbox, the reason behind "unexpected error"

- **Team log** (display only, `activity-tidy-core.ts`):
  - Ids cut in the middle by the log's length limit are removed.
  - The tools' English wording is shown in the business language: waiting since, quiet since, automated senders, yesterday / leads / conversations / AI replies / deals / revenue / avg, due / OVERDUE, [proposed] / [stopped], scheduled / draft.
  - Long decimals are rounded to one digit.
  - "ASSUMPTION:" is shown as "הנחה:".
- **Automatic senders are not customers** (`lib/inbox/robots-core.ts → isServiceSender`):
  - Detected on every channel: exchanges and platforms by their whole name (OKX, Bybit, Telegram, "Neon Alerts" …), and machine texts (login / verification codes, IP + device reports, long opaque tokens). A customer or a business name that only contains such a word is never caught.
  - In the inbox they get a "automatic message — not a customer" mark, do not count as waiting, and one click closes them all. The server checks every id again and closing is reversible.
  - The agent does not answer them (by the sender's name only).
  - The team's "unanswered" list skips them.
- **"Unexpected error" shows its technical reason** in one short line (no ids), so the cause can be reported.
- A post the employee wrote with notes or ids ("not_a_post") is now "invalid input" with its own guidance, not an "unexpected error".
- No migration.

## Digital team: steps no longer fail on unknown ids or dates, no AI bursts, clean log

- **Root cause:** an employee plans its steps BEFORE it reads anything. Steps like "add a note to each lead" or "create a follow-up task tomorrow 9:00" were planned with ids it did not have yet ("the lead from step 1") and dates in free form ("2026-11-10 09:00 (ASSUMPTION)", "מחר"). Strict validation refused them ("bad:contact_id", "bad:due_iso"), the same refusal repeated for every similar step, and the task ended "partially done".
- **Argument repair** (`lib/team/arg-repair-core.ts`, before validation):
  - Dates in any common form become real times in the business's time zone: ISO with or without a zone, day-first `10/11/2026 14:30`, `10.11`, today / tomorrow / מחר / בעוד 3 ימים / بكرة / next week. An optional unreadable date is left out instead of failing the step.
  - Ids written inside text are extracted.
  - A contact that is not an id is taken from the contacts the employee already read in this run. One contact → used; several → the step runs once for each (up to 4); none → a clear reason ("find the contact first"), not a raw code.
  - The same tool failing the same way twice is not tried a third time in the run.
  - The planner is told to read ids first (more=true) and to write dates as ISO.
- **No self-made AI bursts** (`lib/team/ai-gate-core.ts`):
  - At most 4 team AI calls at once per server instance. The next one waits a few seconds for a slot, never past its own time.
  - A third, calmer AI try (after 4s) when the run still has 20s+. Before, the task failed here and waited minutes for the retry round.
- **The board:** a failed task the system retries by itself (busy engines / network) shows as "retrying by itself" with a waiting avatar, not as a red failure.
- **Clean log on the team screen** (display only, `lib/team/activity-tidy-core.ts`): no database ids, validation codes, list indexes or raw timestamps; "(ASSUMPTION)" is shown in the business language.
- No migration.

## Design 3.0: navigation progress, brand loaders, phone finish, task history delete

- **Delete old tasks in every stage** (`ai-team/history-actions.ts`, managers only — `ai.manage`):
  - Delete one task (two-step button), select and delete several, or delete a whole stage. This works for done / failed / canceled, waiting, blocked, and waiting for an answer or approval.
  - "Clear history (30+ days)" deletes the finished tasks older than 30 days.
  - A task that is running now is never deleted, and goals are not deleted from here.
  - Every delete is scoped to the business and audited. People without "manage" keep the per-user "hide from view", as before.
- **The board on a phone:** the stages sit side by side and swipe, with stage chips (dot, name, count) that slide to a stage. The board opens on the first stage that has tasks. Each empty stage shows "no tasks here". From tablets up the grid is as before.
- **Navigation progress:** a brand-gradient bar at the top from the tap on a link until the next screen arrives. It finishes and fades out, and never sticks (12s safety).
- **Brand loader:** a turning gradient ring with a glowing core on every loading screen. Skeleton shimmer is now brand-tinted.
- **Finish:**
  - A fine brand-gradient edge on top of every card (a background layer, no layout shift).
  - A glowing pill and an indicator line on the active phone tab.
  - Stage dots on the team board (the running one beats), and a calm hover lift for task cards.
  - The help button is a compact round icon on phones, so it no longer covers content.
- Everything is CSS / additive components: transform and opacity only, layered, off for "reduce motion" and on print. No migration.

## Enterprise round: sales psychology engine, fast context cache, resilient database calls, live campaign progress

- **Sales psychology engine** (`lib/ai/sales-psychology-core.ts`, pure, no AI call, under 1ms), added to the conversation agent's brief. Nothing existing was changed.
  - Customer sentiment −1.0…1.0 in Hebrew, English and Arabic: a lexicon with Hebrew word boundaries, negation, intensifiers, emoji and shouting. Plus the trend over the last 5 messages.
  - Deep objections: an objection that comes back means the earlier answer failed, so the agent changes approach.
  - An adaptive plan of up to 3 tactics: empathy first, value anchoring, risk reversal, social proof, urgency framing, smaller step, next step.
  - Proof, guarantee and urgency tactics are used only when the business's own information has them (`proofsFromFacts`). An upset customer is never sold to.
- **Fast context cache** (`lib/cache/ttl-cache*.ts`):
  - In-memory LRU + TTL + single-flight. An optional shared Redis (Upstash REST) layer is used only when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are set, with a 250ms limit and a silent fallback.
  - The agent caches only business-level facts ("can book", "can take payment") for 30s. Conversation state is never cached.
- **Resilient database calls** (`lib/db/resilient*.ts`):
  - Exponential backoff with full jitter, only for transient errors: connection, pool, gateway, serialization and deadlock.
  - Used only on idempotent calls: the credit-pack grant (4 tries, 6s) and the agent's history read (3 tries, 2.5s).
- **Live campaign progress** (`components/campaigns/campaign-live.tsx`): while a campaign sends, its real counts refresh every 4s while the tab is visible, with a "live" mark. It stops by itself.
- No migration.

## Full round: credits after purchase, posts board hygiene, edit pop-up, run stability, API guard

- **Credits bought → work resumes at once:**
  - The team's day cap counts credits bought in the last 24h on top of the cap (`effectiveDayCap`), on the clock, on the screen meter and in the hold notification.
  - A pack purchase (`grant()`) immediately wakes the tasks stopped for credits (`reviveCreditTasks`) and the tasks held by the cap (`resumeHeldTasks`).
  - A task stopped for credits is revived when a new month starts or after a purchase (`creditsBackSince`, direct table reads — the old RPCs are not callable by the server role).
  - A task stopped for credits says so plainly ("no AI credits — buy a pack / wait for the month").
- **Posts board:**
  - An AI employee's notes ("**הנחות:**", "Assumptions:"), reports about a post ("scheduling confirmation, post id …") and markdown no longer become "posts". Only the customer-facing text is saved (`cleanPostBody`), each once, on the next free morning slot instead of all on the same minute.
  - The team is told a post is marketing text for the customer (hook, value, call to action, hashtags), with any assumption written after all the posts.
  - Publishing never sends an agent "post" that is only notes or a report; it returns to the owner as a draft with the reason. Agent posts go out as plain text.
  - Managers see which employee wrote each post (`agent_name`), when it was created, and a "new" mark for the last 24h. A stable order: newest first, or by planned publishing time.
  - Editing an existing post opens a pop-up where the person is, instead of at the top of a long board.
  - Migration `20261107000001_social_post_hygiene.sql`: `agent_name` column, an index, and a tidy-up of what is already on the board (notes-only agent drafts / scheduled posts are set to canceled — nothing is deleted — and `**` is removed from agent posts).
- **Run stability:**
  - The team task call has 120s with a 110s deadline.
  - The smart agents' AI calls end inside the round.
  - A task stuck "in progress" for more than 150s is recovered by a new start.
  - The live line on the loader is clean (no ids or tool keys); a "still working — N seconds" note appears on long tasks; "done" shows a toast and closes faster.
- **Security:** a permanent test checks that every API route is authenticated or on a reviewed public list.

## Engineering round: credit cap root cause, security parity, load fairness, time limits

- **Credit cap — root cause:**
  - Today's team credits are counted by when the work RAN (`started_at`), not by the last change of the row (`updated_at`).
  - Before, any later touch of an old task (a cancel, a merge, a sweep) brought its old credits back into "today", and the cap was reached without real work.
  - The team clock and the screen now use the same count (`dayCredits`). The old count remains as a fallback.
- **Credit cap — transparency:**
  - "Credits today X/Y" meter on the team screen (warning at 80%, red at the cap).
  - A held task says "waiting for credits — resumes by itself".
  - The owners get ONE notification and push a day when the cap holds work back, with the numbers and a link (`notifyCapHold`).
- **Security:**
  - A fresh start of a stopped task from the screen needs "manage AI", the same as the existing restart button.
  - Starts are rate limited to 30 a minute per business (`public_rate_limit`).
- **Load:**
  - The team clock visits the businesses from a rotating start each minute, so the same businesses are not always left waiting.
  - The smart agents on the heartbeat start only with enough time left, and with a budget that ends inside the server call. Before, they were cut off after a long team round.
- No migration.

## Digital team: "run now" / "try again" really run, follow and retry; nothing thrown away; transitions

- **"Run now" / "Try again":** the button only STARTS the work, in its own server call (`startTaskAction` → `/api/cron/team-task`), and returns at once. Before, the whole task ran inside the click's 60s request: it was cut off, "something went wrong" appeared, and the task stayed "in progress".
- **The scene follows the task live** (`taskProgressAction`, every 2.5s):
  - it shows the employee's real latest step;
  - it shows the real result (drafts / waiting for approval / a question);
  - when the engines were busy, it starts the task again by itself, up to 2 more times ("trying again 2/3…");
  - when there is a real reason (budget, rules, a failed earlier task), it says so plainly, with a "Try again" button.
- **One more AI try inside the same run:** a busy first answer is retried after 2.5s, with a free engine choice, when there is time.
- **An unreadable plan no longer fails the task:** the employee works directly on the task and writes the result. In later rounds, the work continues with what is already done.
- **Time limits respected:**
  - the goal summary and the weekly meeting stay inside the time limit of their run;
  - smart-team AI calls never wait past ~22s.
- **Animations:** the team screen's tabs fade in when switched.
- **Activity log:** the new log lines are shown in the business language.
- **Fix — tasks that waited without running:**
  - The clock (and the run button) now hand a task to its own server call ONLY when that call confirms (HTTP 202 `{accepted: true}`).
  - Before, a refused hand-over — a wrong secret, a protected deployment address, an error page — still counted as "started", and the task waited forever.
  - Any refusal now means the task runs right where it is.
  - The address used is the production domain (`NEXT_PUBLIC_APP_URL` → `VERCEL_PROJECT_PRODUCTION_URL`), not the protected deployment URL.
  - `/api/cron/team-task` answers at once and does the work right after the answer (`after()`), with one line per run in the server log.
- **CI / deploy:** Supabase CLI = the newest release (looked up with the run's token) with an automatic fallback to the known-good 2.122.1 — for installing, for the migrations and for the local CI database.
- No migration.

## Digital team: no "busy" failures from short server calls, a paid account without credit stops wasting tries, and the "employee at work" animation

- **Its own server call:** when the team clock has too little time left for a full run, it starts the task in its OWN server call (`/api/cron/team-task`, Bearer CRON_SECRET, ~52s). Before, the task started anyway and its second AI step got "engines busy" right after a successful plan.
- **Back to the queue, not failed:** a run that ran out of server time (`time_budget`) goes straight back to the queue. It does not show as failed and does not wait out a retry pause.
- **Paid account without credit:** OpenAI `insufficient_quota`, Anthropic "credit balance is too low" or HTTP 402 makes the key rest for 6 hours. Before, it was tried first on every call. Gemini per-minute limits are unchanged.
- **"Employee at work" scene:** shown while a goal is planned or a task runs or retries from the screen. It reuses the site builder's loader style: a brain with orbiting work tools, a plan that ticks itself off, the stage and a progress bar. It celebrates when the work is done and says plainly when the task will retry.
- **Running task cards** show "… is thinking" dots.
- **Toast:** a run that will retry shows an information toast (not a green "success").
- **Activity log:** the market-data safety preface is no longer shown in the log. The AI still receives it.
- No migration.

## Digital team upgrade 9 — does what was asked, completely

1. **Posts become drafts:** written posts are saved AS WRITTEN as drafts on the posts board (new tool `social.save_draft`), and a picture is added in the background. They never publish without the owner. Before, posts stayed inside a report.
2. **Honest completion:** a task that was asked to produce something and produced nothing is marked "⚠️ Partially done", with the reason. Before, it was a silent "done".
3. **Finishing reserve:** writing and checking the final output have their own credit reserve, so the per-task limit never cuts the last step.
4. **Continuation:** when a per-task limit stops the work, the SAME employee continues in a new run ("Continue: …"), bounded by the depth limit.
5. **New read tool `social.drafts`:** quality checks and marketing read the REAL drafts before judging. Before, a check said "there is no draft" without looking.
6. **Delivery rules** in every work plan: do exactly what was asked, write posts in full, read before reviewing, facts only from data.
7. **New deliverable type "post"**, one block per post.
8. **Forced deliverable:** a plan with no output for a "write / create" task still writes the output.
9. **Report lines:** the report says what was produced (drafts) and when it is only partial.
10. **Owner notification:** owners and admins get a notification and a push ("X post drafts are waiting for your approval") that links to the posts board.
11. **Task board badges:** "Partially done" and "📝 N drafts on the posts board", with a link.
12. **Quality control** can hand work back to the writer with the exact fixes (`team.handoff`).
13. **No duplicate drafts:** the same post is never saved twice (retries, continuations).
14. **Posts board, past-due drafts:** a draft whose planned time has passed says so ("approving publishes it right away").
15. **Posts board, Telegram errors:** "bot is not a member of the channel" is explained in plain words, with how to fix it.
16. **New tool grants:** `social.drafts` for the manager, team lead, analyst and quality control. `social.drafts` + `social.save_draft` for marketing and the content writer. Nothing was removed.

No migration.

## Digital team: no more cut-off runs, and every API key is really used

- **Time guard:**
  - Every task run, and every goal plan, has an end time inside the server function's 60s limit.
  - An AI call never starts without enough time left, and never waits or runs a second pass past that end time.
  - Before, a long run was cut off by the platform mid-task. The task looked "stuck", and after a few such cuts it ended as an "unexpected error" that no longer retried by itself. Now it ends cleanly as "busy" and retries automatically.
- **Many keys used well:** a quick "this key is full right now" refusal (429 / quota, under 2.5s) no longer uses up the engine's 2-failure allowance. Each key of the engine gets one quick try, so the business's other keys are really used. Slow failures count as before, and there is a hard cap of 40 attempts per request.
- **Clearer reason:** a cut-off run is explained as "took too long — try again", not as a bug.
- No migration.

## The task board explains every failure, plus a paid safety net for AI

- **Failed tasks:**
  - Each failed task shows WHY, in one clear sentence.
  - It shows whether the system will retry by itself (temporary AI or network problems).
  - It has a "Try again now" button: the existing restart, then an immediate run.
- **Blocked tasks:** a task blocked by a failed earlier task says it is waiting and that it resumes by itself.
- **Paid safety net:** when every free AI engine failed or the call limit was reached, ONE configured paid engine (OpenAI / Anthropic) is tried before giving up. Before, the paid engines sat at the end of a long list and were never reached.
- No migration.

## Stable AI for the digital team, synced counters, faster menus, clean-up, spam filter, security layer

- **AI stability:**
  - **Engine choice kept:** the digital team's chosen engine now stays first for background work too. Before, the background order re-sorted it away, and the newest or slowest engines were tried first.
  - **Per-call limit:** a single background AI call gets at most 18s, so one slow engine can no longer use up a whole request and report "all engines busy".
  - **Zhipu (GLM) endpoint:** keys made at z.ai now use `api.z.ai` by default. A key from open.bigmodel.cn sets `AI_ZHIPU_BASE_URL`.
- **Synced counters:** the "working" badge counts the same thing the board's "In progress" column shows.
- **Faster navigation:**
  - A menu link pulses the moment it is tapped.
  - Pages visited in the last 30s reopen instantly from the client router cache (`staleTimes`).
- **Clean-up (per user):**
  - **Notifications:** select, select all, delete selected, delete all, mark all read. Only your own notifications are deleted, and the list shows up to 100.
  - **Team activity and finished tasks:** select, select all, remove from view, clear all, show all again. This is a personal view; the team's audit log is never deleted.
- **Not-a-customer filter:** newsletters, product updates, automatic notifications and clear spam pitches get no automatic answer and no team alert. They stay in the inbox. The filter is conservative: a short personal question is never filtered.
- **Security layer:** scanner probes (`/.env`, `/.git`, `/wp-login.php`, `/phpmyadmin`, `*.php`, path traversal …) get a bare 404 at the edge, before any session or database work.
- No migration.

## Digital team: a missing permission asks the owner instead of failing

- **Permission requests:** when an employee plans a step with a platform tool it was not given, the task no longer fails or blocks silently. It opens ONE approval per task and tool (`team.grant_tool`) that says who needs which permission and for which task.
- **Notifications:** the business owner and admins get an in-app notification and a push.
- **One click:** approving adds the tool to that employee and puts the task back in the queue. Declining keeps it blocked, as before.
- **Unchanged:** the allowed steps of the same task still run, and the "Not allowed" log line is still written. If the approval cannot be opened, the old behaviour is kept.
- **AI quality gate:** a tiny model (≤ ~3B, e.g. a 2.6B free model) is no longer accepted for plans and reviews while a stronger engine is still available. Its answer is kept and used only as the last resort, which is still better than no answer.
- No migration.

## Team alerts are never lost (Telegram lead → WhatsApp alert)

- Every alert to a team recipient about a customer message is recorded once per recipient, event and message (`notify_deliveries`).
- **Retries:** a failed alert is retried after 1, 3, 10, 30 and 120 minutes instead of being lost. Typical failures: the WhatsApp bridge was reconnecting, the official API refused, a timeout.
- **Catch-up:** an alert that was never attempted is sent by the sweep. This happens when the server ran out of time after the agent had already replied.
- **Never twice:** the same alert is never sent twice.
- **Where it runs:** on the bridge heartbeat (every 30s) and on the scheduled jobs sweep.
- Shabbat / holiday awareness only changes the agent's wording and never blocks team alerts (unchanged).

## Push notifications fix + tidier menus

- **Push notifications now arrive once allowed**:
  - The VAPID subject is always a valid `mailto:` / `https:` URL. A bare e-mail in `VAPID_SUBJECT` made Apple refuse every message.
  - The VAPID JWT now lives 1 hour.
  - A notification reaches every device of the member, not only devices registered in the same workspace.
  - Each refusal is classified. Dead subscriptions are removed and the device re-subscribes by itself. These are subscriptions that expired or were made with an old key.
  - A device that already allowed notifications keeps a valid subscription automatically on every new session (`PushAutoSync`).
  - The service worker re-subscribes when the browser rotates the subscription (`pushsubscriptionchange` → `/api/push/renew`).
  - The test button heals and retries once, explains server-key problems, and allows 12 tries in 10 minutes (was 5).
- **Menus**:
  - Sidebar items have icon tiles.
  - Sidebar groups fold and are remembered; the open screen's group stays open.
  - The inbox count shows on desktop too.
  - The phone menu has a module search and a "recently opened" row.
  - The "More" tab shows a dot when there are unread notifications.

## Agent coordination — every agent works as one team

- **Shared claims board (`agent_claims`)**: before any agent proactively reaches a customer, it claims that customer for the purpose — outreach (24h), collections (20h) or a follow-up task (20h). The agents are the smart team (collections, re-engagement, review requests, abandoned carts, sales manager) and the digital-team employees.
  - Another agent with the same purpose steps aside, so the customer never gets a double message and no agent undoes another's work. The overlap it avoided is counted.
  - A person's explicit action always goes through.
  - When nothing was actually sent, the claim is released.
  - If the migration has not run yet, agents work exactly as before (fail-open).
- **Shared brain**:
  - The smart team now reads the same owner-confirmed business facts as the digital team.
  - Digital-team employees see in a customer's brief which agent already handles that customer.
  - They also see what the smart team did in the last 24 hours, and they follow written coordination rules.
- **Smarter sales manager**: when no deal is stuck, it scans for hot leads in open conversations that have no follow-up, and opens one claimed task per lead. Before, it ran and "found nothing to do".
- **Coordination board** on the smart team page and on My team: a harmony score, the customers being handled right now and by which agent, overlaps avoided this week, and what every agent shares.

## AI resilience, billing integrity, site agent loader

- **AI engines — no more "all busy" stalls**
  - Three more free engines in the failover chain: Together, Cohere and Zhipu GLM Flash.
  - Any OpenAI-compatible engine can be added without code through `AI_EXTRA_ENGINES`.
  - Every engine accepts up to 30 keys (was 10).
  - When every engine rests for only a few seconds, the call now waits exactly that long and makes one more pass. This applies to both user calls and background (team) calls. Before, the work failed and waited for the next clock tick.
  - Team log lines that stayed in English are now shown in Hebrew and Arabic.
  - An empty decision line now shows what the employee understood.
- **Billing integrity**
  - A daily sweep, plus a button in the admin screen:
    - restores the plan to a business that pays but lost access;
    - ends hand-granted plans on their end date;
    - ends failed payments 7 days after the period ended;
    - ends cancelled-at-period-end subscriptions whose end event never arrived.
  - PayPal subscriptions whose period passed are re-read from PayPal.
  - One payment produces one receipt. A PayPal subscription payment that arrives twice keeps its first receipt number.
  - Receipts name what was bought: a plan, a credit pack or a domain.
  - Domain purchases now get receipts.
  - The admin screen has a client file per business: subscription, payments with receipt links, packs, monthly AI usage and plan history.
- **Site agent loader**
  - An animated scene runs while the agent builds or edits a site: a robot with orbiting tools, a page assembling itself, the current stage and a progress bar.
  - When the agent finishes, the scene celebrates and the site is shown as before.
  - On failure, the scene says so and offers to try again.
  - The scene can be closed at any time.

## Design 2.0: a page-builder for websites (section design, ready-made styles), an agency-level ad studio, a livelier platform — 2026-11-06

- **Websites — section design (like a page builder's section inspector):** every section can have its own background (clean / soft / brand colour / gradient / dark band with its own readable palette), entrance (fade / rise / zoom / slide / blur-to-sharp / 3D flip), spacing (compact / roomy), heading alignment and device visibility (phones only / computers only). Stored as an optional `style` on each section (lenient: an unknown value is dropped, never fails the site); sections without it are unchanged.
- **Websites — site-wide design:** button style (solid / gradient / outline / glass / pill), how cards react to the pointer (lift / glow / 3D tilt / none), how sections enter (incl. the new blur and flip), header (glass / solid / transparent until scroll). Kept on load (the editor used to drop unknown theme keys) and in AI answers.
- **Websites — 8 ready-made styles in one click** (elegant, bold, minimal, playful, corporate, cinematic, warm, tech): fonts with Hebrew letters, corners, buttons, hover, entrances, header, effects, section shapes AND a professional rhythm of section backgrounds — content, colours and light/dark are kept, never two heavy bands in a row, undo brings it back.
- **The site agent:** knows the new design language (prompt + parser keep `style` and the site-wide design; a section's style the model left out is kept), new sites are designed from the first minute (a style that fits the template when the model gave none), 6 new one-click design edits (designer pass, design rhythm, make sections stand out, cinematic, glass buttons, calm motion) and the 36 one-click edits are grouped (design / sections / content / language).
- **Ad studio (post editor → "מודעה מעוצבת"):** an agency-level poster like the reference — a cinematic AI key visual without text (or the post's own picture) + a designed text layer drawn on a canvas: a 3D glowing headline, a sub-line, a brush-stroke offer badge with a big 3D price, a ribbon, four benefits with icons, a glowing call-to-action pill and a tagline with a brush underline. Six looks (blue neon, gold luxury, bold, fresh, tech, warm), four formats (1:1, 4:5, 9:16, 16:9), right-to-left aware, everything editable, "attach" uploads a sharp JPEG to the post. Hebrew is always spelled right (the letters are drawn, not generated); a price appears only if the person wrote it.
- **Platform design 2.0 (CSS only, no JavaScript, no layout shift):** cards rise in one after the other, primary buttons get a light sweep, cards and table rows answer the pointer, a brand cover and a living ring around the profile picture, floating empty-state icons, one clear keyboard focus ring. Everything lives in the components layer (a Tailwind utility on the same element always wins), uses only opacity / transform, keeps nothing after it ends, and is off for "reduce motion" and print. The earlier hover lift on primary buttons was moved into the same layer.
- **Verified:** the style pack applied and saved through the real editor, the public site rendered with dark bands / entrances / glass buttons (desktop + phone, no sideways scroll), dialogs still centered and a contact still created, ad posters rendered in 4 styles × 3 formats, the profile ring; 1,601 unit tests ×2, 207 DB tests, all 10 live suites, build, consistency.

## Smart follow-up sequence (honest), and analytics that match the real data — 2026-11-06

- **Follow-up playbook (from the submitted follow-up engine — the ideas that fit, done the platform's way):** the platform already had staged follow-ups (1–5 per silence, gap, one atomic claim, kill-switch on reply / STOP / a person answering, quiet hours, mood-aware tone). Added: every follow-up of a silence now has its own job — 1st = a short personal nudge with a one-tap question, middle = a NEW angle (one real benefit / answer to the doubt from the business data), last = a respectful "closing the loop" message that leaves the door open; strict honesty rules in every prompt (never invented scarcity like "only 2 spots left", deadlines, discounts, guilt or "you didn't answer"). **Not taken over:** fake scarcity, unsolicited SMS "stalking" to someone who never wrote there, and in-process `sleep()` for days (follow-ups stay database jobs that survive restarts).
- **Stops on conversion:** a customer with an upcoming appointment or a deal won in the last 30 days gets no more sales follow-ups (canceled with reason `converted_booked` / `converted_bought`).
- **Night guard:** when the business did not set quiet hours, follow-ups and sequences wait between 21:30 and 08:30 business time and are moved to the morning (not retried every 5 minutes all night). The submitted engine's night check had a bug (after 21:30 it sent immediately); this one is tested with real time zones.
- **Cross-channel (opt-in, off by default):** when the official WhatsApp 24-hour window has closed, the follow-up may go to another conversation the same customer opened and wrote in, only if every guard rule allows it there (consent, STOP, caps, quiet hours). The database guard is still asked first for every message; the new checks can only hold a message back or move it, never allow one the guard refused.
- **Settings:** a "smart follow-up sequence" box in the automated-messages rules (4 switches, he / en / ar); the workspace policy keeps every earlier key and limit (superset migration `20261106000002`).
- **Analytics:** agent quality now also shows "handled by the agent alone" and "handed to the team" (open conversations included — it read 0% because chats are rarely marked closed); "closed without a person" and "repeated question" keep their meaning, with a short explanation ("lower is better"). Open deals without an amount are flagged with a link to the deals board (they made the pipeline and forecast show ₪0); a "collected" card shows money actually received in finance, with the change vs the previous period. The period selector comes first on phones (it was cut off on the side), "new" replaces a meaningless "—" when the previous period was zero, the badge is hidden when both periods are zero, and an odd last KPI card fills the row.
- **Verified:** live on a local Postgres + API with a stand-in model — a 2nd follow-up writes a new angle with the honesty rules and is marked `stage: angle`, the last one closes the loop, a night follow-up moves to the morning (and goes out when the guard is off), a customer with an upcoming appointment gets nothing, cross-channel never uses a conversation the customer did not write in and is off by default; 4 new DB tests (policy defaults, old callers, permissions, quiet hours unchanged), 8 new unit tests; all 10 live suites, 1,587 unit tests ×2, 207 DB tests, build, consistency, mobile screenshots (no sideways scroll).

## Fix: dialogs opened off-center (found by the CI browser tests) — 2026-11-06

- The new dialog / menu open animation (2026-11-05 polish) animated the CSS `translate` property and kept its end value. Tailwind v4 centers dialogs with that same property, so every dialog lost its centering and its lower half (including the save button) was pushed below the screen — the E2E journeys that create a contact, a product, an agent, an automation… timed out. Reproduced locally (dialog box at y = 360 on a 720 px screen, "element is outside of the viewport"), fixed: the animations now only fade and zoom (`opacity` + `scale`), never touch `translate`, and keep nothing after they end (`backwards`). Verified: the same dialog is centered and the contact is created; a unit test guards it.

## AI video for posts (paid by credits), a copy coach for posts, campaign playbooks — 2026-11-06

- **AI video from the post (new, optional, paid by credits):** a "סרטון AI" button in the post editor makes a short clip from what the post says. A video director (free text call) turns the post into one professional shot — the business's real subject (same 20-industry detection as the image director), a camera move per style (cinematic / lifestyle / product / luxury / energetic / calm / 3D), 9:16 / 1:1 / 16:9, 5–8 s, and strict "no text / logos / warped hands" rules. Engines (each optional, tried in order, the next one if one refuses): your own GPU server (ComfyUI with Wan 2.2 / LTX / Mochi behind a tiny wrapper — `VIDEO_SELFHOST_URL`), Replicate (`REPLICATE_API_TOKEN`, default Wan 2.2 fast), fal (`FAL_KEY`, default LTX-Video), Google Gemini Omni Flash / Veo (paid tier only, `AI_GEMINI_VIDEO=on`). Nothing is turned on until a key is added; without one the panel says so.
- **Price and refunds:** `VIDEO_CREDITS` (default 15) credits per clip in ONE usage row (`reserve_ai_credits_bulk`), shown on the button before anything is spent; beyond the monthly allowance the credits come from a purchased pack; a clip that fails, is refused or never arrives (25 min) costs nothing — every pack credit goes back exactly once (the existing refund trigger is accounted for). At most 3 clips in the making per business.
- **Jobs (`social_video_jobs`):** a clip takes 30 s – 3 min, so it is a job: the screen checks it every 6 s and the social clock every 5 minutes (it finishes even with the page closed); a finished clip is copied into the business's media folder (`social-media/<org>/ai-video/…`, a stable link Meta can publish) — if copying fails the engine's link is kept rather than lose a paid clip. The team reads its jobs; only the server writes them.
- **Post copy coach:** a live 0–100 score next to the editor (hook, length, short lines, call to action, hashtags, emojis, a question, no shouting, no dead links on Instagram, clear value) with one concrete tip per miss in he / en / ar; "tidy up" fixes spacing / empty lines / duplicate hashtags without changing a word; a professional rewrite (1 credit) with 6 frameworks — strong hook, AIDA, problem–solution, story, short, list — that keeps every fact and the post's language; the previous text can always be brought back. The one-click full post now gets top-brand copy rules and its picture goes through the image director too.
- **Campaigns:** 10 ready playbooks on "new campaign" (welcome, win-back, flash sale, holiday + offer, event invite, review request, re-engage leads, launch, reminder, VIP) — a written message in he / en / ar, the best channel (e-mail when the suggested one is not connected), a fitting audience and the best time of day; one click fills the editor, everything stays editable, "blank" is still there. Details only the business knows stay as [placeholders] and a warning lists them until they are filled. Quick playbook links and sorting (newest / oldest / name / most recipients / best delivery) on the campaigns list.
- **Verified:** live (local Postgres + API, a stand-in video engine): a clip from a Hebrew post → English director prompt → 1 usage row of N credits → running → done and stored; a failing engine → refund to 0; no engine → clear message, nothing charged; RLS; the panel in the browser start → ready → attach. 1,578 unit tests ×2, 203 DB tests (5 new: bulk credits, exact pack refund, RLS, superset feature list), all 9 live suites, build, consistency, gitleaks.

## Professional images, websites with effects, more one-click AI edits, polish, and agents checked live — 2026-11-05

- **Images — an art director before every picture:** a short text-model call (free, no credit) turns the request ("a post about our color treatment", a Hebrew post, a site brief) into a full art-direction brief — subject + action + setting, camera / lens, lighting, palette (from the brand colours), mood, details — and the prompt adds quality and strict "no text / no warped hands" rules. 20 industries are recognised from Hebrew / Arabic / English (salon, beauty, restaurant, bakery, dental, clinic, fitness, real estate, law, renovation, tech, pets, florist, fashion, education, car, travel, cleaning, photography) so the picture shows the business's real service. Gemini gets the right frame (16:9 hero, 1:1 Instagram, 16:9 Facebook) and is asked again without it if a model does not take it; Cloudflare FLUX runs at 8 steps. Used by the post studio (both buttons), the social autopilot, the website hero and "new hero image". Site photos search a real scene even for a Hebrew brief (was the word "business").
- **Websites — effects pack** (theme `effects`: none / subtle (default) / rich, `dividers`: none / wave / curve / slant): cards lift and glow, images breathe, cards appear one after the other, numbers count up, a scroll progress bar and a back-to-top button; "rich" adds an aurora glow behind the hero, shining buttons, a pointer spotlight on cards, hero / image parallax and a pulsing WhatsApp button. Respects "reduce motion" and the accessibility "still" mode. New AI sites are "rich" (calmer "subtle" for law / medical / corporate); the AI can choose effects and section shapes; the design tab has both controls; the editor keeps them when saving.
- **Editing with the agent:** 10 more one-click edits (wow effects, waves, dark & luxurious, colorful, gallery, team, stronger headline, mobile-first, elegant font, business story) in he / en / ar; the AI may add gallery / team / video sections, and an edit that adds a gallery / about / hero without pictures gets matching photos.
- **Polish:** dialogs open with a short rise, menus fade in, primary buttons lift on hover, secondary buttons tint toward the brand, menu icons move with the pointer.
- **Agents — found live and fixed:** an invented price could still go out through the quick retry after an empty answer (now checked like the first answer; nothing true left → "let me check with the team"); "הסר אותי" / "תסירו אותי" / "תפסיק לשלוח" are understood as stop requests; the phone agent no longer hangs up on the first busy moment (asks the caller to repeat; a second failure ends with the call-back promise).
- **Verified live** (local Postgres + API + stand-in model): lead + memory + task + follow-up + buttons from one answer with no control lines shown, invented price blocked, quick messages answered once, stop confirmed, hand-over → back after team silence, a full phone call with summary, plus the earlier conversation / team / tools / clocks suites; 1,564 unit tests ×2, 198 DB tests, build.

## Reliability: the agent never goes silent, the AI team keeps trying, everything in the business language, a tidier screen — 2026-11-05

- **Root cause of "answered in the morning, then silence":** when the AI engines were busy for 8 minutes the watchdog handed the chat to the team (`stuck_no_answer`), and every AGENT hand-over (a price it could not confirm, "I want a person", an angry customer…) left the conversation with "a person" forever — nobody from the team answered, so every next customer message got no reply. Reproduced on a real local database + API before the fix.
- **Fix (additive):** `stuck_no_answer` counts as a technical pause (the agent takes the chat back); an agent hand-over that nobody from the team answered for 15 minutes (per agent: `profile.unattended_resume_minutes`, 0 = never) comes back to the agent on the customer's next message — never after a person wrote, the owner took over, a legal threat, a forbidden phrase or no AI credits; the agent is told it took the chat back. The watchdog now also answers the original question by itself once an engine frees up (within 3 hours). Hold / hand-over messages never count as a real answer.
- **AI team:** busy engines / network get about 3 hours of retries with growing pauses (was 4 quick tries ≈ 8 minutes, then "failed" for good); a due date written in words no longer fails a task; decision records and plans are asked for in the business language; initiative and radar titles are stored in Hebrew / Arabic; the team log (including lines with a Hebrew name, tool lines, decisions, settings) is shown in the business language.
- **Screen:** every team tab opens with its main work (give a goal, approvals, memory, the log, the settings with the emergency stop first) and the extra cards follow under one heading; AI engine / model lists and "add a key in Vercel" are shown to the platform admin only; the sidebar groups the AI items under "AI & agents"; automatic e-mails (bounces, noreply) no longer fill the inbox "waiting" counter.
- **Verified:** live scenarios on a local Postgres + PostgREST with a stand-in AI model (conversation hand-over → resume, busy engines → rescue, a full goal → plan → 3 tasks done, failed task → retried → done, every team tool on seeded data, every background clock), unit tests ×2, DB tests, build.

## גל 70 — Wave 70: control for the business owner (who works alone, a team log in plain words, one safe "take control back" action) — 2026-11-05

- **Already there, not touched:** the three autonomy levels per employee (`suggest` / `approve` / `auto` + `auto_actions`), `policy-core.ts → decide`, the emergency stop, the operations card (quiet hours, recipient cap), the technical activity timeline, the approvals tab and the audit lines the actions write into `team_activity`. **Per-tool "never" rules were not added: removing a tool from an employee already blocks it (`tool_not_allowed`).**
- **Who works alone (`owner-control-core.ts → autonomyView`, `components/ai-team/owner-control-card.tsx`):** per employee, in business words: what is done alone, what waits for the owner, what is only looked at, and how much of the "alone" part touches customers, money or cannot be undone. It asks the real `decide()` for every tool, so it can never disagree with the engine. Settings tab, after today's health card. Needs no new data (reads the members already on the screen).
- **One safe action (`ai-team/control-actions.ts → tightenAutonomyAction`):** moves employees on `auto` back to `approve` and clears their allowed customer / money actions, for one employee or for the whole team. It only ever goes towards MORE caution (it never touches `suggest` / `approve`), needs `ai.manage`, is scoped to the business and is written to the append-only team log. More freedom is still given only in the employee editor.
- **Team log in the owner's words (`owner-control-core.ts → ownerLog`, `owner-log.ts`, `OwnerLogCard`):** the last 7 days of `team_activity` as short lines: done, waiting for you, decided, stopped and why (reason code → plain sentence), what you changed. Technical phases (understand, plan, self-check, …) are left out. Filters (everything / waiting for you / stopped or failed), a per-employee tally and day groups. Old English lines are translated for display with the existing `localizeLog` (own try block, database unchanged). The loader reads only a few JSON fields of the existing rows and fails silent (card absent).
- **Texts:** new blocks `aiTeam.control.*` and `aiTeam.ownerLog.*` in he / en / ar.
- **Tests:** `tests/unit/wave70-owner-control.test.ts` (31 tests). No existing test was changed. No migrations, no new environment variables.
- **Safety:** additions only (diff: 0 lines removed in every edited file).

## גל 69 — Wave 69: quality measurement (fixed scenarios, 👍/👎 on agent replies, resolution metrics) — 2026-11-05

- **Already there, not touched:** `reply-quality-core.ts` (`qualityIssues`, correction prompts), `intelligence.ts` (`checkReply`), the team evals (`evals.ts`, `evals-plus7.ts`, `tests/unit/team-evals.test.ts`), the audit log (`audit_logs`).
- **47 fixed scenarios (`lib/ai/quality-scenarios.ts`):** real-looking situations in Hebrew, English and Arabic (invented discount / warranty / response time, wrong language, emoji or selling to an upset customer, robotic wording, answer length, clean answers) run through the real checks with NO AI call; each states the exact set of issues expected.
- **👍/👎 on the agent's replies (`reply-feedback-core.ts`, `inbox/feedback-actions.ts`, `components/inbox/reply-feedback.tsx`):** two small buttons under each reply the agent wrote (people who can reply in the inbox). Stored in the existing `audit_logs` (action `ai.reply_feedback`, one row per tap, the latest per person per message counts). No new table, no migration.
- **Resolution metrics (`resolution-core.ts`, `resolution.ts`, `components/analytics/quality-section.tsx`):** on the analytics screen: tickets closed without a person, tickets where the customer asked the same thing again, and the 👍/👎 totals. From existing conversations and messages; no percentage under 5 agent tickets; any failure = no card.
- **Texts:** new block `aiQuality.*` (12 keys) in he / en / ar.
- **Tests:** `tests/unit/wave69-quality.test.ts`.
- **Safety:** additions only; the inbox message query and every existing line are unchanged (diff: 0 lines removed).

## גל 68 — Wave 68: transparency (one clear failure reason, today's health card) — 2026-11-05

- **Already there, not touched:** `classifyFailure` / `classifyToolFailure` / `explainToolFailure` / `reasonCode`, the failure reasons on the team health screen (`aiTeam.health.reason.*`), the team health card (`HealthPanel`: verdict, skipped models, latest failures), the provider health window of wave 66 (`healthRows`).
- **Fewer "unexpected errors" (`failure-wording-core.ts`, `tool-failure-core.ts`):** AI-layer wordings that heal by themselves (rate limited, resource exhausted, unreadable plan, "AI engines busy" in Hebrew, …) used to fall through to the generic `tool_bug` bucket; one extra line before that bucket now classifies them as a temporary problem. Every earlier answer is unchanged.
- **One reason + one action (`failure-reason-core.ts → ownerFailure`):** a sentence in the business language ("מנועי ה-AI עמוסים, ינסה שוב בעוד כמה דקות") and one action, never a technical code, for AI busy / unreadable, network, budget, policy, connection, missing data, input and the real-bug case. Pure and available; the screens still use the extended classifier and texts.
- **Texts:** `aiTeam.health.reason.ai_busy` and `tool_bug` extended in he / en / ar (the old words stay, the way forward is added).
- **Today's health card (`day-health-core.ts`, `day-health.ts`, `day-health-card.tsx`, settings tab, after the health card):** tasks that worked and failed in the last 24 hours, why they failed (existing reason codes) and the state of each AI provider (this server's 15-minute window). Read-only; the loader and the page wiring fail silent (card simply absent). New block `aiTeam.dayHealth.*` in he / en / ar.
- **Tests:** `tests/unit/wave68-transparency.test.ts` (24 tests). No existing test was changed. No migrations, no new environment variables.

## גל 67 — Wave 67: clean team memory (display translation, merged duplicates, robots out of the queue, write gate) — 2026-11-05

- **Already there, not touched:** the automated-sender detection (`isAutomatedSender`, `isAutomatedSenderPlus`) and its use in the waiting-customers queue / `inbox.unanswered`, the title and log translation (`title-i18n-core.ts`), memory supersede by subject, the `proposed` status (the team reads only `active`).
- **Display (`memory-clean-core.ts`, `page-data.ts`, `panels.tsx`, `types.ts`):** the memory tab shows the sentences the team writes itself in he / ar, identical rows merged into the newest one with ×N, empty / placeholder / expired rows hidden. The database is not changed; an edit starts from the stored text (`raw`).
- **Queue (`automated-extra-core.ts`, `tools.ts → automatedContactIds`):** the Telegram service account (name or phone) and contacts whose every conversation ends with a one-time login / verification code message are treated as robots, so they leave "waiting customers" and `inbox.unanswered`. Fails silent → exactly the old set. A question or a long text is never a code.
- **Write gate (`runner.ts → writeMemories`):** empty text, outcomes with 0 actions done and exact repeats are not saved as active memory; the "Assumptions: …" tail of an outcome is saved as a separate `proposed` item. The decision is written to the existing activity log (phase `learn`). Any error → the memories are written exactly as before. Nothing is deleted.
- **Cause found:** task outcomes are written with `subject: null`, so the supersede-by-subject rule never applied and repeated tasks piled up identical rows; the gate stops new exact repeats (old rows stay, hidden by the display merge).
- **Tests:** `tests/unit/wave67-memory-clean.test.ts` (40 tests). No existing test was changed. No migrations, no new environment variables, no dictionary keys.

## גל 66 — Wave 66: AI stability (provider health window, model hint by kind of work, live-before-background) — 2026-11-05

- **Already there, not touched:** the router's per-key/model rests (`capRest`, `ai_provider_rests`), the circuit breaker (`model-health-core`), `guardRoute` / daily quotas (`stability-core`), the team's task-kind routing (`routing-core`), the interactive / background lanes and the paid engines (Anthropic, OpenAI) that already come last and only when a key is set. **No paid-fallback engine was added: it already exists.**
- **Provider health window (`provider-health-core.ts`, `provider-health.ts`):** success and response time of each provider over the last 15 minutes, in this server's memory (no table). It only RE-RANKS the candidates: healthy and neutral first, shaky next, degraded (under 50% with at least 3 calls) last, original order kept inside each tier. It never removes an engine (that stays with the existing rests), a provider with fewer than 3 calls is neutral, and paid providers keep the positions they had.
- **Model hint (`task-hint-core.ts`):** short work (`contact_summary`, `segment`, `transcribe`, `brief`) asks for the faster model of each provider first, heavy work (`insights`, `forecast`, `sales_manager`, `site_builder`) for the stronger one. Only the model order INSIDE a provider changes; never the provider, never the preferred provider, and a team `routeProvider` / `routeModel` switches the hint off.
- **Live before background (`lane-gate-core.ts`, `lane-gate.ts`):** a live request registers and goes on at once; a background request steps aside for at most 3 seconds while live requests run, then goes on anyway (in this instance only; a lease that is never released expires after 35 seconds).
- **`router.ts`, `run-system.ts`, `run.ts`:** additions only (a `hint` input field, three fail-silent helpers, one `lane` enter / release, one health note after each attempt, one `hint:` line per caller). Any error → the order that exists today.
- **Tests:** `tests/unit/wave66-ai-stability.test.ts` (36 tests). No existing test was changed. No migrations, no new environment variables, no UI text.

## גל 65 — Wave 65: team resilience (busy engines, repeated queue task, honest goal status) — 2026-11-05

- **Adaptive tick (`runner.ts`, `team-intel-core.ts → tickBudget`):** when several "engines busy" failures happened in the last 30 minutes the team clock starts 2, then 1, task per tick instead of 3, so a burst does not trip the providers' per-minute limits again. Any error → the usual 3.
- **Waiting-customers task (`runner-plus8.ts → ensureQueueTask`, `queueCooldown`):** after failed queue tasks it waits 30 / 90 / 180 minutes (1 / 2 / 3+ failures in 3 hours) before creating another, instead of a new failing task every hour.
- **No double work (`hasOpenWaitingTask`):** the waiting-customers task is not created while the daily initiative or an earlier queue task on the same customers is still open.
- **Retried tasks (`retryNote`, `team-intel.ts`):** a task retried after a temporary failure is told to check the log, the contact's latest messages and pending approvals first, so nothing is sent or created twice.
- **Goals (`runner.ts → refreshGoal`, `panels.tsx`):** the goal result now carries `outcome` (complete / partial / failed) and the badge shows "Partly done" when some tasks failed (new key `aiTeam.goal.partial` in he / en / ar). The stored status is unchanged.
- **Titles (`title-i18n-core.ts`):** the numbered daily-initiative titles ("Reach N new lead(s)…", "Answer N negative review(s)", "N conversation(s) waiting…", "Revive N stuck deal(s)", "N overdue invoice(s)", "No post for N days", "Leads dropped sharply…") are shown in Hebrew / Arabic. Display only; the database is not changed.
- **Tests:** `tests/unit/wave65-team-resilience.test.ts` (12 tests). No migrations, no new environment variables.

## גל 64 — Wave 64: a smarter AI team (queue order, role fit, briefing, inbound guard, harmony) — 2026-11-04

- **Queue order (`team-intel-core.ts`, `plus8b-hooks.ts → prioritizeTasks`):** the stub that returned the tasks unchanged is now a real, stable ordering: owner priority, overdue / due-soon, age (no starvation), owner-asked and colleague-waiting work, customers waiting, and what unblocks other tasks. The waiting-customers queue still comes first (the order is applied inside each group in `runner-plus8.ts → orderForTick`).
- **Briefing before every task (`team-intel.ts`, `plus8b-hooks.ts → preTask`):** time awareness (Shabbat / holiday only for customer sends), role boundary, colleagues' open work (no duplicates), urgency, bulk-send rule, the role's definition of "done", and a live roster for manager / team lead / coordinator. It only adds context; it never blocks.
- **Roster assessment:** each employee is judged in its own role (load, 30-day success, approvals); fewer than 3 finished tasks = "new", never "bad".
- **Inbound guard (`plus8b-hooks.ts → guardInbound`):** hidden characters, fake `<<<` markers and control tags are neutralised and instruction-like text is labelled; normal text is returned unchanged.
- **Harmony (`plus8b-hooks.ts → dailyTick`):** pending tasks nobody owns (they used to stop with `no_assignee`) go to the fitting role; unstarted work moves off an overloaded employee to a free colleague with the same role. Never the owner's own assignments; at most 3 changes, at most every 20 minutes per business; each change is logged.
- **`runner.ts`:** the tick also reads title / dates / origin / owner; on any error the original narrow read runs unchanged.
- **Tests:** `tests/unit/wave64-team-intel.test.ts` (31 tests). No existing test was changed. No migrations, no new environment variables.

## שדרוג 8, שלב ב (ב3–ב7) — Upgrade 8, stage B (B3–B7): job descriptions and department meetings added (B5–B6; B7 follows) — 2026-11-05

- **B5 — job descriptions and the employee card (`job-profile-core.ts`, `employee-card.tsx`, `org-actions.ts`):** every employee has a job description in he / en / ar (responsibilities, authority, what is forbidden, the procedures that are theirs), derived from the role and the department; the owner may adapt the wording per employee (`team_job_profiles`, migration `20261105000012`). **Text only:** it grants no tool and changes no approval rule; the universal prohibitions (no customer contact / money / irreversible action without the owner, no invented facts, no leaking keys or payment details) are in every profile and an owner override can only ADD to the forbidden list. The card shows the department, the profile, the real success rate and average time from the employee's own finished tasks (with a "small sample" label under 5), open tasks, load and procedures. The change shows at once and is undone with a message if the server refuses.
- **B6 — department meetings (`dept-meeting-core.ts`, `org8-profiles-data.ts`):** a short daily meeting per department (queue, blocked, urgent and ONE decision by a fixed order: blocked → agreement breach → urgent → high load → continue the queue) and a weekly one, **built by code from the real tasks, no model**. The weekly report that is shown gets a "by department" split appended in `page-data.ts` at display time (the stored report and `buildReport` are unchanged; the split is idempotent and departments with no employees are left out).
- **Self-check:** `supabase/checks/upgrade_8_stage_b_selfcheck.sql` (a new file, not a migration) prints OK / MISSING for every stage-B table, column, index, constraint, trigger, policy and RLS flag.
- **Tests:** `tests/unit/upgrade8-org-b5-b7.test.ts` (new file, 54 tests). No existing test was changed.

## Team upgrade 8 / stage B (B3–B7) — שדרוג 8, שלב ב (ב3–ב7): responsibility, department agreements, job profiles, meetings, organisation screen (additive, nothing removed) — 2026-11-04

- **B3 — responsibility and approvals (`raci-core.ts`):** a RACI row (who does it / approves / is consulted / informed) for each of the 18 default procedures, and an **approval matrix**: extra owner-approval rules by action type and size (a discount above 10% or above an amount, a new deal above 20,000, a message to "all customers", running an agent that reaches many people). Enforced in `runner.ts` (`runTool`) through `runner-org8.raciHold`: an action the policy already decided to execute becomes an owner approval when the matrix hits. **The matrix can only tighten:** `tighten()` never turns an approval or a block into an execute; the final approver of anything a customer sees, money or irreversible is always the owner; an owner-approved procedure cannot be re-assigned to an employee. The responsibility line is added to the procedure block of the employee's context. Owner overrides: tables `team_raci_roles` / `team_raci_matrix` (migration `20261105000010`).
- **B4 — department agreements (`dept-sla-core.ts`):** six default agreements (e.g. marketing → sales within 60 minutes), measured automatically from the handoff messages and the tasks they created (created → started). A handoff still waiting past its limit is a breach now. One line in the morning brief that the screen shows (added at display time in `page-data.ts`; the stored report is unchanged; the weekly report gets its section in B6) and ONE owner notification a day per breach (`team_sla_alerts`, unique per agreement and day). Owner overrides: `team_dept_sla` (migration `20261105000011`).

## Team upgrade 8 / part A, stage A — stability and fixes for the live failures (additive, nothing removed) — 2026-11-03

- **Fix (bookkeeping bug):** a call that succeeded through a fallback no longer records `fallback_used` as a failure of the first model (`stability-core.healthUpdates`, used in `runner.ts`). A model that really failed still counts; the engine that answered counts as healthy.
- **Route guard:** `guardRoute` leaves out, for ONE attempt only, engines with no server key, models that do not fit the kind of work (a text model for vision/images), resting engines, engines over a daily quota or failing in a row, and prefers idle engines. If everything would be skipped the original route is used. Keys are never read out. Nothing is removed from the routing table.
- **New pure modules** (`apps/web/lib/team/`): `stability-core`, `tool-failure-core` ("needs a connection" is a status, not a failure), `dedupe-core` (intent fingerprint, merge plan = mark "merged", never delete), `title-i18n-core` (display translation of old English titles/log lines; new titles are asked for in the business language), `response-queue-core` (waiting queue, median next to the average, SLA alert), `restart-core`, and the server glue `runner-plus8`.
- **Migration** `20261105000007_team_upgrade_8_stability.sql`: widens the task status CHECK (`requires_connection`, `merged`), adds columns, `team_provider_usage`. Self-check: `supabase/checks/upgrade_7_8_selfcheck.sql` (not a migration).
- **UI:** "Restart" per task, "Cancel old blocked", "Merge duplicates", the waiting-customers queue, skipped engines with how to add a free key, and an A/B sample-entry screen wired to the existing `analyze` decision code. Texts in he/en/ar.
- **Part B contract:** stubs `plus8b-hooks.ts` and `plus8b-panels.tsx` and their wiring (preTask, guardInbound, guardOutbound, prioritizeTasks, dailyTick, panels slots).

## Team upgrade 7 / stages C–J — goals, understanding, decisions, experiments, coordination, reports, speed, transparency (additive, nothing removed) — 2026-11-03
- **C — goals and forecasts:** a goal = metric + baseline + target + due date + owner (`team_business_goals`). Progress is measured from the CRM (leads, deals won, revenue, conversations, rating, agent reply time), never typed by a model. The forecast is an 80% **range with a probability**; with fewer than 7 days of data the answer is "not enough data". ONE alert per change into "at risk" / "off track" (activity log + owner notification), daily snapshots, a goal card on the Goals tab. An employee can only *propose* a goal (`goals.set`); the owner activates it.
- **D — understanding decoder (`understanding-core.ts`):** real Hebrew (niqqud, stretched letters, fillers, laughter, repeated words from speech-to-text, slang phrases, missing / wrong spelling by skeleton + one-typo matching, spoken numbers like "מאה עשרים שקל"), also English and Arabic → what was said, intent, what is missing, urgency, emotion, confidence. Ask-or-assume policy by the **cost of a wrong guess** (low → assume out loud, medium → ONE question, high → never guess). Owner and customer models. Confidence calibration from the owner's verdicts (Brier / calibration error).
- **E — decision and reflection (`decision-core.ts`, `engine-plus7.ts`):** a wrapper around the unchanged engine. Routing is **plain code**: fast path (no extra model call) for simple tasks; deep path only for risk (money, irreversible, large amount, refund / legal / discount wording, high cost of error, many recipients) = 2–3 options + pre-mortem + an **independent auditor** (never the author). Deterministic audit that no model can override; if the audit does not approve, customer / money / irreversible actions become ONE owner approval with the reasoning attached. The decision record is append-only and hash-chained (`team_decisions`, trigger-enforced); lessons go to memory only as **proposals**.
- **F — recommendations and A/B experiments (`experiments-core.ts`):** owner + one deciding metric, minimum sample size per arm and minimum days, two-proportion test with confidence interval, no peeking; "not enough data" is a legitimate verdict (`team_experiments`, `experiments.list` / `experiments.propose`).
- **G — team coordination (`coordination-core.ts`):** shared board (`team_board_notes`, `board.view` / `board.post`), schema-checked handoff contracts, arbitration (owner-confirmed facts always win, then source, authority, confidence, recency, else the owner decides), escalation ladder, short daily stand-up, load balancing with specialization.
- **H — reports and insights (`reports-core.ts`):** weekly / monthly reports and the morning brief are built by code from measured numbers in the business language; anomalies by thresholds in code (z-score + absolute + relative); stored per period (`team_reports`), generated by the daily tick.
- **I — speed and reliability:** optimistic action runner (rolls back on error) used by the new cards, TTL cache with explicit invalidation, model tier by cost (`speed-core.ts`), and a **48-scenario evaluation set** (`evals-plus7.ts`, 34+ in real Hebrew) that runs in CI without a live model.
- **J — transparency (`transparency-core.ts`):** "Why I did this" panel on the Activity tab, built from the decision record only (no raw chain of thought); the owner's verdict / correction is stored append-only (`team_decision_feedback`) and becomes a proposed lesson.
- **Safe without the migrations:** run `20261105000002` … `20261105000006` (goals, decisions, experiments, coordination, reports). Until then the tools answer `migration_not_applied`, the cards are hidden and the team works exactly as before. No new service or key.
- Texts: `aiTeam.plus7.*` and `aiTeam.tools.*` in Hebrew / English / Arabic (same keys). Existing `withRoleExtras`, `withRoleExtras7` and every existing test are unchanged (new grants use `withRoleExtras7c`).

## Team upgrade 7 / stage B — versioned business memory (additive, nothing removed) — 2026-11-02
- **Business facts with history:** prices, opening hours, policies, contact details and offers are kept as **versions** (new table `team_business_facts`, append-only: a new value is a new row, the old one is only closed with an end date; a stored value can never be edited — enforced by a trigger). Every version has a source, the time it was observed, a validity window, a confidence and whether the owner confirmed it.
- **Contradictions are resolved by rules, not guessed:** the owner always wins; a value the owner confirmed is **never overwritten** by an employee, the web, a document or the CRM — the newcomer waits as a proposal for the owner's decision; between unconfirmed values the newer observation wins, an older one is ignored, and a newer but much less trusted one waits for the owner. The model can never claim to be the owner (the source is set by the server).
- **Retrieval by relevance:** each task gets only the facts it is about (Hebrew prefixes and stop words handled), owner-confirmed first, owner-confirmed policies always (max 3), expired / proposed / replaced versions never; a fact older than its kind's limit (price 120 days, offer 45, …) is flagged "may be outdated" so the employee says it is not sure instead of guessing. The block is added to the employee's context without touching the engine.
- **Tools:** `facts.lookup`, `facts.history` (read), `facts.record` (proposes or adds an unconfirmed fact). Everyone may look facts up; manager and analyst may also record.
- **Screen (My team → Memory):** current facts with version / source / date / confidence / confirmed badge / history, the owner's waiting decisions (approve / keep current) and an add-or-update form. **Optimistic:** the answer shows at once using the same rules in the browser; a server error puts everything back. Texts in Hebrew / English / Arabic (`aiTeam.facts.*`), log lines in the business language.
- **Safe without the migration:** run `supabase/migrations/20261105000001_team_upgrade_7_business_facts.sql`. Until then the tools answer `migration_not_applied`, the panel is hidden and the team works exactly as before. No new service or key.
- Tests: `tests/unit/team-upgrade7-business-facts.test.ts` (30). Existing `withRoleExtras` and every existing test are unchanged (the new grants use `withRoleExtras7`).

## Team upgrade 6 — reliability fixes (additive, nothing removed) — 2026-11-02
- **"The plan could not be read" fixed at the root:** the strict JSON reader stays first; when a weak / fallback model answers with slightly broken JSON (literal newlines, unescaped quotes, trailing commas, smart quotes, a cut-off answer), a tolerant recovery (`firstJsonObjectTolerant`) rescues it. Used for the employee plan, the reviewer verdict and the manager's goal plan. Nothing is invented from a cut-off answer.
- **Chains no longer stay blocked forever:** tasks blocked only because a dependency failed (`dependency_failed`) come back by themselves once the dependency is retried / pending / done (`reviveBlockedDependents`, runs with the team clock).
- **Summaries in the business language:** "N action(s) done / Assumptions" is now Hebrew / Arabic / English by the business locale; a rule tells every employee to use only that language's script.
- **Faster:** independent reads in `runTask` run together, one organization query instead of two; "run now" gets `maxDuration = 60` so a longer task is not cut off by the platform.
- **One repair attempt (6b):** when the plan is unreadable even after tolerant recovery, the employee is asked ONCE more for valid JSON before the task fails (logged, bounded by the same budget limits).
- **Dead items close by themselves (6b):** a task blocked by a failed dependency for more than 3 days becomes `canceled` with the reason `expired_blocked` (kept in history, nothing deleted).
- Tests: `tests/unit/team-upgrade6-plan-recovery.test.ts`.

## Digital team, stage-1 audit, model routing, design + performance — 2026-11-02
- **Stage 1 audit:** all 289 server actions and 78 API routes reviewed (identity, permission, validation, translations); fixes: two missing translations, AI studio permission + "deleted" truth; a permanent CI guard (`tests/unit/actions-audit.test.ts`); table in `docs/audit/stage1-actions.md`.
- **Digital team (behind the `team_v1` flag):** 12 roles + custom, a playbook file per role (he + en), the 8-phase work cycle (understand → context → plan → execute → self-check → peer review → deliver → summarize/learn), the manager's dependency-graph planning and assignment by load, handoffs with full context, structured messages, one approval queue, autonomy levels with explicit per-action autonomy, emergency stop, depth / step / credit limits and loop detection, prompt-injection defence, an append-only activity log, three-layer memory with confidence, expiry, contradiction resolution and owner-confirmed learning, daily initiative and the weekly team meeting, metrics per employee. The existing agents and capabilities are the team's tools (CRM, inbox with its guard, social brain, site builder, business agents, reviews, calendar).
- **Model routing by kind of work** on top of the existing router (plan / review / write / site / classify / summarize / vision), database routing table, per-business preference, automatic fallback logged.
- **"My team" screen** (`/ai-team`): 3D presentation (rotating ring, drag / swipe / keyboard, auto-rotate, add card), grid, org chart, animated customizable avatars (idle / working / waiting / success / error), full editor (profile + look, personality, tools, autonomy, memory, history, performance, test chat), hire gallery, goals + plan approval + live board, approvals (bulk, edit, reject with a reason), memory screen, playbooks, weekly meeting + performance, live activity, settings with the emergency stop.
- **Design:** motion / radius / elevation tokens, consistent hover / focus / disabled states in the dashboard, soft route transitions, toasts with close.
- **Performance:** additive indexes (inbound messages per business 37 ms → 0.65 ms on 600k rows), the team screen in its own lazy chunk, optimistic approvals.
- **Tests:** 17 evaluation scenarios + 5 orchestrator checks, unit tests for every core, database tests (isolation, append-only log, constraints), an E2E spec for the team.

## Meta for everyone, smarter site agent and social brain — 2026-11-02
- **Facebook / Instagram without waiting for Meta's review** (Integrations → "2 more ways to connect"):
  - *Join as a tester* — the platform invites the person to the platform app automatically (Meta app-roles API); when Meta refuses, the request waits for a platform admin with one-click "added".
  - *Your own Meta app* — the business pastes App ID + App Secret (checked with Meta, stored encrypted), webhooks are configured automatically, then "Connect through my app" (full-page login, several Pages chooser). Works at once, independent of the platform app.
  - The Page webhook accepts the business's own app (verify token by hash, signature by that app's secret) — and only for that business's Pages. The 1-minute sync checks the business's own app subscription.
  - A failed one-click connection ("App not active") opens the alternatives automatically.
- **Site agent with tools:** real business facts (contact, products & prices, real reviews, knowledge articles, social links) in the prompt and in the site; invented testimonials replaced with real reviews; site settings (footer, legal, WhatsApp button) filled; free photos for hero / about / gallery (Pexels → Pixabay → Openverse); quality audit + one AI fix pass; live build stages and a report (facts · photos · quality score).
- **Social brain — deeper understanding:** learns which openings, weekdays, emoji use, calls to action and hashtag counts work; reads what customers asked in the inbox lately; knows the day/season of the post; real products & prices; self-checks every draft and rewrites a weak one once with concrete feedback. Shown in the brain panel.
- **Design layer:** animated light border for featured sections, hover glow for tiles, gradient page titles, mesh headers, a breathing primary action (all off for reduced motion).

## Enterprise core — 2026-11-01
- **Mission Control** (`/{locale}/health`): status of email, social, payments, delivery queue, websites, surveys and every channel, with reasons and fix links; failed deliveries with retry / cancel / retry-all; background job runs and grouped errors for platform admins.
- **Observability:** structured JSON logger with PII/secret redaction (`lib/ops/log.ts`), server error capture (`instrumentation.ts`), browser error reports (`/api/errors`), grouped `app_errors`, optional Sentry via `SENTRY_DSN`; `/api/health` live checks (database, storage, queue lag).
- **Cron governance:** `job_runs` with a database lock against overlapping runs for every scheduled route.
- **Loading / error screens** for every dashboard module (skeleton per layout, event id, retry, copy, support).
- **Daily post:** the created post opens at once in an editor drawer (publish now, fresh version, duplicate, delete), progress stages, retry without losing the topic, highlighted "new" in the calendar.
- **Saved views** for contacts (personal / shared).
- **Satisfaction surveys** (CSAT / NPS / CES) after a closed conversation, public one-click page `/r/{token}`, low-score alerts.
- **Security:** two-step sign-in (authenticator app) with `/mfa` step, sign out other devices.
- **Privacy:** personal-data export (JSON) and anonymization per contact; audit log CSV export.
- **API:** OpenAPI 3.1 at `/api/public/v1/openapi.json`, reference at `/{locale}/docs/api`.
- Docs: `BUILD_STATUS.md` rewritten to the real state.

## Wave 61 — 2026-11-01
Social brain (daily autopilot posts with image/video, learning from engagement, Motion Studio, phone preview, versions per network, smart hashtags, Telegram channel); WhatsApp Meta diagnosis and "stuck" guide; every platform email falls back to the connected mailbox.

## Wave 60 — 2026-10-31
WhatsApp auto-registration (#133010) + fix button with PIN; transfer number shown as a call target; Pixel ID autofill guard; clear Twilio assign errors.

## Wave 59 — 2026-10-31
Smarter agent (learning, coach, opener A/B), missed-call text-back, outbound calls, recordings, connection health center, quick start, pay in chat, smart review requests, minute packs.

## Earlier
Waves 1–58: foundation, CRM, inbox and channels, AI agents, automations, campaigns, websites, forms, meetings, finance, social studio, phone agent — see the git history.
