project('otelux', 'c',
  version : '0.1.0',
  default_options : [
    'c_std=c17',
    'warning_level=3',
    'werror=true',
    'b_sanitize=address,undefined',
  ],
)

cc = meson.get_compiler('c')

# --- Dependencies ---
gtk4_dep     = dependency('gtk4', version : '>=4.6')
gl_dep       = dependency('gl')
freetype_dep = dependency('freetype2')
harfbuzz_dep = dependency('harfbuzz')
fontconfig_dep = dependency('fontconfig')
sqlite_dep   = dependency('sqlite3')
mhd_dep      = dependency('libmicrohttpd')
math_dep     = cc.find_library('m', required : true)
dl_dep       = cc.find_library('dl', required : true)

# --- Vendored sources ---
glad_inc = include_directories('vendor/glad/include')
glad_src = files('vendor/glad/src/gl.c')

cjson_inc = include_directories('vendor')
cjson_src = files('vendor/cJSON/cJSON.c')

# --- Source files ---
src_inc = include_directories('src')

core_sources = files(
  'src/app.c',
  'src/util/color.c',
  'src/util/time_fmt.c',
  'src/util/arena.c',
  'src/store/db.c',
  'src/store/traces.c',
  'src/ingest/otlp_http.c',
  'src/ingest/otlp_json.c',
  'src/render/gl_core.c',
  'src/render/quad.c',
  'src/render/text.c',
  'src/render/line.c',
  'src/ui/window.c',
  'src/ui/sidebar.c',
  'src/ui/toolbar.c',
  'src/ui/trace_list.c',
  'src/ui/trace_waterfall.c',
  'src/ui/trace_detail.c',
)

all_deps = [gtk4_dep, gl_dep, freetype_dep, harfbuzz_dep, fontconfig_dep,
            sqlite_dep, mhd_dep, math_dep, dl_dep]

# Build as a library for tests to link against
otelux_lib = static_library('otelux_core',
  core_sources + glad_src + cjson_src,
  include_directories : [src_inc, glad_inc, cjson_inc],
  dependencies : all_deps,
  c_args : ['-DOTELUX_VERSION="' + meson.project_version() + '"'],
)

# Main executable
executable('otelux',
  files('src/main.c'),
  link_with : otelux_lib,
  include_directories : [src_inc, glad_inc, cjson_inc],
  dependencies : all_deps,
  c_args : ['-DOTELUX_VERSION="' + meson.project_version() + '"'],
  install : true,
)

# --- Shaders: install to share dir ---
install_data(
  'shaders/quad.vert', 'shaders/quad.frag',
  'shaders/text.vert', 'shaders/text.frag',
  'shaders/line.vert', 'shaders/line.frag',
  install_dir : get_option('datadir') / 'otelux' / 'shaders',
)

# --- Tests ---
subdir('test')
