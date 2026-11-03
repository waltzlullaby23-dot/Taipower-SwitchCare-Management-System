-- SwitchCare v11.9 transfer-in/out migration. Non-destructive.
begin;
alter table public.switches drop constraint if exists switches_state_check;
alter table public.switches add constraint switches_state_check check (state in ('在庫','領用中','送檢充電','充電中','待修','修理中','待驗','驗收中','停用','報廢','遺失','封存','移撥中','移撥出'));
alter table public.switches add column if not exists ownership_unit text,
 add column if not exists transfer_direction text, add column if not exists transfer_date date,
 add column if not exists transfer_document_no text, add column if not exists transfer_note text,
 add column if not exists transfer_source_unit text;
alter table public.usage_records add column if not exists recipient_unit text,
 add column if not exists event_kind text not null default '領用',
 add column if not exists transfer_document_no text,
 add column if not exists source_unit text;
alter table public.usage_records drop constraint if exists usage_records_status_check;
alter table public.usage_records add constraint usage_records_status_check check (status in ('領用中','已退庫','已移撥','取消'));
alter table public.switches
 add column if not exists active_usage_note text,
 add column if not exists active_recipient_unit text;
create index if not exists idx_switches_transfer_state on public.switches(state,transfer_date);
create index if not exists idx_usage_transfer_kind on public.usage_records(event_kind,status);

