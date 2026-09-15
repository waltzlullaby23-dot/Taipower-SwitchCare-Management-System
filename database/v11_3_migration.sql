-- SwitchCare Enterprise v11.3 migration
-- Safe upgrade for an existing v11/v11.2 database.
-- Does NOT drop or truncate switches, charge_records, usage_records, or audit_log.

-- ============================================================
-- 1. Update master-edit RPC
--    When an IN-STOCK device's entry date changes, keep history intact
--    and recalculate the CURRENT cycle only:
--      cycle_start_date = entry_date
--      next_charge_date = entry_date + 6 months
-- ============================================================

create or replace function public.update_switch_master(
  p_switch_id uuid,
  p_material_no text,
  p_taipower_no text,
  p_type text,
  p_rating_type text,
  p_warehouse text default null,
  p_location text default null,
  p_entry_date date default null,
  p_remark text default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_old public.switches;
  v_new public.switches;
  v_entry date;
  v_next date;
  v_pending_id uuid;
  v_next_cycle integer;
begin
  select * into v_old
  from public.switches
  where id=p_switch_id
  for update;

  if not found then raise exception '找不到設備'; end if;
  if p_material_no !~ '^[0-9]{10}$' then raise exception '料號必須為10位數字'; end if;
  if coalesce(trim(p_taipower_no),'')='' then raise exception '台電編號不可空白'; end if;
  if p_rating_type not in ('新品','舊品') then raise exception '評價類型只能是新品或舊品'; end if;
  if coalesce(trim(p_type),'')='' then raise exception '型式不可空白'; end if;
  if exists(select 1 from public.switches where taipower_no=trim(p_taipower_no) and id<>p_switch_id) then
    raise exception '台電編號已存在：%',trim(p_taipower_no);
  end if;

  v_entry:=coalesce(p_entry_date,v_old.entry_date);

  if v_old.state='在庫' and v_entry is distinct from v_old.entry_date then
    v_next:=(v_entry+interval '6 months')::date;

    update public.switches
    set material_no=p_material_no,
        taipower_no=trim(p_taipower_no),
        type=trim(p_type),
        rating_type=p_rating_type,
        warehouse=nullif(trim(p_warehouse),''),
        location=nullif(trim(p_location),''),
        entry_date=v_entry,
        cycle_start_date=v_entry,
        next_charge_date=v_next,
        remark=p_remark
    where id=p_switch_id
    returning * into v_new;

    -- Update only the currently open/pending cycle. Historical completed
    -- cycles remain unchanged.
    select id into v_pending_id
    from public.charge_records
    where switch_id=p_switch_id
      and status='待充電'
    order by cycle_no desc
    limit 1
    for update;

    if v_pending_id is not null then
      update public.charge_records
      set start_date=v_entry,
          due_date=v_next,
          note='主檔入帳日期修改，重新計算目前6個月週期'
      where id=v_pending_id;
    else
      select coalesce(max(cycle_no),0)+1 into v_next_cycle
      from public.charge_records
      where switch_id=p_switch_id;

      insert into public.charge_records(
        switch_id,cycle_no,start_date,due_date,status,note
      ) values (
        p_switch_id,v_next_cycle,v_entry,v_next,'待充電',
        '主檔入帳日期修改，建立新的目前6個月週期'
      );
    end if;
  else
    update public.switches
    set material_no=p_material_no,
        taipower_no=trim(p_taipower_no),
        type=trim(p_type),
        rating_type=p_rating_type,
        warehouse=nullif(trim(p_warehouse),''),
        location=nullif(trim(p_location),''),
        entry_date=v_entry,
        remark=p_remark
    where id=p_switch_id
    returning * into v_new;
  end if;
end;
$$;

grant execute on function public.update_switch_master(uuid,text,text,text,text,text,text,date,text) to authenticated;

-- ============================================================
-- 2. Controlled deletion for erroneous master records
--    Allowed only when there is no real operating history.
--    The deletion itself is recorded in audit_log with switch_id=NULL
--    so the surviving audit event does not violate the FK after deletion.
-- ============================================================

create or replace function public.delete_switch_master(
  p_switch_id uuid,
  p_reason text default '錯誤建檔'
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_old public.switches;
  v_reason text;
  v_has_usage boolean;
  v_has_operational_charge boolean;
begin
  select * into v_old
  from public.switches
  where id=p_switch_id
  for update;

  if not found then raise exception '找不到設備'; end if;

  if v_old.state<>'在庫' then
    raise exception '只有目前為「在庫」狀態的錯誤建檔才能刪除';
  end if;

  select exists(
    select 1 from public.usage_records
    where switch_id=p_switch_id
      and status<>'取消'
  ) into v_has_usage;

  if v_has_usage then
    raise exception '此設備已有領用／退庫紀錄，不能刪除；請走正式停用或後續處置流程';
  end if;

  select exists(
    select 1 from public.charge_records
    where switch_id=p_switch_id
      and status not in ('待充電','因領用中止','取消')
  ) into v_has_operational_charge;

  if v_has_operational_charge then
    raise exception '此設備已有送檢、充電或完成充電紀錄，不能刪除；請保留完整履歷';
  end if;

  v_reason:=nullif(trim(coalesce(p_reason,'')),'');
  if v_reason is null then v_reason:='錯誤建檔'; end if;

  -- Preserve a deletion audit event without retaining a FK to the deleted row.
  insert into public.audit_log(
    switch_id,event_type,material_no,taipower_no,
    actor_id,actor_email,old_data,note
  ) values (
    null,'刪除設備',v_old.material_no,v_old.taipower_no,
    public.current_actor_id(),public.current_actor_email(),
    to_jsonb(v_old),v_reason
  );

  -- Remove old audit rows tied to the deleted master, then dependent history.
  delete from public.audit_log where switch_id=p_switch_id;
  delete from public.charge_records where switch_id=p_switch_id;
  delete from public.usage_records where switch_id=p_switch_id;
  delete from public.switches where id=p_switch_id;
end;
$$;

grant execute on function public.delete_switch_master(uuid,text) to authenticated;

-- Keep direct table writes closed; browser changes still go through RPCs.
revoke insert,update,delete on public.switches from authenticated;
revoke insert,update,delete on public.charge_records from authenticated;
revoke insert,update,delete on public.usage_records from authenticated;
revoke delete on public.audit_log from authenticated;
