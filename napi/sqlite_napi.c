#include <node_api.h>
#include "sqlite3.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdbool.h>

// helper: throw a JS error with sqlite errmsg
static napi_value throw_sqlite_err(napi_env env, sqlite3 *db, const char *prefix) {
    char msg[512];
    snprintf(msg, sizeof(msg), "%s: %s", prefix, sqlite3_errmsg(db));
    napi_throw_error(env, NULL, msg);
    return NULL;
}

// helper: get string arg
static char *get_string_arg(napi_env env, napi_value val) {
    size_t len;
    napi_get_value_string_utf8(env, val, NULL, 0, &len);
    char *buf = malloc(len + 1);
    napi_get_value_string_utf8(env, val, buf, len + 1, &len);
    return buf;
}

// open(path, readOnly) -> external db handle.
//
// readOnly defaults to true: browsing a database must not rewrite the user's file, and a
// read-only connection never opens a -journal or -wal beside it either, so it also works on a
// read-only volume. A writer passes false and gets the create/read-write flags.
static napi_value napi_open(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    bool read_only = true;
    if (argc >= 2) {
        napi_valuetype type;
        napi_typeof(env, args[1], &type);
        if (type == napi_boolean) {
            napi_get_value_bool(env, args[1], &read_only);
        }
    }
    int flags = read_only
        ? SQLITE_OPEN_READONLY
        : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);

    char *path = get_string_arg(env, args[0]);
    sqlite3 *db;
    int rc = sqlite3_open_v2(path, &db, flags, NULL);
    free(path);

    if (rc != SQLITE_OK) {
        napi_throw_error(env, NULL, sqlite3_errmsg(db));
        sqlite3_close(db);
        return NULL;
    }

    napi_value result;
    napi_create_external(env, db, NULL, NULL, &result);
    return result;
}

// close(db)
static napi_value napi_close(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    sqlite3 *db;
    napi_get_value_external(env, args[0], (void **)&db);
    sqlite3_close(db);

    napi_value undef;
    napi_get_undefined(env, &undef);
    return undef;
}

// exec(db, sql) -> void, throws on error
static napi_value napi_exec(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    sqlite3 *db;
    napi_get_value_external(env, args[0], (void **)&db);

    char *sql = get_string_arg(env, args[1]);
    char *errmsg = NULL;
    int rc = sqlite3_exec(db, sql, NULL, NULL, &errmsg);
    free(sql);

    if (rc != SQLITE_OK) {
        napi_throw_error(env, NULL, errmsg);
        sqlite3_free(errmsg);
        return NULL;
    }

    napi_value undef;
    napi_get_undefined(env, &undef);
    return undef;
}

// bind a single param to stmt at index (1-based)
static int bind_param(napi_env env, sqlite3_stmt *stmt, int idx, napi_value val) {
    napi_valuetype type;
    napi_typeof(env, val, &type);

    if (type == napi_null || type == napi_undefined) {
        return sqlite3_bind_null(stmt, idx);
    }
    if (type == napi_number) {
        double d;
        napi_get_value_double(env, val, &d);
        // bind as int if it's whole number
        if (d == (int64_t)d) {
            return sqlite3_bind_int64(stmt, idx, (int64_t)d);
        }
        return sqlite3_bind_double(stmt, idx, d);
    }
    if (type == napi_boolean) {
        bool b;
        napi_get_value_bool(env, val, &b);
        return sqlite3_bind_int(stmt, idx, b ? 1 : 0);
    }
    if (type == napi_string) {
        char *s = get_string_arg(env, val);
        int rc = sqlite3_bind_text(stmt, idx, s, -1, SQLITE_TRANSIENT);
        free(s);
        return rc;
    }
    // arraybuffer -> BLOB
    bool is_buf;
    napi_is_arraybuffer(env, val, &is_buf);
    if (is_buf) {
        void *data;
        size_t len;
        napi_get_arraybuffer_info(env, val, &data, &len);
        return sqlite3_bind_blob(stmt, idx, data, (int)len, SQLITE_TRANSIENT);
    }
    return SQLITE_OK;
}

