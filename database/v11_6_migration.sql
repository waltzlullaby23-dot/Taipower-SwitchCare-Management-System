-- SwitchCare Enterprise v11.6 migration
-- Change: inspection/charging cycle basis is the actual "開單送檢修日".
-- While a device is in inspection, the next cycle date is send_date + 6 months.
-- After charging is completed, the next in-stock cycle is reset from the actual completion date.
-- Existing data is preserved. No DROP TABLE / TRUNCATE.

create or replace function public.send_switch_for_charge(
  p_switch_id uuid,
  p_event_date date,
  p_transfer_no text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_old public.switches;
  v_new public.switches;
  v_charge public.charge_records;
  v_cycle integer;
  v_next date;
begin
  if p_event_date is null then
    raise exception '送檢日期不可空白';
  end if;
  if coalesce(trim(p_transfer_no),'')='' then
    raise exception '充電移撥單號不可空白';
  end if;

  select * into v_old
  from public.switches
  where id=p_switch_id
  for update;

  if not found then
    raise exception '設備不存在';
  end if;
  if v_old.state<>'在庫' then
    raise exception '目前不是在庫狀態，無法送檢';
  end if;

  v_next := (p_event_date + interval '6 months')::date;

  -- 送檢後，當前檢修週期改以實際開單送檢日為基準。
  update public.switches
  set state='送檢充電',
      send_date=p_event_date,
      transfer_no=trim(p_transfer_no),
      cycle_start_date=p_event_date,
      next_charge_date=v_next,
      remark=p_note
  where id=p_switch_id
  returning * into v_new;

  select * into v_charge
  from public.charge_records
  where switch_id=p_switch_id
    and status='待充電'
  order by cycle_no desc
  limit 1
  for update;

  if found then
    update public.charge_records
    set start_date=p_event_date,
        due_date=v_next,
        status='送檢中',
        send_date=p_event_date,
        transfer_no=trim(p_transfer_no),
        note=p_note
    where id=v_charge.id;
  else
    select coalesce(max(cycle_no),0)+1
    into v_cycle
    from public.charge_records
    where switch_id=p_switch_id;

    insert into public.charge_records(
      switch_id,cycle_no,start_date,due_date,status,send_date,transfer_no,note
    )
    values(
      p_switch_id,v_cycle,p_event_date,v_next,'送檢中',p_event_date,trim(p_transfer_no),p_note
    );
  end if;

  perform public.log_event(
    v_new,
    '送檢充電',
    trim(p_transfer_no),
    coalesce(p_note,'送檢檢修課充電；週期以開單送檢日重新起算6個月'),
    to_jsonb(v_old),
    to_jsonb(v_new)
  );
end;
$$;

-- Keep the controlled business RPC available to authenticated operators.
grant execute on function public.send_switch_for_charge(uuid,date,text,text) to authenticated;
