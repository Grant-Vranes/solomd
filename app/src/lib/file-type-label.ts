import { codeLanguages } from './code-languages.ts';

/**
 * Status-bar file-type label (v4.7 follow-up to the Markdown/Plain-Text
 * binary). The `Language` field on a tab stays 'markdown' | 'plaintext' — it
 * drives editor behaviour — so this is display-only, derived from the file
 * extension. Code-language names come from `codeLanguages` so the status bar
 * can never claim a language the editor cannot highlight; everything else is
 * a small static map, falling back to the raw uppercase extension and then
 * "Plain Text" for extension-less files.
 */

/** Extensions the code editor does not highlight but users still open. */
const EXTRA_EXT_LABELS: Record<string, string> = {
  txt: 'Plain Text',
  text: 'Plain Text',
  log: 'Plain Text',
  toml: 'TOML',
  ini: 'INI',
  cfg: 'INI',
  conf: 'INI',
  env: 'Dotenv',
  sh: 'Shell',
  zsh: 'Shell',
  bat: 'Batch',
  ps1: 'PowerShell',
  diff: 'Diff',
  patch: 'Diff',
  graphql: 'GraphQL',
  gql: 'GraphQL',
  ex: 'Elixir',
  exs: 'Elixir',
  rb: 'Ruby',
  php: 'PHP',
  lua: 'Lua',
  pl: 'Perl',
  r: 'R',
  swift: 'Swift',
  kt: 'Kotlin',
  scala: 'Scala',
  dart: 'Dart',
  vb: 'VB',
  cs: 'C#',
  makefile: 'Makefile',
  csv: 'CSV',
  tsv: 'TSV',
  drawio: 'draw.io',
  excalidraw: 'Excalidraw',
};

/** extension → display name, built once from `codeLanguages`. */
const CODE_EXT_LABELS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const ACRONYMS = new Set(['json', 'xml', 'html', 'css', 'sql', 'go', 'r']);
  const pretty = (name: string) =>
    ACRONYMS.has(name) ? name.toUpperCase()
    : name === 'typescript' ? 'TypeScript'
    : name === 'javascript' ? 'JavaScript'
    : name === 'objectivec' ? 'Objective-C'
    : name === 'cpp' ? 'C++'
    : name === 'csharp' ? 'C#'
    : name[0].toUpperCase() + name.slice(1);
  for (const lang of codeLanguages) {
    const label = pretty(lang.name);
    for (const ext of [lang.name, ...(lang.alias ?? [])]) map[ext.toLowerCase()] = label;
  }
  return map;
})();

/** Display label for a file name; markdown keeps its own name. */
export function fileTypeLabel(fileName: string, language: string): string {
  if (language === 'markdown') return 'Markdown';
  const base = fileName.split('/').pop() ?? fileName;
  const lower = base.toLowerCase();
  // Extension-less special names: Makefile, .gitignore, .env
  if (!lower.includes('.')) {
    if (lower === 'makefile') return 'Makefile';
    return 'Plain Text';
  }
  const ext = lower.startsWith('.') ? lower.slice(1).split('.').pop()! : lower.split('.').pop()!;
  return CODE_EXT_LABELS[ext] ?? EXTRA_EXT_LABELS[ext] ?? ext.toUpperCase();
}
