// node:fs VFS for SQLite WASM (Node.js).
// Parallel to vfs.js, but backed by file descriptors instead of OPFS sync
// handles, so the WASM module reads and writes real files on disk. This file is
// only imported on the Node branch, so the bare node:fs import never reaches the
// browser bundle.

import * as fs from 'node:fs'

const SQLITE_OK = 0
const SQLITE_IOERR = 10
const SQLITE_IOERR_SHORT_READ = SQLITE_IOERR | (2 << 8)
const SQLITE_NOTFOUND = 12
const SQLITE_IOCAP_ATOMIC4K = 0x00000010
const SQLITE_IOCAP_SAFE_APPEND = 0x00000200
const SQLITE_IOCAP_SEQUENTIAL = 0x00000400
const SQLITE_IOCAP_POWERSAFE_OVERWRITE = 0x00001000

// sqlite3_vfs struct offsets (iVersion=1, 32-bit WASM, all fields 4 bytes)
const VFS_SIZE = 72
const OFF_VFS_IVERSION = 0
const OFF_VFS_SZOSFILE = 4
const OFF_VFS_MXPATHNAME = 8
const OFF_VFS_ZNAME = 16
const OFF_VFS_XOPEN = 24
const OFF_VFS_XDELETE = 28
const OFF_VFS_XACCESS = 32
const OFF_VFS_XFULLPATH = 36
const OFF_VFS_XDLOPEN = 40
const OFF_VFS_XDLERROR = 44
const OFF_VFS_XDLSYM = 48
const OFF_VFS_XDLCLOSE = 52
const OFF_VFS_XRANDOM = 56
const OFF_VFS_XSLEEP = 60
const OFF_VFS_XCURTIME = 64
const OFF_VFS_XLASTERR = 68

// sqlite3_io_methods struct offsets (iVersion=1, 52 bytes)
const IO_SIZE = 52
const OFF_IO_IVERSION = 0
const OFF_IO_XCLOSE = 4
const OFF_IO_XREAD = 8
const OFF_IO_XWRITE = 12
const OFF_IO_XTRUNCATE = 16
const OFF_IO_XSYNC = 20
const OFF_IO_XFILESIZE = 24
const OFF_IO_XLOCK = 28
const OFF_IO_XUNLOCK = 32
const OFF_IO_XCHECKLOCK = 36
const OFF_IO_XFILECTRL = 40
const OFF_IO_XSECTORSIZE = 44
const OFF_IO_XDEVCHAR = 48

// sqlite3_file layout: +0 pMethods, +4 fid (our custom field)
const OSFILE_SIZE = 8

// fs handle state (shared with the Node driver via module scope)
export const handles = new Map()  // fid -> file descriptor
export const pathToFid = new Map() // normalized path -> fid
let nextFid = 1

// open an existing db file (or create it) and register its fd for VFS use.
//
// readOnly opens the descriptor 'r', which is what makes browsing safe: an 'r+' fd would still
// let a stray write through, and would fail outright with EACCES on a file the user cannot
// write — a database on a read-only volume, or one owned by someone else.
export function fileAcquire(options) {
	const { path, readOnly = true } = options
	let fd
	if (fs.existsSync(path)) {
		fd = fs.openSync(path, readOnly ? 'r' : 'r+')
	}
	else {
		fd = fs.openSync(path, 'w+')
	}
	const fid = nextFid++
	handles.set(fid, fd)
	pathToFid.set(path, fid)
	return fid
}

// write bytes to a real path, then register its fd for VFS use
export function fileLoad(options) {
	const { path, buffer, readOnly = true } = options
	fs.writeFileSync(path, new Uint8Array(buffer))
	return fileAcquire({ path, readOnly })
}

