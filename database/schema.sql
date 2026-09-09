-- SwitchCare Enterprise v8.3 FINAL
-- Safe re-runnable Supabase/PostgreSQL migration.
-- Existing data tables are preserved.
-- It dynamically removes dependent legacy triggers before replacing
-- helper/business functions, eliminating prior 2BP01/42723 failures.

create extension if not exists pgcrypto;

create table if not exists public.switches (
  id uuid primary key default gen_random_uuid(),
  material_no varchar(10) not null check (material_no ~ '^[0-9]{10}$'),
  type text not null,
  taipower_no text not null unique,
  rating_type text not null check (rating_type in ('新品','舊品')),
  warehouse text,
  location text,
  entry_date date not null,
  state text not null default '在庫'
    check (state in ('在庫','領用中','送檢充電','充電中','停用')),
  cycle_start_date date,
  last_charge_date date,
  next_charge_date date,
  issue_date date,
  return_date date,
  issue_no text,
  transfer_no text,
  send_date date,
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.charge_records (
  id uuid primary key default gen_random_uuid(),
  switch_id uuid not null references public.switches(id),
  cycle_no integer not null,
  start_date date not null,
  due_date date not null,
  send_date date,
  transfer_no text,
  completed_date date,
  status text not null default '待充電'
    check (status in ('待充電','送檢中','充電中','已完成','因領用中止','取消')),
  department text,
  technician text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(switch_id, cycle_no)
);

create table if not exists public.usage_records (
  id uuid primary key default gen_random_uuid(),
  switch_id uuid not null references public.switches(id),
  issue_date date not null,
  issue_no text,
  return_date date,
  status text not null default '領用中'
    check (status in ('領用中','已退庫','取消')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  switch_id uuid references public.switches(id),
  event_at timestamptz not null default now(),
  event_type text not null,
  material_no text,
  taipower_no text,
  document_no text,
  actor_id uuid,
  actor_email text,
  note text,
  old_data jsonb,
  new_data jsonb
);

alter table public.switches add column if not exists remark text;
alter table public.switches add column if not exists updated_at timestamptz not null default now();
alter table public.charge_records add column if not exists department text;
alter table public.charge_records add column if not exists technician text;
alter table public.charge_records add column if not exists note text;
alter table public.charge_records add column if not exists updated_at timestamptz not null default now();
alter table public.usage_records add column if not exists note text;
alter table public.usage_records add column if not exists updated_at timestamptz not null default now();
alter table public.audit_log add column if not exists actor_id uuid;
alter table public.audit_log add column if not exists actor_email text;

create index if not exists idx_switches_next_charge on public.switches(next_charge_date);
create index if not exists idx_switches_state on public.switches(state);
create index if not exists idx_switches_taipower on public.switches(taipower_no);
create index if not exists idx_switches_material on public.switches(material_no);
create index if not exists idx_charge_switch on public.charge_records(switch_id);
create index if not exists idx_charge_status on public.charge_records(status);
create index if not exists idx_usage_switch on public.usage_records(switch_id);
create index if not exists idx_usage_status on public.usage_records(status);
create index if not exists idx_audit_switch on public.audit_log(switch_id);
create index if not exists idx_audit_time on public.audit_log(event_at desc);

-- Remove every non-internal trigger that points to the helper functions.
-- This catches legacy names such as trg_switches_touch.
do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name, t.tgname as trigger_name
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid
    where not t.tgisinternal
      and n.nspname='public'
      and p.proname in ('touch_updated_at','audit_switch')
  loop
    execute format(
      'drop trigger if exists %I on %I.%I;',
      r.trigger_name,r.schema_name,r.table_name
    );
  end loop;
end $$;

-- Remove all application functions by identity arguments.
-- This prevents old overload/defaults from colliding with the new version.
do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'create_switch',
        'update_switch_master',
        'issue_switch',
        'return_switch',
        'send_switch_for_charge',
        'complete_switch_charge',
        'log_event',
        'audit_switch'
      )
  loop
    execute format(
      'drop function if exists %I.%I(%s);',
      r.nspname,r.proname,r.args
    );
  end loop;
end $$;

create or replace function public.current_actor_email()
returns text language sql stable as $$
  select coalesce(auth.jwt()->>'email','system')
$$;

create or replace function public.current_actor_id()
returns uuid language sql stable as $$
  select auth.uid()
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

create function public.log_event(
  p_switch public.switches,
  p_event_type text,
  p_document_no text default null,
  p_note text default null,
  p_old jsonb default null,
  p_new jsonb default null
)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.audit_log(
    switch_id,event_type,material_no,taipower_no,document_no,
    actor_id,actor_email,note,old_data,new_data
  )
  values(
    p_switch.id,p_event_type,p_switch.material_no,p_switch.taipower_no,p_document_no,
    public.current_actor_id(),public.current_actor_email(),p_note,p_old,p_new
  );
end;
$$;

create function public.audit_switch()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.audit_log(
      switch_id,event_type,material_no,taipower_no,actor_id,actor_email,new_data,note
    )
    values(
      new.id,'建立設備',new.material_no,new.taipower_no,
      public.current_actor_id(),public.current_actor_email(),
      to_jsonb(new),'建立開關主檔'
    );
  elsif tg_op='UPDATE' then
    insert into public.audit_log(
      switch_id,event_type,material_no,taipower_no,document_no,
      actor_id,actor_email,old_data,new_data,note
    )
    values(
      new.id,
      case when old.state is distinct from new.state then new.state else '資料修改' end,
      new.material_no,new.taipower_no,coalesce(new.transfer_no,new.issue_no),
      public.current_actor_id(),public.current_actor_email(),
      to_jsonb(old),to_jsonb(new),
      case when old.state is distinct from new.state then '狀態異動' else '設備主檔修改' end
    );
  end if;
  return new;
end;
$$;

create trigger trg_switches_updated
before update on public.switches
for each row execute function public.touch_updated_at();

create trigger trg_charge_updated
before update on public.charge_records
for each row execute function public.touch_updated_at();

create trigger trg_usage_updated
before update on public.usage_records
for each row execute function public.touch_updated_at();

create trigger trg_switches_audit
after insert or update on public.switches
for each row execute function public.audit_switch();

create function public.create_switch(
  p_material_no text,
  p_taipower_no text,
  p_type text,
  p_rating_type text,
  p_warehouse text default null,
  p_location text default null,
  p_entry_date date default current_date,
  p_remark text default null
)
returns uuid language plpgsql security invoker as $$
declare v_switch public.switches; v_next date;
begin
  if p_material_no !~ '^[0-9]{10}$' then raise exception '料號必須為10位數字'; end if;
  if coalesce(trim(p_taipower_no),'')='' then raise exception '台電編號不可空白'; end if;
  if coalesce(trim(p_type),'')='' then raise exception '型式不可空白'; end if;
  if p_rating_type not in ('新品','舊品') then raise exception '評價類型只能是新品或舊品'; end if;
  if exists(select 1 from public.switches where taipower_no=trim(p_taipower_no)) then raise exception '台電編號已存在：%',trim(p_taipower_no); end if;
  v_next:=(p_entry_date+interval '6 months')::date;
  insert into public.switches(
    material_no,taipower_no,type,rating_type,warehouse,location,entry_date,state,
    cycle_start_date,next_charge_date,remark
  )
  values(
    p_material_no,trim(p_taipower_no),trim(p_type),p_rating_type,p_warehouse,p_location,
    p_entry_date,'在庫',p_entry_date,v_next,p_remark
  )
  returning * into v_switch;
  insert into public.charge_records(switch_id,cycle_no,start_date,due_date,status,note)
  values(v_switch.id,1,p_entry_date,v_next,'待充電','首次入帳，建立6個月週期');
  return v_switch.id;
end;
$$;

create function public.update_switch_master(
  p_switch_id uuid,p_material_no text,p_taipower_no text,p_type text,p_rating_type text,
  p_warehouse text default null,p_location text default null,p_entry_date date default null,p_remark text default null
)
returns void language plpgsql security invoker as $$
declare v_old public.switches; v_new public.switches;
begin
  select * into v_old from public.switches where id=p_switch_id for update;
  if not found then raise exception '找不到設備'; end if;
  if p_material_no !~ '^[0-9]{10}$' then raise exception '料號必須為10位數字'; end if;
  if coalesce(trim(p_taipower_no),'')='' then raise exception '台電編號不可空白'; end if;
  if coalesce(trim(p_type),'')='' then raise exception '型式不可空白'; end if;
  if p_rating_type not in ('新品','舊品') then raise exception '評價類型只能是新品或舊品'; end if;
  if exists(select 1 from public.switches where taipower_no=trim(p_taipower_no) and id<>p_switch_id) then raise exception '台電編號已存在：%',trim(p_taipower_no); end if;
  update public.switches
  set material_no=p_material_no,taipower_no=trim(p_taipower_no),type=trim(p_type),
      rating_type=p_rating_type,warehouse=p_warehouse,location=p_location,
      entry_date=coalesce(p_entry_date,entry_date),remark=p_remark
  where id=p_switch_id
  returning * into v_new;
end;
$$;

create function public.issue_switch(
  p_switch_id uuid,p_event_date date,p_document_no text default null,p_note text default null
)
returns void language plpgsql security invoker as $$
declare v_old public.switches; v_new public.switches; v_charge public.charge_records;
begin
  select * into v_old from public.switches where id=p_switch_id for update;
  if not found then raise exception '設備不存在'; end if;
  if v_old.state<>'在庫' then raise exception '目前不是在庫狀態，無法領用'; end if;
  update public.switches set state='領用中',issue_date=p_event_date,issue_no=p_document_no,
    cycle_start_date=null,next_charge_date=null,send_date=null,transfer_no=null,remark=p_note
    where id=p_switch_id returning * into v_new;
  select * into v_charge from public.charge_records
    where switch_id=p_switch_id and status='待充電' order by cycle_no desc limit 1 for update;
  if found then
    update public.charge_records set status='因領用中止',
      note=coalesce(p_note,'設備領用，停止本次在庫充電週期')
      where id=v_charge.id;
  end if;
  insert into public.usage_records(switch_id,issue_date,issue_no,status,note)
  values(p_switch_id,p_event_date,p_document_no,'領用中',p_note);
  perform public.log_event(v_new,'領用',p_document_no,'領用後停止6個月充電計時',to_jsonb(v_old),to_jsonb(v_new));
end;
$$;

create function public.return_switch(
  p_switch_id uuid,p_event_date date,p_document_no text default null,p_note text default null
)
returns void language plpgsql security invoker as $$
declare v_old public.switches; v_new public.switches; v_usage public.usage_records; v_cycle integer; v_next date;
begin
  select * into v_old from public.switches where id=p_switch_id for update;
  if not found then raise exception '設備不存在'; end if;
  if v_old.state<>'領用中' then raise exception '目前不是領用中狀態，無法退庫'; end if;
  if v_old.issue_date is not null and p_event_date<v_old.issue_date then raise exception '退庫日期不可早於領用日期'; end if;
  update public.switches set state='在庫',return_date=p_event_date,cycle_start_date=p_event_date,
    next_charge_date=(p_event_date+interval '6 months')::date,issue_no=coalesce(p_document_no,issue_no),
    send_date=null,transfer_no=null,remark=p_note
    where id=p_switch_id returning * into v_new;
  select * into v_usage from public.usage_records
    where switch_id=p_switch_id and status='領用中' order by issue_date desc limit 1 for update;
  if found then
    update public.usage_records set return_date=p_event_date,status='已退庫',note=coalesce(p_note,note) where id=v_usage.id;
  else
    insert into public.usage_records(switch_id,issue_date,issue_no,return_date,status,note)
    values(p_switch_id,coalesce(v_old.issue_date,p_event_date),v_old.issue_no,p_event_date,'已退庫','找不到對應領用紀錄，系統補建歷史紀錄');
  end if;
  select coalesce(max(cycle_no),0)+1 into v_cycle from public.charge_records where switch_id=p_switch_id;
  v_next:=(p_event_date+interval '6 months')::date;
  insert into public.charge_records(switch_id,cycle_no,start_date,due_date,status,note)
  values(p_switch_id,v_cycle,p_event_date,v_next,'待充電','退庫視同重新入庫，重新起算6個月');
  perform public.log_event(v_new,'退庫',p_document_no,'退庫後視同重新入庫並重新起算6個月',to_jsonb(v_old),to_jsonb(v_new));
end;
$$;

create function public.send_switch_for_charge(
  p_switch_id uuid,p_event_date date,p_transfer_no text,p_note text default null
)
returns void language plpgsql security invoker as $$
declare v_old public.switches; v_new public.switches; v_charge public.charge_records;
begin
  select * into v_old from public.switches where id=p_switch_id for update;
  if not found then raise exception '設備不存在'; end if;
  if v_old.state<>'在庫' then raise exception '目前不是在庫狀態，無法送檢'; end if;
  if coalesce(trim(p_transfer_no),'')='' then raise exception '充電移撥單號不可空白'; end if;
  update public.switches set state='送檢充電',send_date=p_event_date,transfer_no=trim(p_transfer_no),remark=p_note
  where id=p_switch_id returning * into v_new;
  select * into v_charge from public.charge_records
  where switch_id=p_switch_id and status='待充電' order by cycle_no desc limit 1 for update;
  if found then
    update public.charge_records set status='送檢中',send_date=p_event_date,transfer_no=trim(p_transfer_no),note=p_note
    where id=v_charge.id;
  else
    insert into public.charge_records(
      switch_id,cycle_no,start_date,due_date,status,send_date,transfer_no,note
    )
    values(
      p_switch_id,1,coalesce(v_old.cycle_start_date,v_old.entry_date),
      coalesce(v_old.next_charge_date,(v_old.entry_date+interval '6 months')::date),
      '送檢中',p_event_date,trim(p_transfer_no),p_note
    );
  end if;
  perform public.log_event(v_new,'送檢充電',trim(p_transfer_no),coalesce(p_note,'送檢檢修課充電'),to_jsonb(v_old),to_jsonb(v_new));
end;
$$;

create function public.complete_switch_charge(
  p_switch_id uuid,p_event_date date,p_transfer_no text default null,p_note text default null
)
returns void language plpgsql security invoker as $$
declare v_old public.switches; v_new public.switches; v_charge public.charge_records; v_cycle integer; v_next date;
begin
  select * into v_old from public.switches where id=p_switch_id for update;
  if not found then raise exception '設備不存在'; end if;
  if v_old.state not in ('送檢充電','充電中') then raise exception '目前不是送檢充電或充電中狀態'; end if;
  if v_old.send_date is not null and p_event_date<v_old.send_date then raise exception '充電完成日不可早於送檢日'; end if;

  update public.switches set state='在庫',last_charge_date=p_event_date,cycle_start_date=p_event_date,
    next_charge_date=(p_event_date+interval '6 months')::date,transfer_no=null,send_date=null,remark=p_note
  where id=p_switch_id returning * into v_new;

  select * into v_charge from public.charge_records
  where switch_id=p_switch_id and status in ('送檢中','充電中') order by cycle_no desc limit 1 for update;
  if found then
    update public.charge_records set status='已完成',completed_date=p_event_date,
      transfer_no=coalesce(p_transfer_no,transfer_no),note=p_note
    where id=v_charge.id;
  else
    select coalesce(max(cycle_no),0)+1 into v_cycle from public.charge_records where switch_id=p_switch_id;
    insert into public.charge_records(
      switch_id,cycle_no,start_date,due_date,send_date,transfer_no,completed_date,status,note
    )
    values(
      p_switch_id,v_cycle,coalesce(v_old.cycle_start_date,v_old.entry_date),
      p_event_date,v_old.send_date,coalesce(p_transfer_no,v_old.transfer_no),p_event_date,'已完成',p_note
    );
  end if;

  select coalesce(max(cycle_no),0)+1 into v_cycle from public.charge_records where switch_id=p_switch_id;
  v_next:=(p_event_date+interval '6 months')::date;
  insert into public.charge_records(switch_id,cycle_no,start_date,due_date,status,note)
  values(p_switch_id,v_cycle,p_event_date,v_next,'待充電','完成充電後建立下一個6個月週期');

  perform public.log_event(v_new,'充電完成',coalesce(p_transfer_no,v_old.transfer_no),
    '完成充電並重新起算6個月',to_jsonb(v_old),to_jsonb(v_new));
end;
$$;

alter table public.switches enable row level security;
alter table public.charge_records enable row level security;
alter table public.usage_records enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists switches_select_authenticated on public.switches;
create policy switches_select_authenticated on public.switches for select to authenticated using (true);

drop policy if exists switches_insert_authenticated on public.switches;
create policy switches_insert_authenticated on public.switches for insert to authenticated with check (true);

drop policy if exists switches_update_authenticated on public.switches;
create policy switches_update_authenticated on public.switches for update to authenticated using (true) with check (true);

drop policy if exists charge_select_authenticated on public.charge_records;
create policy charge_select_authenticated on public.charge_records for select to authenticated using (true);

drop policy if exists usage_select_authenticated on public.usage_records;
create policy usage_select_authenticated on public.usage_records for select to authenticated using (true);

drop policy if exists audit_select_authenticated on public.audit_log;
create policy audit_select_authenticated on public.audit_log for select to authenticated using (true);

grant usage on schema public to authenticated;
grant select on public.switches to authenticated;
grant select on public.charge_records to authenticated;
grant select on public.usage_records to authenticated;
grant select on public.audit_log to authenticated;

grant execute on function public.create_switch(text,text,text,text,text,text,date,text) to authenticated;
grant execute on function public.update_switch_master(uuid,text,text,text,text,text,text,date,text) to authenticated;
grant execute on function public.issue_switch(uuid,date,text,text) to authenticated;
grant execute on function public.return_switch(uuid,date,text,text) to authenticated;
grant execute on function public.send_switch_for_charge(uuid,date,text,text) to authenticated;
grant execute on function public.complete_switch_charge(uuid,date,text,text) to authenticated;

revoke insert,update,delete on public.switches from authenticated;
revoke insert,update,delete on public.charge_records from authenticated;
revoke insert,update,delete on public.usage_records from authenticated;
revoke delete on public.audit_log from authenticated;

-- Do not grant the internal audit helper to browser users.
revoke execute on function public.log_event(public.switches,text,text,text,jsonb,jsonb) from authenticated;

-- Conservative backfill for legacy devices that already have a cycle on switches.
insert into public.charge_records(
  switch_id,cycle_no,start_date,due_date,status,note
)
select s.id,1,s.cycle_start_date,s.next_charge_date,'待充電','舊版設備資料回填之第一個充電週期'
from public.switches s
where s.cycle_start_date is not null
  and s.next_charge_date is not null
  and not exists(select 1 from public.charge_records c where c.switch_id=s.id);
