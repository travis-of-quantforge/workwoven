-- Preserve provider audit input in agent_runs.prompt, but repair human chat
-- messages that mistakenly included server-appended advisory context.
update public.messages m set body=split_part(split_part(m.body,
 E'\nCurrent unresolved shared findings (advisory, not commitments; verify source records): ',1),
 E'\nThe unresolved finding list exceeds this chat context; use Review discussion for current issues.',1)
from public.agent_runs r
where r.question_message_id=m.id and m.channel='agent' and m.kind='human'
and (position(E'\nCurrent unresolved shared findings (advisory, not commitments; verify source records): ' in m.body)>0
or position(E'\nThe unresolved finding list exceeds this chat context; use Review discussion for current issues.' in m.body)>0);
