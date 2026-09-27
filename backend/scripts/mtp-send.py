#!/usr/bin/env python3
"""Copy a file into a folder on an MTP device (e.g. a Garmin watch) by folder id.

Usage: python3 scripts/mtp-send.py <local file> <parent folder id> [remote name]
Find folder ids with `mtp-folders` (GARMIN/Apps on a Forerunner 265).
Works around mtp-sendfile's path lookup failing on Garmin devices.
"""
import ctypes, ctypes.util, os, sys

lib = ctypes.CDLL(ctypes.util.find_library("mtp") or "/opt/homebrew/lib/libmtp.dylib")

class LIBMTP_file_t(ctypes.Structure):
    pass
LIBMTP_file_t._fields_ = [
    ("item_id", ctypes.c_uint32),
    ("parent_id", ctypes.c_uint32),
    ("storage_id", ctypes.c_uint32),
    ("filename", ctypes.c_char_p),
    ("filesize", ctypes.c_uint64),
    ("modificationdate", ctypes.c_long),
    ("filetype", ctypes.c_int),
    ("next", ctypes.POINTER(LIBMTP_file_t)),
]

LIBMTP_FILETYPE_UNKNOWN = 44  # see libmtp.h

lib.LIBMTP_Init.restype = None
lib.LIBMTP_Get_First_Device.restype = ctypes.c_void_p
lib.LIBMTP_Send_File_From_File.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(LIBMTP_file_t), ctypes.c_void_p, ctypes.c_void_p]
lib.LIBMTP_Send_File_From_File.restype = ctypes.c_int
lib.LIBMTP_Get_Storage.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.LIBMTP_Dump_Errorstack.argtypes = [ctypes.c_void_p]
lib.LIBMTP_Clear_Errorstack.argtypes = [ctypes.c_void_p]
lib.LIBMTP_Release_Device.argtypes = [ctypes.c_void_p]

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    local, parent = sys.argv[1], int(sys.argv[2])
    remote = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(local).upper()

    lib.LIBMTP_Init()
    dev = lib.LIBMTP_Get_First_Device()
    if not dev:
        sys.exit("No MTP device found. Plug in the watch and close OpenMTP/Garmin Express.")
    lib.LIBMTP_Get_Storage(dev, 0)

    f = LIBMTP_file_t()
    f.parent_id = parent
    f.storage_id = 0  # let libmtp derive it from the parent folder
    f.filename = remote.encode()
    f.filesize = os.path.getsize(local)
    f.filetype = LIBMTP_FILETYPE_UNKNOWN

    rc = lib.LIBMTP_Send_File_From_File(dev, local.encode(), ctypes.byref(f), None, None)
    if rc != 0:
        lib.LIBMTP_Dump_Errorstack(dev)
        lib.LIBMTP_Clear_Errorstack(dev)
        lib.LIBMTP_Release_Device(dev)
        sys.exit(f"Transfer failed (code {rc}).")
    print(f"Sent {local} -> folder {parent} as {remote} (new item id {f.item_id})")
    lib.LIBMTP_Release_Device(dev)

main()
