import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import type { Language } from '@codemirror/language';

/**
 * The languages the code editor can actually highlight.
 *
 * `markdown({ codeLanguages })` hands this to lezer, so this array — not any
 * list maintained elsewhere — is the truth for "what a fence language lights
 * up". `fence-languages.ts` derives the ``` completion list from it rather
 * than keeping a second copy that could drift.
 *
 * Startup trim: the grammars are loaded on demand (`load`, CodeMirror's own
 * mechanism for this) instead of imported up front. Thirteen lezer parse
 * tables were deserialized on every launch — on the Windows native editor,
 * which never uses CodeMirror, for nothing. lang-markdown asks for a
 * grammar the first time a fence names it and re-highlights that block when
 * it arrives; after that it is cached here like before.
 *
 * Beyond the lezer grammars, the list also carries StreamLanguage wrappers
 * around the classic CodeMirror 5 grammars from `@codemirror/legacy-modes`.
 * They power two things: ``` fences whose language used to fall through to
 * highlight.js in the preview only (the old `PREVIEW_ONLY` group in
 * `fence-languages.ts`), and plain-text tabs — opening a `.py`, `.sh` or
 * `Dockerfile` used to give a completely colourless buffer (see
 * `loadLanguageForFileName` below).
 */

const lezer = (spec: Parameters<typeof LanguageDescription.of>[0]) => LanguageDescription.of(spec);

/** Static import map — Vite needs literal paths to split chunks, and TS
 *  needs them to type the module. One entry per legacy grammar in use. */
const legacyModes = {
  shell: () => import('@codemirror/legacy-modes/mode/shell'),
  toml: () => import('@codemirror/legacy-modes/mode/toml'),
  properties: () => import('@codemirror/legacy-modes/mode/properties'),
  diff: () => import('@codemirror/legacy-modes/mode/diff'),
  dockerfile: () => import('@codemirror/legacy-modes/mode/dockerfile'),
  ruby: () => import('@codemirror/legacy-modes/mode/ruby'),
  lua: () => import('@codemirror/legacy-modes/mode/lua'),
  perl: () => import('@codemirror/legacy-modes/mode/perl'),
  r: () => import('@codemirror/legacy-modes/mode/r'),
  swift: () => import('@codemirror/legacy-modes/mode/swift'),
  clike: () => import('@codemirror/legacy-modes/mode/clike'),
  vb: () => import('@codemirror/legacy-modes/mode/vb'),
  powershell: () => import('@codemirror/legacy-modes/mode/powershell'),
  groovy: () => import('@codemirror/legacy-modes/mode/groovy'),
  haskell: () => import('@codemirror/legacy-modes/mode/haskell'),
  pascal: () => import('@codemirror/legacy-modes/mode/pascal'),
  julia: () => import('@codemirror/legacy-modes/mode/julia'),
  cmake: () => import('@codemirror/legacy-modes/mode/cmake'),
  erlang: () => import('@codemirror/legacy-modes/mode/erlang'),
  clojure: () => import('@codemirror/legacy-modes/mode/clojure'),
  scheme: () => import('@codemirror/legacy-modes/mode/scheme'),
  mllike: () => import('@codemirror/legacy-modes/mode/mllike'),
  octave: () => import('@codemirror/legacy-modes/mode/octave'),
  coffeescript: () => import('@codemirror/legacy-modes/mode/coffeescript'),
  tcl: () => import('@codemirror/legacy-modes/mode/tcl'),
  verilog: () => import('@codemirror/legacy-modes/mode/verilog'),
  vhdl: () => import('@codemirror/legacy-modes/mode/vhdl'),
  protobuf: () => import('@codemirror/legacy-modes/mode/protobuf'),
  gas: () => import('@codemirror/legacy-modes/mode/gas'),
};

const stream = (
  name: string,
  mode: keyof typeof legacyModes,
  exportName: string,
  opts: { alias?: string[]; extensions?: string[]; filename?: RegExp } = {},
) =>
  LanguageDescription.of({
    name,
    alias: opts.alias,
    extensions: opts.extensions,
    filename: opts.filename,
    load: () =>
      legacyModes[mode]().then(
        (m) =>
          new LanguageSupport(
            StreamLanguage.define((m as Record<string, unknown>)[exportName] as never),
          ),
      ),
  });

