{
	# build.sh unpacks the amalgamation to this fixed name whatever version it downloaded, so
	# nothing here has to move when SQLite does
	"targets": [{
		"target_name": "sqlite_napi",
		"sources": ["napi/sqlite_napi.c", "sqlite-amalgamation/sqlite3.c"],
		"include_dirs": ["sqlite-amalgamation"],
		"defines": [
			"SQLITE_THREADSAFE=1",
			"SQLITE_ENABLE_FTS5",
			"SQLITE_ENABLE_JSON1",
			"SQLITE_ENABLE_RTREE",
			"SQLITE_ENABLE_COLUMN_METADATA",
			"NAPI_DISABLE_CPP_EXCEPTIONS"
		],
		"cflags": ["-O2"],
		"xcode_settings": {
			"OTHER_CFLAGS": ["-O2"],
			"MACOSX_DEPLOYMENT_TARGET": "11.0"
		},
		"msvs_settings": {
			"VCCLCompilerTool": { "Optimization": 2 }
		}
	}]
}
