-- Facebook Messenger / Instagram Direct: every enabled agent that already answers somewhere also answers there.
-- (agents made with the quick-create button before this fix did not list the two Meta channels, so the
-- webhook stored the message but no agent was found to answer it). Additive: nothing is removed.
update public.ai_agents
   set autopilot_channels = autopilot_channels || array['messenger']::text[]
 where enabled
   and cardinality(autopilot_channels) > 0
   and not ('messenger' = any (autopilot_channels));

update public.ai_agents
   set autopilot_channels = autopilot_channels || array['instagram']::text[]
 where enabled
   and cardinality(autopilot_channels) > 0
   and not ('instagram' = any (autopilot_channels));

notify pgrst, 'reload schema';