create or replace function public.issue_switch(p_switch_id uuid,p_event_date date,p_document_no text default null,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_old public.switches; v_new public.switches; v_charge public.charge_records;
begin
 select * into v_old from public.switches where id=p_switch_id for update;
 if not found then raise exception '設備不存在'; end if;
 if v_old.state<>'在庫' then raise exception '目前不是在庫狀態，無法領用'; end if;
 update public.switches set state='領用中',issue_date=p_event_date,issue_no=p_document_no,cycle_start_date=null,next_charge_date=null,send_date=null,transfer_no=null where id=p_switch_id returning * into v_new;
 select * into v_charge from public.charge_records where switch_id=p_switch_id and status='待充電' order by cycle_no desc limit 1 for update;
 if found then update public.charge_records set status='因領用中止',note=coalesce(p_note,'設備領用，停止本次在庫充電週期') where id=v_charge.id; end if;
 insert into public.usage_records(switch_id,issue_date,issue_no,status,note,event_kind) values(p_switch_id,p_event_date,p_document_no,'領用中',p_note,'領用');
 perform public.log_event(v_new,'領用',p_document_no,coalesce(p_note,'領用後停止6個月充電計時'),to_jsonb(v_old),to_jsonb(v_new));
end; $$;

create or replace function public.return_switch(p_switch_id uuid,p_event_date date,p_document_no text default null,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_old public.switches; v_new public.switches; v_usage public.usage_records; v_cycle integer; v_next date;
begin
 select * into v_old from public.switches where id=p_switch_id for update;
 if not found then raise exception '設備不存在'; end if;
 if v_old.state<>'領用中' then raise exception '目前不是領用中狀態，無法退庫'; end if;
 if p_event_date>current_date then raise exception '退庫日期不可晚於今天'; end if;
 if v_old.issue_date is not null and p_event_date<v_old.issue_date then raise exception '退庫日期不可早於領用日期'; end if;
 update public.switches set state='在庫',return_date=p_event_date,cycle_start_date=p_event_date,next_charge_date=(p_event_date+interval '6 months')::date,issue_no=coalesce(p_document_no,issue_no),send_date=null,transfer_no=null where id=p_switch_id returning * into v_new;
 select * into v_usage from public.usage_records where switch_id=p_switch_id and status='領用中' and event_kind='領用' order by issue_date desc limit 1 for update;
 if found then update public.usage_records set return_date=p_event_date,status='已退庫' where id=v_usage.id;
 else insert into public.usage_records(switch_id,issue_date,issue_no,return_date,status,note,event_kind) values(p_switch_id,coalesce(v_old.issue_date,p_event_date),v_old.issue_no,p_event_date,'已退庫','找不到對應領用紀錄，系統補建歷史紀錄','領用'); end if;
 select coalesce(max(cycle_no),0)+1 into v_cycle from public.charge_records where switch_id=p_switch_id;
 v_next:=(p_event_date+interval '6 months')::date;
 insert into public.charge_records(switch_id,cycle_no,start_date,due_date,status,note) values(p_switch_id,v_cycle,p_event_date,v_next,'待充電','退庫視同重新入庫，重新起算6個月');
 perform public.log_event(v_new,'退庫',p_document_no,coalesce(p_note,'退庫後視同重新入庫並重新起算6個月'),to_jsonb(v_old),to_jsonb(v_new));
end; $$;

create or replace function public.transfer_switch_out(p_switch_id uuid,p_event_date date,p_recipient_unit text,p_document_no text default null,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_old public.switches; v_new public.switches;
begin
 select * into v_old from public.switches where id=p_switch_id for update;
 if not found then raise exception '設備不存在'; end if;
 if v_old.state<>'在庫' then raise exception '僅本處在庫設備可以辦理移撥出'; end if;
 if coalesce(trim(p_recipient_unit),'')='' then raise exception '接收區處／單位不可空白'; end if;
 if p_event_date>current_date then raise exception '移撥日期不可晚於今天'; end if;
 update public.switches set state='移撥出',ownership_unit=trim(p_recipient_unit),transfer_direction='移撥出',transfer_date=p_event_date,transfer_source_unit='本處',transfer_document_no=nullif(trim(p_document_no),''),transfer_note=p_note,cycle_start_date=null,next_charge_date=null,send_date=null,transfer_no=null,active_usage_note=null,active_recipient_unit=null where id=p_switch_id returning * into v_new;
 update public.charge_records set status='因領用中止',note=coalesce(note,'因移撥出停止本處充電週期') where switch_id=p_switch_id and status='待充電';
 insert into public.usage_records(switch_id,issue_date,issue_no,status,note,event_kind,recipient_unit,transfer_document_no,source_unit) values(p_switch_id,p_event_date,nullif(trim(p_document_no),''),'已移撥',p_note,'移撥出',trim(p_recipient_unit),nullif(trim(p_document_no),''),'本處');
 perform public.log_event(v_new,'移撥出',nullif(trim(p_document_no),''),concat('所有權移轉至 ',trim(p_recipient_unit),case when coalesce(trim(p_note),'')<>'' then '；'||p_note else '' end),to_jsonb(v_old),to_jsonb(v_new));
end; $$;

create or replace function public.transfer_switch_in(p_switch_id uuid,p_event_date date,p_source_unit text,p_document_no text default null,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_old public.switches; v_new public.switches; v_cycle integer; v_due date;
begin
 select * into v_old from public.switches where id=p_switch_id for update;
 if not found then raise exception '設備不存在'; end if;
 if v_old.state not in ('移撥出','移撥中') then raise exception '僅已移撥至外單位的設備可以辦理移撥入'; end if;
 if coalesce(trim(p_source_unit),'')='' then raise exception '移撥來源區處／單位不可空白'; end if;
 if p_event_date>current_date then raise exception '移撥入日期不可晚於今天'; end if;
 v_due:=(p_event_date+interval '6 months')::date;
 update public.switches set state='在庫',ownership_unit='本處',transfer_direction='移撥入',transfer_date=p_event_date,transfer_document_no=nullif(trim(p_document_no),''),transfer_note=p_note,transfer_source_unit=trim(p_source_unit),cycle_start_date=p_event_date,next_charge_date=v_due,return_date=p_event_date,issue_date=null,issue_no=null,send_date=null,transfer_no=null,active_usage_note=null,active_recipient_unit=null where id=p_switch_id returning * into v_new;
 select coalesce(max(cycle_no),0)+1 into v_cycle from public.charge_records where switch_id=p_switch_id;
 insert into public.charge_records(switch_id,cycle_no,start_date,due_date,status,note) values(p_switch_id,v_cycle,p_event_date,v_due,'待充電','移撥入本處，依移撥入日期重新起算6個月');
 insert into public.usage_records(switch_id,issue_date,issue_no,return_date,status,note,event_kind,recipient_unit,transfer_document_no,source_unit) values(p_switch_id,p_event_date,nullif(trim(p_document_no),''),p_event_date,'已移撥',p_note,'移撥入','本處',nullif(trim(p_document_no),''),trim(p_source_unit));
 perform public.log_event(v_new,'移撥入',nullif(trim(p_document_no),''),concat('由 ',trim(p_source_unit),' 移撥入本處',case when coalesce(trim(p_note),'')<>'' then '；'||p_note else '' end),to_jsonb(v_old),to_jsonb(v_new));
end; $$;

grant execute on function public.issue_switch(uuid,date,text,text) to authenticated;
grant execute on function public.return_switch(uuid,date,text,text) to authenticated;
grant execute on function public.transfer_switch_out(uuid,date,text,text,text) to authenticated;
grant execute on function public.transfer_switch_in(uuid,date,text,text,text) to authenticated;

-- Validate dates and keep all new SECURITY DEFINER RPCs private to authenticated users.
-- Normal issue records retain the recipient and note separately from the device master remark.
create or replace function public.issue_switch_with_recipient(
 p_switch_id uuid,p_event_date date,p_document_no text,p_note text,p_recipient_unit text
)
returns void language plpgsql security definer set search_path=public as $$
declare v_old public.switches; v_new public.switches; v_charge public.charge_records;
begin
 select * into v_old from public.switches where id=p_switch_id for update;
 if not found then raise exception '設備不存在'; end if;
 if v_old.state<>'在庫' then raise exception '目前不是在庫狀態，無法領用'; end if;
 if p_event_date>current_date then raise exception '領用日期不可晚於今天'; end if;
 update public.switches set state='領用中',issue_date=p_event_date,issue_no=p_document_no,
  cycle_start_date=null,next_charge_date=null,send_date=null,transfer_no=null,
  active_usage_note=p_note,active_recipient_unit=nullif(trim(p_recipient_unit),'')
  where id=p_switch_id returning * into v_new;
 select * into v_charge from public.charge_records where switch_id=p_switch_id and status='待充電'
  order by cycle_no desc limit 1 for update;
 if found then update public.charge_records set status='因領用中止',
  note=coalesce(p_note,'設備領用，停止本次在庫充電週期') where id=v_charge.id; end if;
 insert into public.usage_records(switch_id,issue_date,issue_no,status,note,event_kind,recipient_unit)
  values(p_switch_id,p_event_date,p_document_no,'領用中',p_note,'領用',nullif(trim(p_recipient_unit),''));
 perform public.log_event(v_new,'領用',p_document_no,
  coalesce(p_note,'領用後停止6個月充電計時'),to_jsonb(v_old),to_jsonb(v_new));
end; $$;

revoke all on function public.issue_switch_with_recipient(uuid,date,text,text,text) from public;
revoke all on function public.transfer_switch_out(uuid,date,text,text,text) from public;
revoke all on function public.transfer_switch_in(uuid,date,text,text,text) from public;
revoke all on function public.issue_switch(uuid,date,text,text) from public;
revoke all on function public.return_switch(uuid,date,text,text) from public;
grant execute on function public.issue_switch_with_recipient(uuid,date,text,text,text) to authenticated;
grant execute on function public.issue_switch(uuid,date,text,text) to authenticated;
grant execute on function public.return_switch(uuid,date,text,text) to authenticated;
grant execute on function public.transfer_switch_out(uuid,date,text,text,text) to authenticated;
grant execute on function public.transfer_switch_in(uuid,date,text,text,text) to authenticated;

-- First-time inbound transfer RPC.
create or replace function public.create_transfer_in_switch(
 p_material_no text,p_taipower_no text,p_type text,p_rating_type text,
 p_warehouse text,p_location text,p_event_date date,p_source_unit text,
 p_document_no text,p_note text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_switch public.switches; v_next date;
begin
 if p_material_no !~ '^[0-9]{10}$' then raise exception '開關料號必須為10位數字'; end if;
 if coalesce(trim(p_taipower_no),'')='' then raise exception '台電編號不可空白'; end if;
 if coalesce(trim(p_type),'')='' then raise exception '型式不可空白'; end if;
 if p_rating_type not in ('新品','舊品') then raise exception '評價類型只能是新品或舊品'; end if;
 if coalesce(trim(p_source_unit),'')='' then raise exception '移撥來源區處／單位不可空白'; end if;
 if p_event_date is null or p_event_date>current_date then raise exception '移撥入日期不可空白或晚於今天'; end if;
 if exists(select 1 from public.switches where taipower_no=trim(p_taipower_no)) then
  raise exception '台電編號已存在：%',trim(p_taipower_no);
 end if;
 v_next:=(p_event_date+interval '6 months')::date;
 insert into public.switches(
  material_no,taipower_no,type,rating_type,warehouse,location,entry_date,state,
  cycle_start_date,next_charge_date,remark,ownership_unit,transfer_direction,
  transfer_date,transfer_document_no,transfer_note,transfer_source_unit,
  active_usage_note,active_recipient_unit
 ) values (
  p_material_no,trim(p_taipower_no),trim(p_type),p_rating_type,
  nullif(trim(p_warehouse),''),nullif(trim(p_location),''),p_event_date,'在庫',
  p_event_date,v_next,null,'本處','移撥入',p_event_date,
  nullif(trim(p_document_no),''),p_note,trim(p_source_unit),null,null
 ) returning * into v_switch;
 insert into public.charge_records(switch_id,cycle_no,start_date,due_date,status,note)
 values(v_switch.id,1,p_event_date,v_next,'待充電','外單位設備首次移撥入本處，依移撥入日期起算6個月');
 insert into public.usage_records(
  switch_id,issue_date,issue_no,return_date,status,note,event_kind,
  recipient_unit,transfer_document_no,source_unit
 ) values (
  v_switch.id,p_event_date,nullif(trim(p_document_no),''),p_event_date,
  '已移撥',p_note,'移撥入','本處',nullif(trim(p_document_no),''),trim(p_source_unit)
 );
 perform public.log_event(v_switch,'移撥入',nullif(trim(p_document_no),''),
  concat('外單位首次移撥入本處；來源：',trim(p_source_unit),
   case when coalesce(trim(p_note),'')<>'' then '；'||p_note else '' end),
  null,to_jsonb(v_switch));
 return v_switch.id;
end;
$$;
revoke all on function public.create_transfer_in_switch(text,text,text,text,text,text,date,text,text,text) from public;
revoke all on function public.create_transfer_in_switch(text,text,text,text,text,text,date,text,text,text) from anon;
grant execute on function public.create_transfer_in_switch(text,text,text,text,text,text,date,text,text,text) to authenticated;

commit;

notify pgrst, 'reload schema';
