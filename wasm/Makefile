# The wasm engine: sqlite.js (glue) + sqlite.wasm (binary).
#
# build.sh passes SQLITE_SRC, so the amalgamation directory name lives in exactly one place.
SQLITE_SRC ?= ../sqlite-amalgamation/sqlite3.c

CFLAGS = \
    -DSQLITE_THREADSAFE=0 \
    -DSQLITE_TEMP_STORE=3 \
    -DSQLITE_ENABLE_FTS5 \
    -DSQLITE_ENABLE_JSON1 \
    -DSQLITE_ENABLE_RTREE \
    -DSQLITE_ENABLE_COLUMN_METADATA \
    -O2

EXPORTS = _sqlite3_initialize,_sqlite3_open_v2,_sqlite3_close,_sqlite3_exec,_sqlite3_prepare_v2,_sqlite3_step,_sqlite3_finalize,_sqlite3_bind_null,_sqlite3_bind_int,_sqlite3_bind_int64,_sqlite3_bind_double,_sqlite3_bind_text,_sqlite3_bind_blob,_sqlite3_column_count,_sqlite3_column_name,_sqlite3_column_type,_sqlite3_column_int64,_sqlite3_column_double,_sqlite3_column_text,_sqlite3_column_blob,_sqlite3_column_bytes,_sqlite3_changes,_sqlite3_last_insert_rowid,_sqlite3_errmsg,_sqlite3_vfs_register,_malloc,_free

RUNTIME = UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAPU8,HEAP32,addFunction

# No SINGLE_FILE: the binary is a real sqlite.wasm beside the glue, so the app serves it once
# and caches it, instead of every bundle carrying an inlined copy of it.
EM_FLAGS = \
    -sWASM=1 \
    -sWASM_BIGINT=1 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sALLOW_TABLE_GROWTH=1 \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sEXPORT_NAME=SqliteModule \
    -sNO_EXIT_RUNTIME=1 \
    -sENVIRONMENT=web,worker,node \
    -sEXPORTED_FUNCTIONS=[$(EXPORTS)] \
    -sEXPORTED_RUNTIME_METHODS=[$(RUNTIME)]

.PHONY: all clean

all: sqlite.js

# The three sed passes are not cosmetic:
#   1,2. emscripten emits bare import()/require() of node builtins. Vite would resolve those
#        into the browser bundle as __vite-browser-external stubs; the @vite-ignore comment
#        tells it to leave them alone.
#   3.   the glue looks its own binary up with new URL("sqlite.wasm", import.meta.url), which
#        makes a bundler inline the whole wasm into the app. Every caller passes wasmBinary,
#        so the reference is dead weight — rewrite it to a bare name.
sqlite.js: $(SQLITE_SRC)
	emcc $(CFLAGS) $(EM_FLAGS) $(SQLITE_SRC) -o sqlite.js
	@sed -i.bak -E 's|import\((["'\''][^"'\'']+["'\''])\)|import(/* @vite-ignore */ (\1))|g' sqlite.js
	@sed -i.bak -E 's|require\((["'\''][^"'\'']+["'\''])\)|require(/* @vite-ignore */ (\1))|g' sqlite.js
	@sed -i.bak -E 's|new URL\("sqlite\.wasm",[[:space:]]*import\.meta\.url\)\.href|"sqlite.wasm"|g' sqlite.js
	@rm -f sqlite.js.bak
	@echo "built sqlite.js ($$(du -h sqlite.js | cut -f1)) + sqlite.wasm ($$(du -h sqlite.wasm | cut -f1))"

clean:
	rm -f sqlite.js sqlite.js.bak sqlite.wasm
