#!/usr/bin/env bash
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_DIR="${IMAGE_DIR:-/opt/ra2-arena/images}"
RUN_DIR="${RUN_DIR:-/run/ra2-arena}"
VM_NET_PORT="${VM_NET_PORT:-7702}"

for image in xpbase.qcow2 xpa.qcow2 xpb.qcow2 ra2full.iso; do
  [ -r "$IMAGE_DIR/$image" ] || { echo "missing image: $IMAGE_DIR/$image" >&2; exit 1; }
done
[ -c /dev/kvm ] || { echo "missing KVM device: /dev/kvm" >&2; exit 1; }
if ! exec 9<>/dev/kvm; then echo "cannot open /dev/kvm for read/write" >&2; exit 1; fi
exec 9>&- 9<&-

mkdir -p "$RUN_DIR" "$RUN_DIR/screens"
rm -f "$RUN_DIR/xpa.mon" "$RUN_DIR/xpb.mon" "$RUN_DIR/xpa.pid" "$RUN_DIR/xpb.pid"

# Repair relocated backing paths only on runtime copies, then add disposable write layers.
for vm in a b; do
  identity="$RUN_DIR/xp$vm.identity.qcow2"
  disk="$RUN_DIR/xp$vm.qcow2"
  rm -f "$identity" "$disk"
  cp --reflink=auto --sparse=always "$IMAGE_DIR/xp$vm.qcow2" "$identity"
  qemu-img rebase -u -f qcow2 -F qcow2 -b "$IMAGE_DIR/xpbase.qcow2" "$identity"
  qemu-img create -q -f qcow2 -F qcow2 \
    -b "$identity" "$disk"
  echo "VM $vm backing chain:"
  qemu-img info --backing-chain --output=json "$disk"
done

VM_DIR="$RUN_DIR" CDROM="$IMAGE_DIR/ra2full.iso" PORT="$VM_NET_PORT" \
  VM=a ROLE=listen VNCNUM=3 "$HERE/xpvm.sh"
VM_DIR="$RUN_DIR" CDROM="$IMAGE_DIR/ra2full.iso" PORT="$VM_NET_PORT" \
  VM=b ROLE=connect VNCNUM=4 "$HERE/xpvm.sh"

for vm in a b; do
  [ -S "$RUN_DIR/xp$vm.mon" ] || { echo "VM $vm monitor did not start" >&2; exit 1; }
done

exec env VM_HOST=local VM_DIR="$RUN_DIR" ARENA_OUT="$RUN_DIR/screens" \
  "$HERE/screenshot_service.py"
