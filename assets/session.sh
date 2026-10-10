#!/bin/bash
# macOS ships Bash 3.2. No shell interpolation or privileged operations are used.
# The guardian owns a single caffeinate child, which watches this shell with -w.
set -u
umask 077
root=$1
id=$2
deadline=$3
mode=$4
session="$root/sessions/$id"
case "$id" in ''|*[!a-f0-9]*) exit 2 ;; esac
[ ${#id} -eq 32 ] || exit 2
case "$deadline" in ''|*[!0-9]*) exit 2 ;; esac
case "$mode" in display|system) ;; *) exit 2 ;; esac
[ -d "$session" ] && [ -p "$session/control" ] || exit 2

# Opening a FIFO read-only would block before read's timeout starts. Keep it
# read/write for this process's lifetime; never pass the fd to caffeinate.
exec 3<> "$session/control" || exit 2
trap 'exit 0' TERM INT HUP

is_current() {
  local active=''
  [ -f "$root/active" ] && IFS= read -r active < "$root/active"
  [ "$active" = "$id" ]
}

# The atomic active-file rename is the commit. A pre-commit parent crash
# cannot leave an indefinite assertion: no caffeinate has been launched yet.
committed=0
for attempt in 1 2 3 4 5; do
  [ -f "$session/stop" ] && exit 0
  if is_current; then committed=1; break; fi
  IFS= read -r -t 1 request <&3 || :
done
[ "$committed" -eq 1 ] || exit 0
[ ! -f "$session/stop" ] || exit 0

flags=(-i)
[ "$mode" = display ] && flags+=(-d)
if [ "$deadline" -gt 0 ]; then
  now=$(/bin/date +%s)
  remaining=$((deadline - now))
  [ "$remaining" -gt 0 ] || exit 0
  flags+=(-t "$remaining")
fi
/usr/bin/caffeinate "${flags[@]}" -w "$$" 3>&- &
assertion_pid=$!
printf '%s\n' "$assertion_pid" > "$session/ready.tmp"
/bin/mv "$session/ready.tmp" "$session/ready"

# The durable stop file is authoritative. FIFO data is only a wake-up signal;
# a read-timeout boundary or failed write cannot lose the stop request.
while [ -d "$session" ] && [ ! -f "$session/stop" ] && is_current; do
  # Bash owns this job identity; a recycled numeric PID cannot keep us alive.
  running_jobs=$(jobs -pr)
  case " $running_jobs " in *" $assertion_pid "*) ;; *) exit 0 ;; esac
  wait_seconds=30
  if [ "$deadline" -gt 0 ]; then
    now=$(/bin/date +%s)
    remaining=$((deadline - now))
    [ "$remaining" -gt 0 ] || exit 0
    [ "$remaining" -lt "$wait_seconds" ] && wait_seconds=$remaining
  fi
  IFS= read -r -t "$wait_seconds" request <&3 || :
done
# Do not wait for the child here: it is waiting for this process to exit.
exit 0
