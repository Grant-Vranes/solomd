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

/** Extensions the code editor still does not highlight but users open.
 *  Everything the editor *can* highlight is derived from `codeLanguages`
 *  below, so languages only appear once here when they have no grammar. */
const EXTRA_EXT_LABELS: Record<string, string> = {
  txt: 'Plain Text',
  text: 'Plain Text',
  log: 'Plain Text',
  env: 'Dotenv',
  ex: 'Elixir',
  exs: 'Elixir',
  php: 'PHP',
  bat: 'Batch',
  graphql: 'GraphQL',
  gql: 'GraphQL',
  makefile: 'Makefile',
  csv: 'CSV',
  tsv: 'TSV',
  drawio: 'draw.io',
  excalidraw: 'Excalidraw',
  pdf: 'PDF',
};

/** extension → display name, built once from `codeLanguages`. */
const CODE_EXT_LABELS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const ACRONYMS = new Set(['json', 'xml', 'html', 'css', 'sql', 'go', 'r', 'vb']);
  const pretty = (name: string) =>
    ACRONYMS.has(name) ? name.toUpperCase()
    : name === 'typescript' ? 'TypeScript'
    : name === 'javascript' ? 'JavaScript'
    : name === 'objectivec' ? 'Objective-C'
    : name === 'cpp' ? 'C++'
    : name === 'csharp' ? 'C#'
    : name === 'fsharp' ? 'F#'
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