export function registerVfs(Module) {
	// allocate io_methods struct (static, shared by all open files)
	const ioPtr = Module._malloc(IO_SIZE)
	Module.HEAP32.fill(0, ioPtr >> 2, (ioPtr + IO_SIZE) >> 2)
	Module.HEAP32[(ioPtr + OFF_IO_IVERSION) >> 2] = 1

	function xClose(filePtr) {
		const fid = Module.HEAP32[(filePtr + 4) >> 2]
		if (handles.has(fid)) {
			fs.closeSync(handles.get(fid))
			handles.delete(fid)
		}
		return SQLITE_OK
	}

	function xRead(filePtr, buf, amt, offset) {
		const fid = Module.HEAP32[(filePtr + 4) >> 2]
		if (handles.has(fid)) {
			const view = Module.HEAPU8.subarray(buf, buf + amt)
			const n = fs.readSync(handles.get(fid), view, 0, amt, Number(offset))
			if (n < amt) {
				Module.HEAPU8.fill(0, buf + n, buf + amt)
				return SQLITE_IOERR_SHORT_READ
			}
			return SQLITE_OK
		}
		else {
			return SQLITE_IOERR
		}
	}

	function xWrite(filePtr, buf, amt, offset) {
		const fid = Module.HEAP32[(filePtr + 4) >> 2]
		if (handles.has(fid)) {
			const view = Module.HEAPU8.subarray(buf, buf + amt)
			fs.writeSync(handles.get(fid), view, 0, amt, Number(offset))
			return SQLITE_OK
		}
		else {
			return SQLITE_IOERR
		}
	}

	function xTruncate(filePtr, size) {
		const fid = Module.HEAP32[(filePtr + 4) >> 2]
		if (handles.has(fid)) {
			fs.ftruncateSync(handles.get(fid), Number(size))
			return SQLITE_OK
		}
		else {
			return SQLITE_IOERR
		}
	}

	function xSync(filePtr, _flags) {
		const fid = Module.HEAP32[(filePtr + 4) >> 2]
		if (handles.has(fid)) {
			fs.fsyncSync(handles.get(fid))
			return SQLITE_OK
		}
		else {
			return SQLITE_IOERR
		}
	}

	function xFileSize(filePtr, pSizePtr) {
		const fid = Module.HEAP32[(filePtr + 4) >> 2]
		if (handles.has(fid)) {
			// write size as two 32-bit words (lo, hi) for BigInt-less compat
			const sz = fs.fstatSync(handles.get(fid)).size
			Module.HEAP32[pSizePtr >> 2] = sz >>> 0
			Module.HEAP32[(pSizePtr + 4) >> 2] = (sz / 0x100000000) >>> 0
			return SQLITE_OK
		}
		else {
			return SQLITE_IOERR
		}
	}

	function xLock(_filePtr, _lock) { return SQLITE_OK }
	function xUnlock(_filePtr, _lock) { return SQLITE_OK }
	function xCheckLock(_filePtr, pOutPtr) {
		Module.HEAP32[pOutPtr >> 2] = 0
		return SQLITE_OK
	}
	function xFileControl(_filePtr, _op, _pArg) { return SQLITE_NOTFOUND }
	function xSectorSize(_filePtr) { return 4096 }
	function xDevChar(_filePtr) {
		return SQLITE_IOCAP_ATOMIC4K | SQLITE_IOCAP_SAFE_APPEND | SQLITE_IOCAP_SEQUENTIAL | SQLITE_IOCAP_POWERSAFE_OVERWRITE
	}

	Module.HEAP32[(ioPtr + OFF_IO_XCLOSE) >> 2] = Module.addFunction(xClose, 'ii')
	Module.HEAP32[(ioPtr + OFF_IO_XREAD) >> 2] = Module.addFunction(xRead, 'iiiij')
	Module.HEAP32[(ioPtr + OFF_IO_XWRITE) >> 2] = Module.addFunction(xWrite, 'iiiij')
	Module.HEAP32[(ioPtr + OFF_IO_XTRUNCATE) >> 2] = Module.addFunction(xTruncate, 'iij')
	Module.HEAP32[(ioPtr + OFF_IO_XSYNC) >> 2] = Module.addFunction(xSync, 'iii')
	Module.HEAP32[(ioPtr + OFF_IO_XFILESIZE) >> 2] = Module.addFunction(xFileSize, 'iii')
	Module.HEAP32[(ioPtr + OFF_IO_XLOCK) >> 2] = Module.addFunction(xLock, 'iii')
	Module.HEAP32[(ioPtr + OFF_IO_XUNLOCK) >> 2] = Module.addFunction(xUnlock, 'iii')
	Module.HEAP32[(ioPtr + OFF_IO_XCHECKLOCK) >> 2] = Module.addFunction(xCheckLock, 'iii')
	Module.HEAP32[(ioPtr + OFF_IO_XFILECTRL) >> 2] = Module.addFunction(xFileControl, 'iiii')
	Module.HEAP32[(ioPtr + OFF_IO_XSECTORSIZE) >> 2] = Module.addFunction(xSectorSize, 'ii')
	Module.HEAP32[(ioPtr + OFF_IO_XDEVCHAR) >> 2] = Module.addFunction(xDevChar, 'ii')

	// allocate vfs struct
	const vfsPtr = Module._malloc(VFS_SIZE)
	Module.HEAP32.fill(0, vfsPtr >> 2, (vfsPtr + VFS_SIZE) >> 2)
	const nameBytes = Module.lengthBytesUTF8('file') + 1
	const namePtr = Module._malloc(nameBytes)
	Module.stringToUTF8('file', namePtr, nameBytes)

	Module.HEAP32[(vfsPtr + OFF_VFS_IVERSION) >> 2] = 1
	Module.HEAP32[(vfsPtr + OFF_VFS_SZOSFILE) >> 2] = OSFILE_SIZE
	Module.HEAP32[(vfsPtr + OFF_VFS_MXPATHNAME) >> 2] = 512
	Module.HEAP32[(vfsPtr + OFF_VFS_ZNAME) >> 2] = namePtr

	function xOpen(_vfsPtr, nameP, filePtr, flags, outFlagsPtr) {
		const path = nameP ? Module.UTF8ToString(nameP) : ''
		const fid = pathToFid.get(path) ?? 0
		Module.HEAP32[(filePtr + 0) >> 2] = ioPtr
		Module.HEAP32[(filePtr + 4) >> 2] = fid
		if (outFlagsPtr) {
			Module.HEAP32[outFlagsPtr >> 2] = flags
		}
		return SQLITE_OK
	}

	function xDelete(_vfsPtr, nameP, _syncDir) {
		// journal_mode=MEMORY means this is rarely called; best-effort
		const path = nameP ? Module.UTF8ToString(nameP) : ''
		pathToFid.delete(path)
		return SQLITE_OK
	}

	function xAccess(_vfsPtr, nameP, _flags, pResOut) {
		const path = nameP ? Module.UTF8ToString(nameP) : ''
		Module.HEAP32[pResOut >> 2] = pathToFid.has(path) ? 1 : 0
		return SQLITE_OK
	}

	function xFullPathname(_vfsPtr, nameP, nOut, zOut) {
		const name = nameP ? Module.UTF8ToString(nameP) : ''
		const full = name.startsWith('/') ? name : '/' + name
		Module.stringToUTF8(full, zOut, nOut)
		return SQLITE_OK
	}

	function xRandomness(_vfsPtr, nBuf, zBuf) {
		const bytes = new Uint8Array(nBuf)
		globalThis.crypto.getRandomValues(bytes)
		Module.HEAPU8.set(bytes, zBuf)
		return nBuf
	}

	function xSleep(_vfsPtr, _ms) { return 0 }

	function xCurrentTime(_vfsPtr, pOut) {
		// Julian day number as double
		const jd = Date.now() / 86400000.0 + 2440587.5
		const view = new DataView(Module.HEAPU8.buffer, pOut, 8)
		view.setFloat64(0, jd, true)
		return SQLITE_OK
	}

	function xGetLastError(_vfsPtr, _n, _zBuf) { return 0 }

	Module.HEAP32[(vfsPtr + OFF_VFS_XOPEN) >> 2] = Module.addFunction(xOpen, 'iiiiii')
	Module.HEAP32[(vfsPtr + OFF_VFS_XDELETE) >> 2] = Module.addFunction(xDelete, 'iiii')
	Module.HEAP32[(vfsPtr + OFF_VFS_XACCESS) >> 2] = Module.addFunction(xAccess, 'iiiii')
	Module.HEAP32[(vfsPtr + OFF_VFS_XFULLPATH) >> 2] = Module.addFunction(xFullPathname, 'iiiii')
	// xDlOpen/xDlError/xDlSym/xDlClose left as 0 (NULL) — no dynamic loading in WASM
	Module.HEAP32[(vfsPtr + OFF_VFS_XRANDOM) >> 2] = Module.addFunction(xRandomness, 'iiii')
	Module.HEAP32[(vfsPtr + OFF_VFS_XSLEEP) >> 2] = Module.addFunction(xSleep, 'iii')
	Module.HEAP32[(vfsPtr + OFF_VFS_XCURTIME) >> 2] = Module.addFunction(xCurrentTime, 'iii')
	Module.HEAP32[(vfsPtr + OFF_VFS_XLASTERR) >> 2] = Module.addFunction(xGetLastError, 'iiii')

	Module._sqlite3_vfs_register(vfsPtr, 1) // 1 = makeDefault
}