// column value -> napi_value
static napi_value column_to_napi(napi_env env, sqlite3_stmt *stmt, int col) {
    int type = sqlite3_column_type(stmt, col);
    napi_value result;

    if (type == SQLITE_INTEGER) {
        napi_create_int64(env, sqlite3_column_int64(stmt, col), &result);
    } else if (type == SQLITE_FLOAT) {
        napi_create_double(env, sqlite3_column_double(stmt, col), &result);
    } else if (type == SQLITE_TEXT) {
        const char *text = (const char *)sqlite3_column_text(stmt, col);
        napi_create_string_utf8(env, text ? text : "", NAPI_AUTO_LENGTH, &result);
    } else if (type == SQLITE_BLOB) {
        const void *blob = sqlite3_column_blob(stmt, col);
        int len = sqlite3_column_bytes(stmt, col);
        void *buf_data;
        napi_create_arraybuffer(env, len, &buf_data, &result);
        if (blob && len > 0) memcpy(buf_data, blob, len);
    } else {
        // SQLITE_NULL
        napi_get_null(env, &result);
    }
    return result;
}

// query(db, sql, params=[]) -> [{col: val, ...}, ...]
static napi_value napi_query(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value args[3];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    sqlite3 *db;
    napi_get_value_external(env, args[0], (void **)&db);

    char *sql = get_string_arg(env, args[1]);

    sqlite3_stmt *stmt;
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
    free(sql);

    if (rc != SQLITE_OK) {
        return throw_sqlite_err(env, db, "prepare");
    }

    // bind params array if provided
    if (argc >= 3) {
        bool is_arr;
        napi_is_array(env, args[2], &is_arr);
        if (is_arr) {
            uint32_t param_count;
            napi_get_array_length(env, args[2], &param_count);
            for (uint32_t i = 0; i < param_count; i++) {
                napi_value param;
                napi_get_element(env, args[2], i, &param);
                bind_param(env, stmt, (int)(i + 1), param);
            }
        }
    }

    int col_count = sqlite3_column_count(stmt);

    // collect column names
    const char **col_names = malloc(col_count * sizeof(char *));
    for (int i = 0; i < col_count; i++) {
        col_names[i] = sqlite3_column_name(stmt, i);
    }

    napi_value rows;
    napi_create_array(env, &rows);
    uint32_t row_idx = 0;

    while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
        napi_value row;
        napi_create_object(env, &row);

        for (int c = 0; c < col_count; c++) {
            napi_value col_val = column_to_napi(env, stmt, c);
            napi_set_named_property(env, row, col_names[c], col_val);
        }

        napi_set_element(env, rows, row_idx++, row);
    }

    free(col_names);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        return throw_sqlite_err(env, db, "step");
    }

    return rows;
}

// run(db, sql, params=[]) -> {changes, lastInsertRowid}
static napi_value napi_run(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value args[3];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    sqlite3 *db;
    napi_get_value_external(env, args[0], (void **)&db);

    char *sql = get_string_arg(env, args[1]);

    sqlite3_stmt *stmt;
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
    free(sql);

    if (rc != SQLITE_OK) {
        return throw_sqlite_err(env, db, "prepare");
    }

    if (argc >= 3) {
        bool is_arr;
        napi_is_array(env, args[2], &is_arr);
        if (is_arr) {
            uint32_t param_count;
            napi_get_array_length(env, args[2], &param_count);
            for (uint32_t i = 0; i < param_count; i++) {
                napi_value param;
                napi_get_element(env, args[2], i, &param);
                bind_param(env, stmt, (int)(i + 1), param);
            }
        }
    }

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE && rc != SQLITE_ROW) {
        return throw_sqlite_err(env, db, "step");
    }

    napi_value result, changes_val, rowid_val;
    napi_create_object(env, &result);
    napi_create_int64(env, sqlite3_changes(db), &changes_val);
    napi_create_int64(env, sqlite3_last_insert_rowid(db), &rowid_val);
    napi_set_named_property(env, result, "changes", changes_val);
    napi_set_named_property(env, result, "lastInsertRowid", rowid_val);
    return result;
}

// module init
static napi_value init(napi_env env, napi_value exports) {
    napi_value fn_open, fn_close, fn_exec, fn_query, fn_run;

    napi_create_function(env, NULL, 0, napi_open,  NULL, &fn_open);
    napi_create_function(env, NULL, 0, napi_close, NULL, &fn_close);
    napi_create_function(env, NULL, 0, napi_exec,  NULL, &fn_exec);
    napi_create_function(env, NULL, 0, napi_query,  NULL, &fn_query);
    napi_create_function(env, NULL, 0, napi_run,   NULL, &fn_run);

    napi_set_named_property(env, exports, "open",  fn_open);
    napi_set_named_property(env, exports, "close", fn_close);
    napi_set_named_property(env, exports, "exec",  fn_exec);
    napi_set_named_property(env, exports, "query", fn_query);
    napi_set_named_property(env, exports, "run",   fn_run);

    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
