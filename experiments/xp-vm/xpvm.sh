#!/usr/bin/env bash
# Launch one Windows XP player VM. Runs ON the QEMU host.
#
#   VM=a ROLE=listen  xpvm.sh      first instance, owns the virtual Ethernet segment
#   VM=b ROLE=connect xpvm.sh      second instance, joins it
#   INSTALL=1 VM=a xpvm.sh         boot the XP installer with an unattend floppy attached
#
# Why XP and not Windows 98: on 98 this same host wedged the moment RA2 created a LAN game, with the
# kernel spinning in the Cirrus bank-switch path, and there was no cheap fix -- acpi=off is required
# to boot 98 at all, and acpi=off means no PCI enumeration, so the video card could not be changed.
# XP boots with ACPI on, so PCI enumerates, the stock rtl8139 works with no manual configuration,
# and the display driver problem disappears.
#
# ⛔ -vga std does NOT work: XP's first boot hangs applying the display settings, leaving the kernel
# idling while the GUI session is dead -- no keyboard, no mouse, not even ACPI shutdown. Use cirrus.
# ⛔ Do not add the USB tablet for gameplay: it takes ownership of the pointer and a fullscreen
# DirectInput game then sees nothing. Set TABLET=1 only when driving the Windows desktop.
set -u
D="${VM_DIR:-$HOME/ra2vm}"
QEMU="${QEMU_BIN:-qemu-system-i386}"
VM="${VM:-a}"; ROLE="${ROLE:-listen}"; VNCNUM="${VNCNUM:-3}"; PORT="${PORT:-7702}"
case "$ROLE" in
  listen)  NET="socket,id=n0,listen=127.0.0.1:$PORT" ;;
  connect) NET="socket,id=n0,connect=127.0.0.1:$PORT" ;;
  none)    NET="user,id=n0" ;;
  *) echo "ROLE must be listen, connect or none" >&2; exit 2 ;;
esac
MAC="52:54:00:12:35:0$( [ "$VM" = a ] && echo 1 || echo 2 )"

# Build the removable-media arguments explicitly. A nested ${INSTALL:-${CDROM:+...}} does NOT mean
# "else": with INSTALL set it expands to INSTALL's own value, putting a literal 1 on the command
# line, which QEMU parses as a drive spec ("1: drive with bus=0, unit=0 exists").
if [ -n "${INSTALL:-}" ]; then
  MEDIA="-drive file=$D/winxp.iso,media=cdrom,index=2 -drive file=$D/unattend.img,format=raw,if=floppy -boot d"
elif [ -n "${CDROM:-}" ]; then
  MEDIA="-drive file=$CDROM,media=cdrom,index=2"
else
  MEDIA=""
fi

exec "$QEMU" \
  -machine pc -cpu pentium3 -m 1024 \
  -hda "$D/xp$VM.qcow2" \
  $MEDIA \
  -vga cirrus \
  -netdev "$NET" -device "rtl8139,netdev=n0,mac=$MAC" \
  -audiodev none,id=snd0 -device AC97,audiodev=snd0 \
  ${TABLET:+-usb -device usb-tablet} \
  -object "filter-dump,id=dump0,netdev=n0,file=$D/xp$VM.pcap" \
  -monitor "unix:$D/xp$VM.mon,server,nowait" \
  -vnc ":$VNCNUM" \
  -display none -daemonize