export const codeLanguages = [
  // ---- lezer grammars (full parsers) ------------------------------------
  lezer({
    name: 'javascript',
    alias: ['js', 'jsx'],
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  }),
  lezer({
    name: 'typescript',
    alias: ['ts', 'tsx'],
    extensions: ['ts', 'tsx'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true })),
  }),
  lezer({ name: 'python', alias: ['py'], extensions: ['py', 'pyw'], load: () => import('@codemirror/lang-python').then((m) => m.python()) }),
  lezer({ name: 'rust', alias: ['rs'], extensions: ['rs'], load: () => import('@codemirror/lang-rust').then((m) => m.rust()) }),
  lezer({ name: 'html', alias: ['htm'], extensions: ['html', 'htm'], load: () => import('@codemirror/lang-html').then((m) => m.html()) }),
  lezer({ name: 'css', extensions: ['css'], load: () => import('@codemirror/lang-css').then((m) => m.css()) }),
  lezer({ name: 'json', extensions: ['json', 'jsonc'], load: () => import('@codemirror/lang-json').then((m) => m.json()) }),
  lezer({ name: 'cpp', alias: ['c', 'c++'], extensions: ['c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hh', 'hxx', 'ino'], load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()) }),
  lezer({ name: 'java', extensions: ['java'], load: () => import('@codemirror/lang-java').then((m) => m.java()) }),
  lezer({ name: 'go', alias: ['golang'], extensions: ['go'], load: () => import('@codemirror/lang-go').then((m) => m.go()) }),
  lezer({ name: 'yaml', alias: ['yml'], extensions: ['yaml', 'yml'], load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()) }),
  lezer({ name: 'sql', extensions: ['sql'], load: () => import('@codemirror/lang-sql').then((m) => m.sql()) }),
  lezer({ name: 'xml', extensions: ['xml', 'svg', 'plist'], load: () => import('@codemirror/lang-xml').then((m) => m.xml()) }),

  // ---- legacy-modes (stream grammars) ------------------------------------
  // Shell covers bash/zsh scripts and rc files.
  stream('shell', 'shell', 'shell', { alias: ['bash', 'sh', 'zsh'], extensions: ['sh', 'bash', 'zsh'] }),
  stream('toml', 'toml', 'toml', { extensions: ['toml'] }),
  stream('properties', 'properties', 'properties', { alias: ['ini'], extensions: ['ini', 'cfg', 'conf', 'properties'] }),
  stream('diff', 'diff', 'diff', { extensions: ['diff', 'patch'] }),
  stream('dockerfile', 'dockerfile', 'dockerFile', { filename: /^dockerfile(\..+)?$/i }),
  stream('ruby', 'ruby', 'ruby', { extensions: ['rb', 'gemspec', 'rake'] }),
  // PHP has no legacy grammar (the CM5 one needed htmlmixed) — ```php fences
  // still colour in the preview via highlight.js, and .php files stay plain
  // in the editor.
  stream('lua', 'lua', 'lua', { extensions: ['lua'] }),
  stream('perl', 'perl', 'perl', { extensions: ['pl', 'pm'] }),
  stream('r', 'r', 'r', { extensions: ['r'] }),
  stream('swift', 'swift', 'swift', { extensions: ['swift'] }),
  stream('csharp', 'clike', 'csharp', { alias: ['cs'], extensions: ['cs'] }),
  stream('kotlin', 'clike', 'kotlin', { alias: ['kt'], extensions: ['kt', 'kts'] }),
  stream('scala', 'clike', 'scala', { extensions: ['scala'] }),
  stream('dart', 'clike', 'dart', { extensions: ['dart'] }),
  stream('objectivec', 'clike', 'objectiveC', { alias: ['objc'], extensions: ['m'] }),
  stream('vb', 'vb', 'vb', { alias: ['vbnet'], extensions: ['vb'] }),
  stream('powershell', 'powershell', 'powerShell', { alias: ['ps1', 'pwsh'], extensions: ['ps1', 'psm1'] }),
  stream('groovy', 'groovy', 'groovy', { extensions: ['groovy', 'gradle'] }),
  stream('haskell', 'haskell', 'haskell', { extensions: ['hs'] }),
  stream('pascal', 'pascal', 'pascal', { extensions: ['pas'] }),
  stream('julia', 'julia', 'julia', { extensions: ['jl'] }),
  stream('cmake', 'cmake', 'cmake', { extensions: ['cmake'], filename: /^cmakelists\.txt$/i }),
  stream('erlang', 'erlang', 'erlang', { extensions: ['erl'] }),
  stream('clojure', 'clojure', 'clojure', { alias: ['clj'], extensions: ['clj', 'cljs', 'edn'] }),
  stream('scheme', 'scheme', 'scheme', { extensions: ['scm', 'ss'] }),
  stream('ocaml', 'mllike', 'oCaml', { extensions: ['ml', 'mli'] }),
  stream('fsharp', 'mllike', 'fSharp', { alias: ['fs'], extensions: ['fs', 'fsi'] }),
  stream('octave', 'octave', 'octave', { alias: ['matlab'], extensions: ['oct'] }),
  stream('coffeescript', 'coffeescript', 'coffeeScript', { alias: ['coffee'], extensions: ['coffee'] }),
  stream('tcl', 'tcl', 'tcl', { extensions: ['tcl'] }),
  stream('verilog', 'verilog', 'verilog', { extensions: ['v', 'sv'] }),
  stream('vhdl', 'vhdl', 'vhdl', { extensions: ['vhd', 'vhdl'] }),
  stream('protobuf', 'protobuf', 'protobuf', { alias: ['proto'], extensions: ['proto'] }),
  stream('gas', 'gas', 'gas', { alias: ['asm'], extensions: ['s', 'asm'] }),
];

/**
 * Language for a plain-text tab, by file name. `LanguageDescription`
 * matching is the same mechanism the fence highlighter uses, so a file and
 * a ``` fence spelled the same way always resolve to the same grammar.
 * Returns null for markdown (which has its own extension) and anything
 * unknown — those stay plain on purpose.
 */
export function matchLanguageFileName(fileName: string): LanguageDescription | null {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return LanguageDescription.matchFilename(codeLanguages, base.toLowerCase());
}

/** Loaded language for a file name, or null when nothing matches. */
export async function loadLanguageForFileName(fileName: string): Promise<Language | LanguageSupport | null> {
  const desc = matchLanguageFileName(fileName);
  if (!desc) return null;
  try {
    return await desc.load();
  } catch {
    // A failed dynamic import (offline app-store build, bad chunk) must not
    // break opening the file — it just stays unhighlighted.
    return null;
  }
}
