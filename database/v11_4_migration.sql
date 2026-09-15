-- SwitchCare Enterprise v11.4 migration
-- Safe patch: restores the missing internal audit helper used by the business RPCs.
-- Existing data is preserved. No DROP TABLE / TRUNCATE.

create or replace function public.log_event(
  p_switch public.switches,
  p_event_type text,
  p_document_no text default null,
  p_note text default null,
  p_old_data jsonb default null,
  p_new_data jsonb default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.audit_log(
    switch_id,event_type,material_no,taipower_no,document_no,
    actor_id,actor_email,note,old_data,new_data
  )
  values(
    p_switch.id,
    coalesce(nullif(trim(p_event_type),''),'設備異動'),
    p_switch.material_no,
    p_switch.taipower_no,
    nullif(trim(p_document_no),''),
    public.current_actor_id(),
    public.current_actor_email(),
    p_note,
    p_old_data,
    p_new_data
  );
end;
$$;

-- Keep the helper internal; business RPCs execute it under SECURITY DEFINER.
revoke execute on function public.log_event(public.switches,text,text,text,jsonb,jsonb) from public;
revoke execute on function public.log_event(public.switches,text,text,text,jsonb,jsonb) from anon;
revoke execute on function public.log_event(public.switches,text,text,text,jsonb,jsonb) from authenticated;
