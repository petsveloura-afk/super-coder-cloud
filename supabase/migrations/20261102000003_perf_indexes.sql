-- Performance (additive, idempotent): indexes for the queries the social brain, the digital team (profile,
-- initiative, unanswered conversations) and the business agents run per business. No table, column or data changes.

-- inbound messages of a business in a time window (customer questions, metrics, the live business profile)
create index if not exists messages_org_dir_created on public.messages (organization_id, direction, created_at desc);

-- open conversations by the customer's last message (who is waiting for an answer)
create index if not exists conversations_org_open_customer on public.conversations (organization_id, last_customer_at desc) where status = 'open';

-- recent reviews by rating (negative reviews without a reply, real testimonials for websites)
create index if not exists reviews_org_created_rating on public.reviews (organization_id, created_at desc, rating);

-- published posts of a business by date (performance, "days since the last post")
create index if not exists social_posts_org_status_sched on public.social_posts (organization_id, status, scheduled_at desc);

-- new leads of a business (initiative: leads without a reply)
create index if not exists contacts_org_status_created on public.contacts (organization_id, status, created_at desc);
