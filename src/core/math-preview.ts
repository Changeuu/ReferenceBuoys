interface MathRow { source: string; cells: string[]; tags: string[] }
export interface FocusedMath { math: string; omittedRows: number }

/** Only shorten a self-contained align chain. Keep unsupported TeX intact. */
export function focusMath(math: string, label: string): FocusedMath | undefined {
  const outer = /^\s*\\begin\{(align\*?)\}([\s\S]*)\\end\{\1\}\s*$/.exec(math);
  if (!outer) return;
  const rows = readRows(outer[2]);
  if (!rows || rows.length < 5) return;
  // Multiple alignment pairs and new left-hand expressions can start independent
  // equations. Do not pretend they are one continuous equality chain.
  if (rows.some(row => row.cells.length !== 2) || !rows[0].cells[0].trim()
    || rows.slice(1).some(row => row.cells[0].trim())) return;
  const matching = rows.flatMap((row, i) => row.tags.includes(label) ? [i] : []);
  if (matching.length !== 1 || rows.some(row => row.tags.length > 1)
    || rows.filter(row => row.tags.length).length < 2) return;
  const end = matching[0];
  let start = end;
  while (start > 0 && !rows[start - 1].tags.length) start--;
  // A final tagged line can have unnumbered continuation lines after it.
  const last = rows.slice(end + 1).some(row => row.tags.length) ? end : rows.length - 1;
  const keep = new Set([0]); // Retain the original left side, never invent a new equality.
  for (let i = start; i <= last; i++) keep.add(i);
  const omittedRows = rows.length - keep.size;
  if (!omittedRows) return;
  const parts: string[] = [];
  for (let i = 0; i < rows.length;) {
    if (keep.has(i)) { parts.push(rows[i++].source); continue; }
    const from = i;
    while (i < rows.length && !keep.has(i)) i++;
    parts.push(`&\\text{⋯ 省略 ${i - from} 行 ⋯}\\notag`);
  }
  return { math: `\\begin{${outer[1]}}\n${parts.join('\n\\\\\n')}\n\\end{${outer[1]}}`, omittedRows };
}

function readRows(source: string): MathRow[] | undefined {
  const rows: MathRow[] = [], environments: string[] = [];
  let braces = 0, delimiters = 0, text = '', cells: string[] = [], cell = '', tags: string[] = [];
  const append = (value: string) => { text += value; cell += value; };
  const finish = () => { rows.push({ source: text.trim(), cells: [...cells, cell], tags }); text = ''; cell = ''; cells = []; tags = []; };
  for (let i = 0; i < source.length;) {
    const char = source[i];
    if (char === '%') { // An escaped percent was already consumed as a control symbol.
      const newline = source.indexOf('\n', i);
      i = newline < 0 ? source.length : newline + 1;
      append('\n'); continue;
    }
    if (char === '\\') {
      const command = /^\\([a-zA-Z]+|[^a-zA-Z])/.exec(source.slice(i));
      if (!command) return;
      const name = command[1], token = command[0];
      // Definitions, declarations, inter-row text and alternate row syntax may
      // carry state across omitted rows. Full rendering is the safe fallback.
      if (/^(?:def|gdef|edef|xdef|let|newcommand|renewcommand|providecommand|newenvironment|renewenvironment|DeclareMathOperator|require|global|color|colorlet|definecolor|style|displaystyle|textstyle|scriptstyle|scriptscriptstyle|bf|rm|it|cal|small|large|Large|hline|cline|intertext|shortintertext|cr|noalign)$/.test(name)) return;
      if (name === 'begin' || name === 'end') {
        const env = /^\\(?:begin|end)\s*\{([^{}]+)\}/.exec(source.slice(i));
        if (!env) return;
        if (name === 'begin') environments.push(env[1]);
        else if (environments.pop() !== env[1]) return;
        append(env[0]); i += env[0].length; continue;
      }
      if (name === 'left') delimiters++;
      if (name === 'right' && --delimiters < 0) return;
      if (name === '\\' && !braces && !environments.length) {
        if (delimiters || !text.trim()) return;
        finish(); i += token.length;
        if (source[i] === '*') i++;
        // Row spacing belongs to the separator. Do not parse arbitrary bracket
        // expressions that might span rows or contain macro definitions.
        const space = /^\s*\[\s*-?(?:\d+(?:\.\d*)?|\.\d+)(?:em|ex|pt|px|mu|cm|mm|in)\s*\]/.exec(source.slice(i));
        if (space) i += space[0].length;
        else if (/^\s*\[/.test(source.slice(i))) return;
        continue;
      }
      if (name === 'tag') {
        if (braces || environments.length) return;
        const tag = /^\\tag\*?\s*\{([^{}\\\r\n]+)\}/.exec(source.slice(i));
        if (!tag) return;
        tags.push(tag[1].trim()); append(tag[0]); i += tag[0].length; continue;
      }
      append(token); i += token.length; continue;
    }
    if (char === '{') braces++;
    if (char === '}' && --braces < 0) return;
    if (char === '&' && !braces && !environments.length) {
      cells.push(cell); cell = ''; text += char;
    } else append(char);
    i++;
  }
  if (braces || delimiters || environments.length) return;
  if (text.trim()) finish();
  return rows;
}
