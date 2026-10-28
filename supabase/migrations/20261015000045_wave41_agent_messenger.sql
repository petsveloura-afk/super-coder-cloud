-- Wave 41 — additive only: an enabled AI agent that already answers at least one channel
-- also answers Facebook Messenger / Instagram Direct (agents created after wave 19 by the
-- one-click button were missing them, so Messenger messages were never answered).
-- The business can still switch either channel off on the AI agent page. Idempotent.
update public.ai_agents
   set autopilot_channels = autopilot_channels || array['messenger']
 where enabled
   and cardinality(autopilot_channels) > 0
   and not ('messenger' = any (autopilot_channels));

update public.ai_agents
   set autopilot_channels = autopilot_channels || array['instagram']
 where enabled
   and cardinality(autopilot_channels) > 0
   and not ('instagram' = any (autopilot_channels));
